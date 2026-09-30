import { Request, Response, NextFunction } from "express";
import axios from "axios";
import { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } from "../config";

export const RATE_LIMIT_RULES: Record<string, [number, number]> = {
  "/api/analyze": [10, 60],
  "/api/chat": [30, 60],
  "/api/extract-drive-context": [15, 60],
  "/api/extract-pdf": [15, 60],
  "/api/extract-pdf-from-url": [15, 60],
  "/api/evaluate-mermaid": [30, 60],
  "/api/cache/clear": [5, 60],
  "/api/rag/search": [40, 60],
  "/api/campus/match": [60, 60],
};

export const DEFAULT_RATE_LIMIT: [number, number] = [120, 60];

export const EXEMPT_PREFIXES = [
  "/docs",
  "/redoc",
  "/openapi.json",
  "/api/health",
  "/api/llm/status",
  "/api/cache/stats",
  "/api/rag/stats",
];

export function getClientIp(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const clientIp = ips.split(",")[0].trim();
    if (clientIp) return clientIp;
  }

  const realIp = req.headers["x-real-ip"];
  if (realIp) {
    return (Array.isArray(realIp) ? realIp[0] : realIp).trim();
  }

  const cfIp = req.headers["cf-connecting-ip"];
  if (cfIp) {
    return (Array.isArray(cfIp) ? cfIp[0] : cfIp).trim();
  }

  return req.ip || req.socket.remoteAddress || "unknown-client";
}

export class DistributedRateLimiter {
  private localWindows: Map<string, number[]> = new Map();
  private lastCleanup: number = Date.now();
  private upstashUrl: string = UPSTASH_REDIS_REST_URL.replace(/\/+$/, "");
  private upstashToken: string = UPSTASH_REDIS_REST_TOKEN;
  private useUpstash: boolean = Boolean(this.upstashUrl && this.upstashToken);

  private cleanupExpired(now: number): void {
    if (now - this.lastCleanup < 300000) return; // 5 min
    for (const [key, timestamps] of this.localWindows.entries()) {
      const valid = timestamps.filter((t) => now - t < 120000);
      if (valid.length > 0) {
        this.localWindows.set(key, valid);
      } else {
        this.localWindows.delete(key);
      }
    }
    this.lastCleanup = now;
  }

  private checkLocal(
    clientIp: string,
    path: string,
    maxRequests: number,
    windowSeconds: number
  ): [boolean, number, number, number] {
    const key = `${clientIp}:${path}`;
    const now = Date.now();
    this.cleanupExpired(now);

    const cutoff = now - windowSeconds * 1000;
    const existing = this.localWindows.get(key) || [];
    const timestamps = existing.filter((t) => t > cutoff);

    if (timestamps.length >= maxRequests) {
      const oldest = timestamps[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowSeconds * 1000 - now) / 1000));
      this.localWindows.set(key, timestamps);
      return [false, maxRequests, 0, retryAfter];
    }

    timestamps.push(now);
    this.localWindows.set(key, timestamps);
    const remaining = Math.max(0, maxRequests - timestamps.length);
    return [true, maxRequests, remaining, 0];
  }

  private async checkUpstash(
    clientIp: string,
    path: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<[boolean, number, number, number] | null> {
    const redisKey = `rl:${clientIp}:${path}`;
    const headers = { Authorization: `Bearer ${this.upstashToken}` };
    const body = [
      ["INCR", redisKey],
      ["EXPIRE", redisKey, windowSeconds, "NX"],
      ["TTL", redisKey],
    ];

    try {
      const res = await axios.post(`${this.upstashUrl}/pipeline`, body, {
        headers,
        timeout: 1500,
      });

      if (res.status === 200 && Array.isArray(res.data)) {
        const count = parseInt(res.data[0]?.result || "1", 10);
        let ttl = parseInt(res.data[2]?.result || `${windowSeconds}`, 10);
        if (ttl <= 0) ttl = windowSeconds;

        if (count > maxRequests) {
          return [false, maxRequests, 0, ttl];
        }

        const remaining = Math.max(0, maxRequests - count);
        return [true, maxRequests, remaining, 0];
      }
    } catch {
      // Fallback to local
    }

    return null;
  }

  async checkRateLimit(clientIp: string, path: string): Promise<[boolean, number, number, number]> {
    const rule = RATE_LIMIT_RULES[path] || DEFAULT_RATE_LIMIT;
    const [maxRequests, windowSeconds] = rule;

    if (this.useUpstash) {
      const result = await this.checkUpstash(clientIp, path, maxRequests, windowSeconds);
      if (result !== null) return result;
    }

    return this.checkLocal(clientIp, path, maxRequests, windowSeconds);
  }
}

export const rateLimiter = new DistributedRateLimiter();

export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  const path = req.path;
  if (path === "/" || EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    next();
    return;
  }

  const clientIp = getClientIp(req);
  const [isAllowed, limit, remaining, retryAfter] = await rateLimiter.checkRateLimit(clientIp, path);

  if (!isAllowed) {
    res.status(429).json({
      detail: "Rate limit exceeded. Please wait before making further requests.",
      retry_after: retryAfter,
      limit,
      endpoint: path,
    });
    return;
  }

  res.setHeader("X-RateLimit-Limit", limit.toString());
  res.setHeader("X-RateLimit-Remaining", remaining.toString());
  next();
}
