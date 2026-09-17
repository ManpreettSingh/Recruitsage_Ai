import asyncio
import re
import httpx
from typing import List, Dict, Any
from bs4 import BeautifulSoup
from ddgs import DDGS

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

class SearchService:
    def __init__(self):
        pass

    async def _safe_search(self, query: str, max_results: int = 4) -> List[Dict[str, str]]:
        """
        Executes a DDGS search with error handling and cleans the results.
        """
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

        return await asyncio.to_thread(run_sync)

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
                    # Search for informative paragraphs, lists, and summary cards
                    keywords = [
                        "rating", "overall rating", "work-life balance", "work life balance",
                        "job security", "salary & benefits", "salary", "appraisal", "promotions",
                        "likes:", "dislikes:", "pros", "cons", "culture", "layoff"
                    ]
                    seen = set()
                    for el in soup.find_all(["p", "div", "span", "li"]):
                        text = el.get_text(" ", strip=True)
                        t_low = text.lower()
                        if 40 < len(text) < 280 and any(k in t_low for k in keywords):
                            # Deduplicate similar text chunks
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
        """
        clean = company.replace('"', '').strip()
        q1 = f"{clean} reddit developersIndia work culture"
        q2 = f"{clean} reddit interview experience salary bond"

        res1, res2 = await asyncio.gather(
            self._safe_search(q1, max_results=4),
            self._safe_search(q2, max_results=3)
        )

        seen_urls = set()
        combined = []
        for r in res1 + res2:
            u = r.get("url", "")
            if u not in seen_urls:
                seen_urls.add(u)
                combined.append(r)
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
                summary_snippet = " | ".join(excerpts[:5])
                all_findings.insert(0, {
                    "title": f"Verified Employee Review Metrics - {clean} (AmbitionBox)",
                    "url": target_ab,
                    "snippet": summary_snippet
                })

        return all_findings

    async def hunt_red_flags(self, company: str) -> List[Dict[str, str]]:
        """
        Actively probes for bonds, service agreements, delayed joining, mass layoffs, and PIP culture.
        """
        clean = company.replace('"', '').strip()
        q1 = f"{clean} service agreement bond penalty salary"
        q2 = f"{clean} delayed joining offer revoked layoff 2024 2025"

        r1, r2 = await asyncio.gather(
            self._safe_search(q1, max_results=3),
            self._safe_search(q2, max_results=3)
        )

        seen = set()
        flags = []
        for item in r1 + r2:
            u = item.get("url", "")
            if u not in seen:
                seen.add(u)
                flags.append(item)
        return flags

search_service = SearchService()
