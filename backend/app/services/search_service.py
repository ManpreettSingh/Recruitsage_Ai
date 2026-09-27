import os
import asyncio
import re
import httpx
from typing import List, Dict, Any
from bs4 import BeautifulSoup
from ddgs import DDGS

import time

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

class SearchService:
    def __init__(self):
        self.tavily_key = os.getenv("TAVILY_API_KEY", "").strip()
        self._cache: Dict[str, Any] = {}
        self._cache_ttl = 3600  # 1-hour in-memory cache
        self._semaphore = asyncio.Semaphore(2)

    async def _safe_search(self, query: str, max_results: int = 4) -> List[Dict[str, str]]:
        """
        Executes a DDGS search with error handling, concurrency limiting, and in-memory caching.
        """
        norm_query = " ".join(query.lower().split())
        now = time.time()
        if norm_query in self._cache:
            ts, cached_res = self._cache[norm_query]
            if now - ts < self._cache_ttl:
                return list(cached_res)

        async with self._semaphore:
            def run_sync():
                results = []
                try:
                    with DDGS() as ddgs:
                        for r in ddgs.text(query, max_results=max_results):
                            title = r.get("title", "").strip()
                            href = r.get("href", "").strip()
                            body = r.get("body", "").strip()
                            if href and (title or body):
                                results.append({
                                    "title": title,
                                    "url": href,
                                    "snippet": body
                                })
                except Exception as e:
                    # Retry once without region if needed
                    try:
                        with DDGS() as ddgs:
                            for r in ddgs.text(query, region="wt-wt", max_results=max_results):
                                title = r.get("title", "").strip()
                                href = r.get("href", "").strip()
                                body = r.get("body", "").strip()
                                if href and (title or body):
                                    results.append({
                                        "title": title,
                                        "url": href,
                                        "snippet": body
                                    })
                    except Exception as e2:
                        print(f"[SearchService] Search failed for query '{query}': {e2}")
                return results

            res = await asyncio.to_thread(run_sync)
            if res:
                self._cache[norm_query] = (now, res)
            return res

    async def _search_tavily(self, query: str, max_results: int = 4) -> List[Dict[str, str]]:
        """
        If TAVILY_API_KEY is configured, queries Tavily for rich, deep AI search results.
        """
        if not self.tavily_key:
            return []
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": self.tavily_key,
                        "query": query,
                        "search_depth": "advanced",
                        "max_results": max_results,
                        "include_answer": False
                    }
                )
                if res.status_code == 200:
                    data = res.json()
                    t_results = []
                    for r in data.get("results", []):
                        t_results.append({
                            "title": r.get("title", ""),
                            "url": r.get("url", ""),
                            "snippet": r.get("content", "")[:1500]
                        })
                    return t_results
        except Exception as e:
            print(f"[SearchService] Tavily search error: {e}")
        return []

    async def _scrape_reddit_thread(self, url: str) -> str:
        """
        Directly fetches a Reddit discussion thread to extract the OP description
        and top upvoted developer comments (real work culture, pay, and interview tips).
        """
        def fetch_sync():
            try:
                clean_url = url.split("?")[0].rstrip("/")
                if "/comments/" in clean_url:
                    json_url = clean_url + ".json"
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                        "Accept": "application/json"
                    }
                    res = httpx.get(json_url, headers=headers, timeout=6.0, follow_redirects=True)
                    if res.status_code == 200:
                        data = res.json()
                        post = data[0]["data"]["children"][0]["data"]
                        title = post.get("title", "")
                        selftext = post.get("selftext", "")
                        
                        comments_text = []
                        if len(data) > 1:
                            for c in data[1]["data"]["children"][:5]:
                                cdata = c.get("data", {})
                                body = cdata.get("body", "").strip()
                                if body and len(body) > 25 and not body.startswith("I am a bot") and not body == "[deleted]":
                                    comments_text.append(body[:500])
                        
                        combined = f"Post: {title}\n{selftext[:600]}\n"
                        if comments_text:
                            combined += "Top Developer Comments:\n" + "\n---\n".join(comments_text[:3])
                        return combined.strip()

                # Fallback: HTML parse
                res = httpx.get(url, headers=BROWSER_HEADERS, timeout=6.0, follow_redirects=True)
                if res.status_code == 200:
                    soup = BeautifulSoup(res.text, "html.parser")
                    paragraphs = [p.get_text(" ", strip=True) for p in soup.find_all("p") if len(p.get_text(" ", strip=True)) > 35]
                    if paragraphs:
                        return " | ".join(paragraphs[:5])[:1200]
            except Exception:
                pass
            return ""

        return await asyncio.to_thread(fetch_sync)

    async def _scrape_review_page(self, url: str) -> List[str]:
        """
        Directly fetches and parses an AmbitionBox/Glassdoor overview or review page
        to extract actual ratings, verified employee likes, dislikes, and work culture metrics.
        """
        def fetch_sync():
            excerpts = []
            try:
                res = httpx.get(url, headers=BROWSER_HEADERS, timeout=8.0, follow_redirects=True)
                if res.status_code == 200:
                    soup = BeautifulSoup(res.text, "html.parser")
                    keywords = [
                        "rating", "overall rating", "work-life balance", "work life balance",
                        "job security", "salary & benefits", "salary", "appraisal", "promotions",
                        "likes:", "dislikes:", "pros", "cons", "culture", "layoff"
                    ]
                    seen = set()
                    for el in soup.find_all(["p", "div", "span", "li"]):
                        text = el.get_text(" ", strip=True)
                        t_low = text.lower()
                        if 40 < len(text) < 320 and any(k in t_low for k in keywords):
                            clean_sub = text[:50]
                            if clean_sub not in seen:
                                seen.add(clean_sub)
                                excerpts.append(text)
                                if len(excerpts) >= 8:
                                    break
            except Exception as e:
                print(f"[SearchService] Scrape failed for '{url}': {e}")
            return excerpts

        return await asyncio.to_thread(fetch_sync)

    async def get_reddit_discussions(self, company: str, role: str = "") -> List[Dict[str, str]]:
        """
        Gathers developer discussions from r/developersIndia and tech forums.
        Curls top Reddit threads directly to extract full posts and top community comments.
        """
        clean = company.replace('"', '').strip()
        
        # Check Tavily first if API key configured
        tavily_discussions = await self._search_tavily(f"{clean} developersIndia reddit work culture interview salary", max_results=3)

        q1 = f"{clean} reddit developersIndia work culture"
        q2 = f"{clean} reddit interview experience salary bond"

        res1, res2 = await asyncio.gather(
            self._safe_search(q1, max_results=4),
            self._safe_search(q2, max_results=3)
        )

        seen_urls = set()
        combined = []
        for r in tavily_discussions + res1 + res2:
            u = r.get("url", "")
            if u not in seen_urls:
                seen_urls.add(u)
                combined.append(r)

        # Deep scrape actual Reddit threads for the top 2-3 links
        reddit_candidates = [r for r in combined if "reddit.com" in r.get("url", "")]
        if reddit_candidates:
            crawl_tasks = [self._scrape_reddit_thread(rc["url"]) for rc in reddit_candidates[:3]]
            crawled_results = await asyncio.gather(*crawl_tasks, return_exceptions=True)
            for i, content in enumerate(crawled_results):
                if isinstance(content, str) and content.strip():
                    reddit_candidates[i]["snippet"] = content.strip()

        return combined

    async def get_glassdoor_ambitionbox_reviews(self, company: str, role: str = "") -> List[Dict[str, str]]:
        """
        Gathers verified review ratings, pros, cons, and extracts actual review excerpts.
        """
        clean = company.replace('"', '').strip()
        q_ab = f"{clean} AmbitionBox reviews overview rating"
        q_gd = f"{clean} Glassdoor reviews pros cons India"

        ab_results, gd_results = await asyncio.gather(
            self._safe_search(q_ab, max_results=3),
            self._safe_search(q_gd, max_results=3)
        )

        all_findings = ab_results + gd_results

        # Attempt deep review extraction from top AmbitionBox link
        ab_urls = [r["url"] for r in ab_results if "ambitionbox.com" in r.get("url", "")]
        if ab_urls:
            target_ab = ab_urls[0]
            excerpts = await self._scrape_review_page(target_ab)
            if excerpts:
                summary_snippet = " | ".join(excerpts[:6])
                all_findings.insert(0, {
                    "title": f"Verified Employee Review Metrics - {clean} (AmbitionBox)",
                    "url": target_ab,
                    "snippet": summary_snippet
                })

        return all_findings

    async def _scrape_interview_page(self, url: str) -> List[str]:
        """
        Directly fetches and parses GeeksforGeeks, LeetCode Discuss, or Glassdoor interview archives
        to extract actual interview questions, round structures, and test patterns.
        """
        def fetch_sync():
            points = []
            try:
                res = httpx.get(url, headers=BROWSER_HEADERS, timeout=8.0, follow_redirects=True)
                if res.status_code == 200:
                    soup = BeautifulSoup(res.text, "html.parser")
                    keywords = [
                        "round", "question", "coding", "technical", "assessment", "dsa",
                        "leetcode", "topics", "experience", "test pattern", "hackerrank",
                        "mettl", "codesignal", "syllabus", "interview"
                    ]
                    seen = set()
                    for el in soup.find_all(["h2", "h3", "p", "li"]):
                        text = el.get_text(" ", strip=True)
                        t_low = text.lower()
                        if 25 < len(text) < 400 and any(k in t_low for k in keywords):
                            clean_sub = text[:60]
                            if clean_sub not in seen:
                                seen.add(clean_sub)
                                points.append(text)
                                if len(points) >= 10:
                                    break
            except Exception as e:
                print(f"[SearchService] Interview scrape failed for '{url}': {e}")
            return points

        return await asyncio.to_thread(fetch_sync)

    async def get_interview_and_prep_intel(self, company: str, role: str = "", skills: List[str] = None) -> List[Dict[str, str]]:
        """
        Actively probes GeeksforGeeks, LeetCode Discuss, and interview archives for:
        1. Exact coding questions and problem names asked in past campus drives.
        2. Online assessment (OA) platform, test duration, and question formats.
        3. Core CS topics emphasized by technical interviewers for this specific company.
        """
        clean = company.replace('"', '').strip()
        clean_role = (role or "software engineer").replace('"', '').strip()
        skills_hint = " ".join((skills or [])[:3])

        role_word = clean_role.split()[0] if clean_role else ""

        # 1. Query Tavily if API key is present
        tavily_q = f"{clean} {clean_role} interview questions coding online assessment".strip()
        tavily_results = await self._search_tavily(tavily_q, max_results=4)

        # 2. High-recall search queries covering all major placement & tech interview archives
        # Note: Keep queries concise to prevent DuckDuckGo 0-result boolean dropouts
        q1 = f"{clean} interview questions"
        q2 = f"{clean} interview experience"
        q3 = f"{clean} AmbitionBox interview"
        q4 = f"{clean} {role_word} interview" if role_word else f"{clean} technical interview"

        r1, r2, r3, r4 = await asyncio.gather(
            self._safe_search(q1, max_results=3),
            self._safe_search(q2, max_results=3),
            self._safe_search(q3, max_results=3),
            self._safe_search(q4, max_results=3)
        )

        seen_urls = set()
        combined = []
        for r in tavily_results + r1 + r2 + r3 + r4:
            u = r.get("url", "")
            if u and u not in seen_urls:
                seen_urls.add(u)
                combined.append(r)

        # 3. Deep scrape top 2 relevant interview pages (GFG / LeetCode / Glassdoor)
        interview_candidates = [
            r for r in combined
            if any(dom in r.get("url", "") for dom in ["geeksforgeeks.org", "leetcode.com", "glassdoor", "ambitionbox", "codinginterview"])
        ]
        if interview_candidates:
            crawl_tasks = [self._scrape_interview_page(ic["url"]) for ic in interview_candidates[:2]]
            crawl_results = await asyncio.gather(*crawl_tasks, return_exceptions=True)
            for i, pts in enumerate(crawl_results):
                if isinstance(pts, list) and pts:
                    extracted_text = " | ".join(pts[:6])
                    interview_candidates[i]["snippet"] = (extracted_text + " | " + interview_candidates[i]["snippet"])[:1400]

        return combined

    async def hunt_red_flags(self, company: str) -> List[Dict[str, str]]:
        """
        Actively probes for:
        1. Bonds, service agreements, marksheet retention, delayed joining
        2. Mass layoffs, financial health, toxic culture
        3. LinkedIn corporate footprint, follower counts (<5,000), team size, and founding year
        """
        clean = company.replace('"', '').strip()
        q1 = f"{clean} service agreement bond salary"
        q2 = f"{clean} layoff delayed joining"
        q3 = f"{clean} internship conversion rate"
        q4 = f"{clean} intern PPO rate"
        q5 = f"{clean} Glassdoor reviews culture"

        r1, r2, r3, r4, r5 = await asyncio.gather(
            self._safe_search(q1, max_results=3),
            self._safe_search(q2, max_results=3),
            self._safe_search(q3, max_results=3),
            self._safe_search(q4, max_results=3),
            self._safe_search(q5, max_results=2)
        )

        seen = set()
        flags = []
        for item in r1 + r2 + r3 + r4 + r5:
            u = item.get("url", "")
            if u not in seen:
                seen.add(u)
                flags.append(item)
        return flags

search_service = SearchService()

