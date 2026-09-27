import time
import asyncio
from typing import Dict, List, Tuple, Optional
from collections import defaultdict
import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from app.config import UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

# Tier configurations: (max_requests, window_seconds)
RATE_LIMIT_RULES: Dict[str, Tuple[int, int]] = {
    "/api/analyze": (10, 60),               # 10 req/min for deep multi-agent LLM analysis
    "/api/chat": (30, 60),                  # 30 req/min for conversational doubt solving
    "/api/extract-drive-context": (15, 60), # 15 req/min for external web extraction
    "/api/extract-pdf": (15, 60),           # 15 req/min for PDF document parsing
    "/api/extract-pdf-from-url": (15, 60),  # 15 req/min for remote PDF downloading
    "/api/evaluate-mermaid": (30, 60),      # 30 req/min for Mermaid diagram fixes
    "/api/cache/clear": (5, 60),            # 5 req/min for cache clearing
    "/api/rag/search": (40, 60),            # 40 req/min for semantic RAG lookups
    "/api/campus/match": (60, 60),          # 60 req/min for placement directory matches
}

DEFAULT_RATE_LIMIT = (120, 60)              # 120 req/min default for any other endpoints

EXEMPT_PREFIXES = [
    "/docs",
    "/redoc",
    "/openapi.json",
    "/api/health",
    "/api/llm/status",
    "/api/cache/stats",
    "/api/rag/stats"
]

def get_client_ip(request: Request) -> str:
    """
    Extracts client IP from proxy headers (Nginx X-Forwarded-For, X-Real-IP)
    with fallback to connection host.
    """
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        # Take the leftmost IP (the original client)
        client_ip = forwarded_for.split(",")[0].strip()
        if client_ip:
            return client_ip

    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()

    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()

    if request.client and request.client.host:
        return request.client.host

    return "unknown-client"

class DistributedRateLimiter:
    """
    Production Rate Limiter supporting:
    1. Distributed Upstash Redis REST token/fixed-window counter (synchronizes across all Uvicorn workers)
    2. Local thread-safe in-memory sliding window fallback if Redis is unavailable or unconfigured
    """
    def __init__(self):
        self._lock = asyncio.Lock()
        self._local_windows: Dict[str, List[float]] = defaultdict(list)
        self._last_cleanup = time.time()
        self.upstash_url = UPSTASH_REDIS_REST_URL.rstrip("/") if UPSTASH_REDIS_REST_URL else ""
        self.upstash_token = UPSTASH_REDIS_REST_TOKEN
        self.use_upstash = bool(self.upstash_url and self.upstash_token)

    def _cleanup_expired(self, now: float):
        if now - self._last_cleanup < 300:
            return
        keys_to_delete = []
        for key, timestamps in self._local_windows.items():
            valid = [t for t in timestamps if now - t < 120]
            if valid:
                self._local_windows[key] = valid
            else:
                keys_to_delete.append(key)
        for k in keys_to_delete:
            del self._local_windows[k]
        self._last_cleanup = now

    async def _check_local(self, client_ip: str, path: str, max_requests: int, window_seconds: int) -> Tuple[bool, int, int, int]:
        key = f"{client_ip}:{path}"
        now = time.time()
        async with self._lock:
            self._cleanup_expired(now)
            cutoff = now - window_seconds
            timestamps = [t for t in self._local_windows[key] if t > cutoff]
            if len(timestamps) >= max_requests:
                oldest = timestamps[0]
                retry_after = max(1, int(oldest + window_seconds - now))
                self._local_windows[key] = timestamps
                return False, max_requests, 0, retry_after

            timestamps.append(now)
            self._local_windows[key] = timestamps
            remaining = max(0, max_requests - len(timestamps))
            return True, max_requests, remaining, 0

    async def _check_upstash(self, client_ip: str, path: str, max_requests: int, window_seconds: int) -> Optional[Tuple[bool, int, int, int]]:
        redis_key = f"rl:{client_ip}:{path}"
        headers = {"Authorization": f"Bearer {self.upstash_token}"}
        # Pipeline: INCR + EXPIRE (NX) + TTL
        body = [
            ["INCR", redis_key],
            ["EXPIRE", redis_key, window_seconds, "NX"],
            ["TTL", redis_key]
        ]
        try:
            async with httpx.AsyncClient(timeout=1.5) as client:
                res = await client.post(f"{self.upstash_url}/pipeline", json=body, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    current_count = int(data[0].get("result", 1))
                    ttl = int(data[2].get("result", window_seconds))
                    if ttl <= 0:
                        ttl = window_seconds

                    if current_count > max_requests:
                        return False, max_requests, 0, ttl

                    remaining = max(0, max_requests - current_count)
                    return True, max_requests, remaining, 0
        except Exception:
            # Fall back smoothly to local in-memory
            pass
        return None

    async def check_rate_limit(self, client_ip: str, path: str) -> Tuple[bool, int, int, int]:
        rule = RATE_LIMIT_RULES.get(path, DEFAULT_RATE_LIMIT)
        max_requests, window_seconds = rule

        if self.use_upstash:
            result = await self._check_upstash(client_ip, path, max_requests, window_seconds)
            if result is not None:
                return result

        return await self._check_local(client_ip, path, max_requests, window_seconds)

# Global singleton
rate_limiter = DistributedRateLimiter()

class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        if path == "/" or any(path.startswith(prefix) for prefix in EXEMPT_PREFIXES):
            return await call_next(request)

        client_ip = get_client_ip(request)
        is_allowed, limit, remaining, retry_after = await rate_limiter.check_rate_limit(client_ip, path)

        if not is_allowed:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Rate limit exceeded. Please wait before making further requests.",
                    "retry_after": retry_after,
                    "limit": limit,
                    "endpoint": path
                },
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(retry_after)
                }
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
