import axios from "axios";
import * as cheerio from "cheerio";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export class SearchService {
  private tavilyKey: string = (process.env.TAVILY_API_KEY || "").trim();
  private cache: Map<string, { timestamp: number; results: SearchResult[] }> = new Map();
  private cacheTtl: number = 3600 * 1000; // 1 hour

  private async safeSearch(query: string, maxResults: number = 4): Promise<SearchResult[]> {
    const normQuery = query.toLowerCase().split(/\s+/).join(" ");
    const now = Date.now();

    const cached = this.cache.get(normQuery);
    if (cached && now - cached.timestamp < this.cacheTtl) {
      return [...cached.results];
    }

    const results: SearchResult[] = [];

    // Try DuckDuckGo HTML search
    try {
      const resp = await axios.post(
        "https://html.duckduckgo.com/html/",
        new URLSearchParams({ q: query }).toString(),
        {
          headers: {
            ...BROWSER_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          timeout: 6000,
        }
      );

      if (resp.status === 200 && resp.data) {
        const $ = cheerio.load(resp.data);
        $(".result").each((_, el) => {
          if (results.length >= maxResults) return;
          const title = $(el).find(".result__title .result__a").text().trim();
          let href = $(el).find(".result__title .result__a").attr("href") || "";
          const snippet = $(el).find(".result__snippet").text().trim();

          // DuckDuckGo redirects often look like /l/?uddg=https%3A%2F%2F...
          if (href.includes("uddg=")) {
            const match = href.match(/uddg=([^&]+)/);
            if (match) {
              href = decodeURIComponent(match[1]);
            }
          }

          if (href && (title || snippet)) {
            results.push({ title, url: href, snippet });
          }
        });
      }
    } catch (e: any) {
      // Fallback silently if offline or blocked
    }

    if (results.length > 0) {
      this.cache.set(normQuery, { timestamp: now, results });
    }
    return results;
  }

  private async searchTavily(query: string, maxResults: number = 4): Promise<SearchResult[]> {
    if (!this.tavilyKey) return [];
    try {
      const res = await axios.post(
        "https://api.tavily.com/search",
        {
          api_key: this.tavilyKey,
          query,
          search_depth: "advanced",
          max_results: maxResults,
          include_answer: false,
        },
        { timeout: 10000 }
      );
      if (res.status === 200 && Array.isArray(res.data?.results)) {
        return res.data.results.map((r: any) => ({
          title: r.title || "",
          url: r.url || "",
          snippet: (r.content || "").slice(0, 1500),
        }));
      }
    } catch {}
    return [];
  }

  private async scrapeRedditThread(url: string): Promise<string> {
    try {
      const cleanUrl = url.split("?")[0].replace(/\/+$/, "");
      if (cleanUrl.includes("/comments/")) {
        const jsonUrl = cleanUrl + ".json";
        const res = await axios.get(jsonUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Accept: "application/json",
          },
          timeout: 6000,
        });

        if (res.status === 200 && Array.isArray(res.data) && res.data[0]) {
          const post = res.data[0].data?.children?.[0]?.data || {};
          const title = post.title || "";
          const selftext = post.selftext || "";

          const commentsText: string[] = [];
          if (res.data.length > 1 && Array.isArray(res.data[1].data?.children)) {
            for (const c of res.data[1].data.children.slice(0, 5)) {
              const body = (c.data?.body || "").trim();
              if (body && body.length > 25 && !body.startsWith("I am a bot") && body !== "[deleted]") {
                commentsText.push(body.slice(0, 500));
              }
            }
          }

          let combined = `Post: ${title}\n${selftext.slice(0, 600)}\n`;
          if (commentsText.length > 0) {
            combined += "Top Developer Comments:\n" + commentsText.slice(0, 3).join("\n---\n");
          }
          return combined.trim();
        }
      }

      // HTML scrape fallback
      const res = await axios.get(url, { headers: BROWSER_HEADERS, timeout: 6000 });
      if (res.status === 200) {
        const $ = cheerio.load(res.data);
        const paras: string[] = [];
        $("p").each((_, el) => {
          const t = $(el).text().trim();
          if (t.length > 35) paras.push(t);
        });
        if (paras.length > 0) return paras.slice(0, 5).join(" | ").slice(0, 1200);
      }
    } catch {}
    return "";
  }

  private async scrapeReviewPage(url: string): Promise<string[]> {
    const excerpts: string[] = [];
    try {
      const res = await axios.get(url, { headers: BROWSER_HEADERS, timeout: 8000 });
      if (res.status === 200) {
        const $ = cheerio.load(res.data);
        const keywords = [
          "rating", "overall rating", "work-life balance", "work life balance",
          "job security", "salary & benefits", "salary", "appraisal", "promotions",
          "likes:", "dislikes:", "pros", "cons", "culture", "layoff",
        ];
        const seen = new Set<string>();

        $("p, div, span, li").each((_, el) => {
          const text = $(el).text().trim();
          const tLow = text.toLowerCase();
          if (text.length > 40 && text.length < 320 && keywords.some((k) => tLow.includes(k))) {
            const cleanSub = text.slice(0, 50);
            if (!seen.has(cleanSub)) {
              seen.add(cleanSub);
              excerpts.push(text);
              if (excerpts.length >= 8) return false;
            }
          }
        });
      }
    } catch {}
    return excerpts;
  }

  private async scrapeInterviewPage(url: string): Promise<string[]> {
    const points: string[] = [];
    try {
      const res = await axios.get(url, { headers: BROWSER_HEADERS, timeout: 8000 });
      if (res.status === 200) {
        const $ = cheerio.load(res.data);
        const keywords = [
          "round", "question", "coding", "technical", "assessment", "dsa",
          "leetcode", "topics", "experience", "test pattern", "hackerrank",
          "mettl", "codesignal", "syllabus", "interview",
        ];
        const seen = new Set<string>();

        $("h2, h3, p, li").each((_, el) => {
          const text = $(el).text().trim();
          const tLow = text.toLowerCase();
          if (text.length > 25 && text.length < 400 && keywords.some((k) => tLow.includes(k))) {
            const cleanSub = text.slice(0, 60);
            if (!seen.has(cleanSub)) {
              seen.add(cleanSub);
              points.push(text);
              if (points.length >= 10) return false;
            }
          }
        });
      }
    } catch {}
    return points;
  }

  async getRedditDiscussions(company: string, role: string = ""): Promise<SearchResult[]> {
    const clean = company.replace(/"/g, "").trim();

    const tavilyPromise = this.searchTavily(`${clean} developersIndia reddit work culture interview salary`, 3);
    const q1 = `${clean} reddit developersIndia work culture`;
    const q2 = `${clean} reddit interview experience salary bond`;

    const [tavilyRes, res1, res2] = await Promise.all([
      tavilyPromise,
      this.safeSearch(q1, 4),
      this.safeSearch(q2, 3),
    ]);

    const seenUrls = new Set<string>();
    const combined: SearchResult[] = [];
    for (const r of [...tavilyRes, ...res1, ...res2]) {
      if (r.url && !seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        combined.push(r);
      }
    }

    const redditCandidates = combined.filter((r) => r.url.includes("reddit.com")).slice(0, 3);
    if (redditCandidates.length > 0) {
      await Promise.all(
        redditCandidates.map(async (rc) => {
          const scraped = await this.scrapeRedditThread(rc.url);
          if (scraped) rc.snippet = scraped;
        })
      );
    }

    return combined;
  }

  async getGlassdoorAmbitionboxReviews(company: string, role: string = ""): Promise<SearchResult[]> {
    const clean = company.replace(/"/g, "").trim();
    const qAb = `${clean} AmbitionBox reviews overview rating`;
    const qGd = `${clean} Glassdoor reviews pros cons India`;

    const [abResults, gdResults] = await Promise.all([
      this.safeSearch(qAb, 3),
      this.safeSearch(qGd, 3),
    ]);

    const allFindings = [...abResults, ...gdResults];
    const abUrls = abResults.filter((r) => r.url.includes("ambitionbox.com")).map((r) => r.url);
    if (abUrls.length > 0) {
      const targetAb = abUrls[0];
      const excerpts = await this.scrapeReviewPage(targetAb);
      if (excerpts.length > 0) {
        allFindings.unshift({
          title: `Verified Employee Review Metrics - ${clean} (AmbitionBox)`,
          url: targetAb,
          snippet: excerpts.slice(0, 6).join(" | "),
        });
      }
    }

    return allFindings;
  }

  async getInterviewAndPrepIntel(company: string, role: string = "", skills?: string[]): Promise<SearchResult[]> {
    const clean = company.replace(/"/g, "").trim();
    const cleanRole = (role || "software engineer").replace(/"/g, "").trim();
    const roleWord = cleanRole.split(/\s+/)[0] || "";

    const tavilyQ = `${clean} ${cleanRole} interview questions coding online assessment`.trim();
    const tavilyPromise = this.searchTavily(tavilyQ, 4);

    const q1 = `${clean} interview questions`;
    const q2 = `${clean} interview experience`;
    const q3 = `${clean} AmbitionBox interview`;
    const q4 = roleWord ? `${clean} ${roleWord} interview` : `${clean} technical interview`;

    const [tavilyRes, r1, r2, r3, r4] = await Promise.all([
      tavilyPromise,
      this.safeSearch(q1, 3),
      this.safeSearch(q2, 3),
      this.safeSearch(q3, 3),
      this.safeSearch(q4, 3),
    ]);

    const seenUrls = new Set<string>();
    const combined: SearchResult[] = [];
    for (const r of [...tavilyRes, ...r1, ...r2, ...r3, ...r4]) {
      if (r.url && !seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        combined.push(r);
      }
    }

    const interviewCandidates = combined.filter((r) =>
      ["geeksforgeeks.org", "leetcode.com", "glassdoor", "ambitionbox", "codinginterview"].some((dom) =>
        r.url.toLowerCase().includes(dom)
      )
    ).slice(0, 2);

    if (interviewCandidates.length > 0) {
      await Promise.all(
        interviewCandidates.map(async (ic) => {
          const pts = await this.scrapeInterviewPage(ic.url);
          if (pts.length > 0) {
            ic.snippet = (pts.slice(0, 6).join(" | ") + " | " + ic.snippet).slice(0, 1400);
          }
        })
      );
    }

    return combined;
  }

  async huntRedFlags(company: string): Promise<SearchResult[]> {
    const clean = company.replace(/"/g, "").trim();
    const q1 = `${clean} service agreement bond salary`;
    const q2 = `${clean} layoff delayed joining`;
    const q3 = `${clean} internship conversion rate`;
    const q4 = `${clean} intern PPO rate`;
    const q5 = `${clean} Glassdoor reviews culture`;

    const [r1, r2, r3, r4, r5] = await Promise.all([
      this.safeSearch(q1, 3),
      this.safeSearch(q2, 3),
      this.safeSearch(q3, 3),
      this.safeSearch(q4, 3),
      this.safeSearch(q5, 2),
    ]);

    const seen = new Set<string>();
    const flags: SearchResult[] = [];
    for (const item of [...r1, ...r2, ...r3, ...r4, ...r5]) {
      if (item.url && !seen.has(item.url)) {
        seen.add(item.url);
        flags.push(item);
      }
    }
    return flags;
  }
}

export const searchService = new SearchService();
