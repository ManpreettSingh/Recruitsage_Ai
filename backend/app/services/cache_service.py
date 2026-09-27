import asyncio
import json
import re
import time
from typing import Optional, Dict, Any, List, Tuple
import httpx
from app.config import (
    REDIS_URL,
    UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN,
    CACHE_TTL_SECONDS,
    CACHE_ENABLED
)


import hashlib


def extract_job_id(page_url: Optional[str]) -> Optional[str]:
    """
    Extracts job UUID / ID from URLs like:
    - https://recruit.thapar.edu/jobs/7324eb3d-a093-4a1e-9c51-280afef4313e
    - https://app.joinsuperset.com/#/company/abc/job/67890
    - https://www.linkedin.com/jobs/view/123456789
    - https://.../placement?job_id=xyz
    """
    if not page_url:
        return None
    cleaned = page_url.strip()
    match = re.search(r"/(?:jobs?/view/|jobs?/|drives?/|placements?/)([a-zA-Z0-9_\-\.]+)", cleaned, re.IGNORECASE)
    if match:
        return match.group(1).lower()
    param_match = re.search(r"[?&#](?:job_?id|jobId|drive_?id|notice_?id|id)=([a-zA-Z0-9_\-\.]+)", cleaned, re.IGNORECASE)
    if param_match:
        return param_match.group(1).lower()
    return None


def compute_autofill_cache_keys(page_url: Optional[str], raw_text: Optional[str] = None) -> List[str]:
    """
    Hierarchical cache keys for Autofill extraction:
    1. Job ID key: 'autofill:job:<job_id>' (e.g. from recruit portal or Superset)
    2. Canonical URL key: 'autofill:url:<clean_url>'
    3. Content hash key: 'autofill:hash:<sha256>' (if text content provided)
    """
    keys = []
    if page_url:
        job_id = extract_job_id(page_url)
        if job_id:
            keys.append(f"autofill:job:{job_id}")
        
        clean_url = page_url.strip().split("?")[0].split("#")[0].rstrip("/").lower()
        if len(clean_url) > 10:
            keys.append(f"autofill:url:{clean_url}")

    if raw_text and len(raw_text.strip()) > 60:
        norm = normalize_string(raw_text[:3000])
        text_hash = hashlib.sha256(norm.encode("utf-8")).hexdigest()[:16]
        keys.append(f"autofill:hash:{text_hash}")

    return keys


def normalize_string(text: Optional[str]) -> str:
    if not text:
        return ""
    # Collapse multiple whitespaces and lowercase
    return " ".join(text.strip().lower().split())


def compute_cache_keys(company_name: str, role: str, page_url: Optional[str] = None) -> List[str]:
    """
    Generates hierarchical cache keys:
    1. Job ID key if url matches /jobs/<id>: 'dossier:job:<uuid>'
    2. URL key if generic url provided: 'dossier:url:<clean_url>'
    3. Company & Role key: 'dossier:<company>:<role>' (e.g. 'dossier:optum:software engineer')
    """
    keys = []
    job_id = extract_job_id(page_url)
    if job_id:
        keys.append(f"dossier:job:{job_id}")
    elif page_url and page_url.strip().startswith("http"):
        clean_url = page_url.strip().split("?")[0].rstrip("/").lower()
        if len(clean_url) > 10:
            keys.append(f"dossier:url:{clean_url}")

    norm_company = normalize_string(company_name)
    norm_role = normalize_string(role) or "software engineer"
    company_role_key = f"dossier:{norm_company}:{norm_role}"
    if company_role_key not in keys:
        keys.append(company_role_key)

    return keys


