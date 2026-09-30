import crypto from "crypto";
import axios from "axios";
import {
  UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN,
  CACHE_TTL_SECONDS,
  CACHE_ENABLED,
} from "../config";

export function extractJobId(pageUrl?: string): string | null {
  if (!pageUrl) return null;
  const cleaned = pageUrl.trim();
  const match = cleaned.match(/\/(?:jobs?\/view\/|jobs?\/|drives?\/|placements?\/)([a-zA-Z0-9_\-\.]+)/i);
  if (match) return match[1].toLowerCase();

  const paramMatch = cleaned.match(/[?&#](?:job_?id|jobId|drive_?id|notice_?id|id)=([a-zA-Z0-9_\-\.]+)/i);
  if (paramMatch) return paramMatch[1].toLowerCase();

  return null;
}

export function normalizeString(text?: string): string {
  if (!text) return "";
  return text.trim().toLowerCase().split(/\s+/).join(" ");
}

export function computeAutofillCacheKeys(pageUrl?: string, rawText?: string): string[] {
  const keys: string[] = [];
  if (pageUrl) {
    const jobId = extractJobId(pageUrl);
    if (jobId) {
      keys.push(`autofill:job:${jobId}`);
    }
    const cleanUrl = pageUrl.trim().split("?")[0].split("#")[0].replace(/\/+$/, "").toLowerCase();
    if (cleanUrl.length > 10) {
      keys.push(`autofill:url:${cleanUrl}`);
    }
  }

  if (rawText && rawText.trim().length > 60) {
    const norm = normalizeString(rawText.slice(0, 3000));
    const textHash = crypto.createHash("sha256").update(norm, "utf8").digest("hex").slice(0, 16);
    keys.push(`autofill:hash:${textHash}`);
  }

  return keys;
}

export function computeCacheKeys(companyName: string, role: string, pageUrl?: string): string[] {
  const keys: string[] = [];
  const jobId = extractJobId(pageUrl);
  if (jobId) {
    keys.push(`dossier:job:${jobId}`);
  } else if (pageUrl && pageUrl.trim().startsWith("http")) {
    const cleanUrl = pageUrl.trim().split("?")[0].replace(/\/+$/, "").toLowerCase();
    if (cleanUrl.length > 10) {
      keys.push(`dossier:url:${cleanUrl}`);
    }
  }

  const normCompany = normalizeString(companyName);
  const normRole = normalizeString(role) || "software engineer";
  const companyRoleKey = `dossier:${normCompany}:${normRole}`;
  if (!keys.includes(companyRoleKey)) {
    keys.push(companyRoleKey);
  }

  return keys;
}

export class CacheService {
  public enabled: boolean = CACHE_ENABLED;
  public ttl: number = CACHE_TTL_SECONDS;
  private inMemoryStore: Map<string, { val: string; expiry: number }> = new Map();
  private inFlightLocks: Map<string, Array<() => void>> = new Map();
  private inFlightLeaders: Map<string, boolean> = new Map();

  public stats = {
    hits: 0,
    misses: 0,
    writes: 0,
    dedup_waits: 0,
    mode: "in_memory",
  };

  constructor() {
    this.determineMode();
  }

  private determineMode(): void {
    if (!this.enabled) {
      this.stats.mode = "disabled";
      return;
    }

    if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
      this.stats.mode = "upstash_rest";
      console.log(`[CacheService] Active mode: Upstash REST API (${UPSTASH_REDIS_REST_URL})`);
    } else {
      this.stats.mode = "in_memory";
      console.log("[CacheService] Active mode: In-Memory TTL Cache");
    }
  }

  async get(keys: string[]): Promise<[Record<string, any> | null, string | null]> {
    if (!this.enabled) return [null, null];

    for (const key of keys) {
      const raw = await this.rawGet(key);
      if (raw) {
        try {
          const data = JSON.parse(raw);
          this.stats.hits++;
          console.log(`[CacheService] Cache HIT for key: ${key} (total hits: ${this.stats.hits})`);
          return [data, key];
        } catch (e: any) {
          console.error(`[CacheService] JSON decode error for key ${key}: ${e.message}`);
        }
      }
    }

    this.stats.misses++;
    return [null, null];
  }

  private async rawGet(key: string): Promise<string | null> {
    if (this.stats.mode === "upstash_rest") {
      try {
        const resp = await axios.post(
          UPSTASH_REDIS_REST_URL,
          ["GET", key],
          {
            headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
            timeout: 5000,
          }
        );
        if (resp.status === 200 && resp.data?.result) {
          return resp.data.result;
        }
      } catch (e: any) {
        return this.getFromInMemory(key);
      }
    }

    return this.getFromInMemory(key);
  }

  private getFromInMemory(key: string): string | null {
    const entry = this.inMemoryStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.inMemoryStore.delete(key);
      return null;
    }
    return entry.val;
  }

  async set(keys: string[], data: Record<string, any>, ttlSeconds?: number): Promise<boolean> {
    if (!this.enabled || !keys.length) return false;
    const ttl = ttlSeconds !== undefined ? ttlSeconds : this.ttl;

    let serialized: string;
    try {
      serialized = JSON.stringify(data);
    } catch {
      return false;
    }

    for (const key of keys) {
      if (this.stats.mode === "upstash_rest") {
        try {
          await axios.post(
            UPSTASH_REDIS_REST_URL,
            ["SETEX", key, ttl, serialized],
            {
              headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
              timeout: 5000,
            }
          );
        } catch {
          this.setInMemory(key, serialized, ttl);
        }
      }
      this.setInMemory(key, serialized, ttl);
    }

    this.stats.writes += keys.length;
    console.log(`[CacheService] Cached under ${keys.length} key(s): ${JSON.stringify(keys)} (TTL: ${ttl}s)`);
    return true;
  }

  private setInMemory(key: string, val: string, ttlSeconds: number): void {
    if (this.inMemoryStore.size > 500) {
      const now = Date.now();
      for (const [k, v] of this.inMemoryStore.entries()) {
        if (now > v.expiry) this.inMemoryStore.delete(k);
      }
    }
    this.inMemoryStore.set(key, { val, expiry: Date.now() + ttlSeconds * 1000 });
  }

  async acquireDedupLock(primaryKey: string): Promise<boolean> {
    if (this.inFlightLocks.has(primaryKey)) {
      return false; // Follower
    }
    this.inFlightLocks.set(primaryKey, []);
    this.inFlightLeaders.set(primaryKey, true);
    return true; // Leader
  }

  async waitForInFlight(primaryKey: string, timeoutMs: number = 45000): Promise<boolean> {
    const waiters = this.inFlightLocks.get(primaryKey);
    if (!waiters) return true;

    this.stats.dedup_waits++;
    console.log(`[CacheService] Waiting for in-flight research on '${primaryKey}'...`);

    return new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log(`[CacheService] Timed out waiting for in-flight '${primaryKey}'`);
          resolve(false);
        }
      }, timeoutMs);

      waiters.push(() => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(true);
        }
      });
    });
  }

  async releaseDedupLock(primaryKey: string): Promise<void> {
    const waiters = this.inFlightLocks.get(primaryKey);
    this.inFlightLocks.delete(primaryKey);
    this.inFlightLeaders.delete(primaryKey);

    if (waiters) {
      for (const fn of waiters) {
        try {
          fn();
        } catch {}
      }
    }
  }

  getStats(): Record<string, any> {
    return {
      ...this.stats,
      in_memory_keys_count: this.inMemoryStore.size,
      in_flight_requests_count: this.inFlightLocks.size,
      ttl_seconds: this.ttl,
      enabled: this.enabled,
    };
  }

  async clearAll(): Promise<void> {
    this.inMemoryStore.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.writes = 0;

    if (this.stats.mode === "upstash_rest") {
      try {
        await axios.post(
          UPSTASH_REDIS_REST_URL,
          ["FLUSHDB"],
          {
            headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
            timeout: 5000,
          }
        );
      } catch (e: any) {
        console.warn(`[CacheService] Error flushing Upstash: ${e.message}`);
      }
    }
  }
}

export const cacheService = new CacheService();