class CacheService:
    def __init__(self):
        self.enabled = CACHE_ENABLED
        self.ttl = CACHE_TTL_SECONDS
        self._http_client: Optional[httpx.AsyncClient] = None
        self._redis_client = None
        self._in_memory_store: Dict[str, Tuple[str, float]] = {}
        self._in_flight_locks: Dict[str, asyncio.Event] = {}
        self._in_flight_leaders: Dict[str, bool] = {}
        self._lock = asyncio.Lock()
        
        # Stats tracking
        self.stats = {
            "hits": 0,
            "misses": 0,
            "writes": 0,
            "dedup_waits": 0,
            "mode": "in_memory"
        }
        self._determine_mode()

    def _determine_mode(self):
        if not self.enabled:
            self.stats["mode"] = "disabled"
            return

        if UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN:
            self.stats["mode"] = "upstash_rest"
            print(f"[CacheService] Active mode: Upstash REST API ({UPSTASH_REDIS_REST_URL})")
        elif REDIS_URL and (REDIS_URL.startswith("redis://") or REDIS_URL.startswith("rediss://")):
            try:
                import redis.asyncio as aioredis
                self._redis_client = aioredis.from_url(
                    REDIS_URL,
                    decode_responses=True,
                    socket_timeout=5.0,
                    socket_connect_timeout=5.0
                )
                self.stats["mode"] = "redis"
                print(f"[CacheService] Active mode: Redis Protocol")
            except ImportError:
                print("[CacheService] 'redis' package not installed; falling back to in-memory cache")
                self.stats["mode"] = "in_memory"
        else:
            self.stats["mode"] = "in_memory"
            print("[CacheService] Active mode: In-Memory TTL Cache (No Upstash/Redis credentials configured)")

    async def _get_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=8.0)
        return self._http_client

    async def get(self, keys: List[str]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """
        Tries to retrieve cached dossier by checking keys in order.
        Returns (cached_dict, matched_key) or (None, None).
        """
        if not self.enabled:
            return None, None

        for key in keys:
            raw_data = await self._raw_get(key)
            if raw_data:
                try:
                    data = json.loads(raw_data)
                    self.stats["hits"] += 1
                    print(f"[CacheService] Cache HIT for key: {key} (total hits: {self.stats['hits']})")
                    return data, key
                except Exception as e:
                    print(f"[CacheService] JSON decode error for key {key}: {e}")
        
        self.stats["misses"] += 1
        return None, None

    async def _raw_get(self, key: str) -> Optional[str]:
        # 1. Upstash REST API
        if self.stats["mode"] == "upstash_rest":
            try:
                client = await self._get_http_client()
                resp = await client.post(
                    UPSTASH_REDIS_REST_URL,
                    headers={"Authorization": f"Bearer {UPSTASH_REDIS_REST_TOKEN}"},
                    json=["GET", key]
                )
                if resp.status_code == 200:
                    result = resp.json().get("result")
                    return result if result else None
            except Exception as e:
                print(f"[CacheService] Upstash REST GET error on '{key}': {e}")
                return self._get_from_in_memory(key)

        # 2. Redis connection
        elif self.stats["mode"] == "redis" and self._redis_client:
            try:
                return await self._redis_client.get(key)
            except Exception as e:
                print(f"[CacheService] Redis GET error on '{key}': {e}")
                return self._get_from_in_memory(key)

        # 3. In-memory fallback
        return self._get_from_in_memory(key)

    def _get_from_in_memory(self, key: str) -> Optional[str]:
        entry = self._in_memory_store.get(key)
        if not entry:
            return None
        val, expiry = entry
        if time.time() > expiry:
            del self._in_memory_store[key]
            return None
        return val

    async def set(self, keys: List[str], data: Dict[str, Any], ttl_seconds: Optional[int] = None) -> bool:
        """
        Saves data under all specified keys with TTL.
        """
        if not self.enabled or not keys:
            return False

        ttl = ttl_seconds if ttl_seconds is not None else self.ttl
        try:
            serialized = json.dumps(data)
        except Exception as e:
            print(f"[CacheService] Failed to serialize data for cache: {e}")
            return False

        success = True
        for key in keys:
            # 1. Upstash REST API
            if self.stats["mode"] == "upstash_rest":
                try:
                    client = await self._get_http_client()
                    resp = await client.post(
                        UPSTASH_REDIS_REST_URL,
                        headers={"Authorization": f"Bearer {UPSTASH_REDIS_REST_TOKEN}"},
                        json=["SETEX", key, ttl, serialized]
                    )
                    if resp.status_code != 200:
                        print(f"[CacheService] Upstash REST SETEX status {resp.status_code}: {resp.text}")
                        self._set_in_memory(key, serialized, ttl)
                except Exception as e:
                    print(f"[CacheService] Upstash REST SETEX error on '{key}': {e}")
                    self._set_in_memory(key, serialized, ttl)

            # 2. Redis connection
            elif self.stats["mode"] == "redis" and self._redis_client:
                try:
                    await self._redis_client.setex(key, ttl, serialized)
                except Exception as e:
                    print(f"[CacheService] Redis SETEX error on '{key}': {e}")
                    self._set_in_memory(key, serialized, ttl)

            # 3. Always mirror to in-memory for zero-latency local lookups
            self._set_in_memory(key, serialized, ttl)

        self.stats["writes"] += len(keys)
        print(f"[CacheService] Cached under {len(keys)} key(s): {keys} (TTL: {ttl}s)")
        return success

    def _set_in_memory(self, key: str, val: str, ttl: int):
        # Prevent unbounded in-memory growth
        if len(self._in_memory_store) > 500:
            now = time.time()
            expired = [k for k, (_, exp) in self._in_memory_store.items() if now > exp]
            for k in expired:
                del self._in_memory_store[k]
        self._in_memory_store[key] = (val, time.time() + ttl)

    async def acquire_dedup_lock(self, primary_key: str) -> bool:
        """
        Thundering herd prevention.
        Returns True if the caller is the LEADER (first request, should compute).
        Returns False if caller is a FOLLOWER (concurrent request, should wait).
        """
        async with self._lock:
            if primary_key in self._in_flight_locks:
                return False  # Already in flight, follower
            event = asyncio.Event()
            self._in_flight_locks[primary_key] = event
            self._in_flight_leaders[primary_key] = True
            return True

    async def wait_for_in_flight(self, primary_key: str, timeout: float = 45.0) -> bool:
        """
        Follower coroutines wait on the leader's completion.
        """
        async with self._lock:
            event = self._in_flight_locks.get(primary_key)
        
        if not event:
            return True

        self.stats["dedup_waits"] += 1
        print(f"[CacheService] Waiting for in-flight research on '{primary_key}'...")
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            print(f"[CacheService] Timed out waiting for in-flight '{primary_key}'")
            return False

    async def release_dedup_lock(self, primary_key: str):
        """
        Leader calls this upon completing computation (or failure) to notify all waiting requests.
        """
        async with self._lock:
            event = self._in_flight_locks.pop(primary_key, None)
            self._in_flight_leaders.pop(primary_key, None)
            if event:
                event.set()

    def get_stats(self) -> Dict[str, Any]:
        return {
            **self.stats,
            "in_memory_keys_count": len(self._in_memory_store),
            "in_flight_requests_count": len(self._in_flight_locks),
            "ttl_seconds": self.ttl,
            "enabled": self.enabled
        }

    async def clear_all(self):
        self._in_memory_store.clear()
        self.stats["hits"] = 0
        self.stats["misses"] = 0
        self.stats["writes"] = 0
        if self._redis_client and self.stats["mode"] == "redis":
            try:
                await self._redis_client.flushdb()
            except Exception as e:
                print(f"[CacheService] Error flushing redis: {e}")


cache_service = CacheService()
