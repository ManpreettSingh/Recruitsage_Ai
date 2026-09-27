import ipaddress
import socket
from urllib.parse import urlparse
from typing import Optional
import httpx
from fastapi import HTTPException

# Disallowed IP networks: Private, Loopback, Link-Local (AWS metadata 169.254.169.254), Multicast, Reserved
DISALLOWED_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),          # "This host on this network"
    ipaddress.ip_network("10.0.0.0/8"),         # RFC 1918 Private
    ipaddress.ip_network("100.64.0.0/10"),      # Shared Address Space (CGNAT)
    ipaddress.ip_network("127.0.0.0/8"),        # Loopback
    ipaddress.ip_network("169.254.0.0/16"),     # Link-Local (Cloud metadata 169.254.169.254)
    ipaddress.ip_network("172.16.0.0/12"),      # RFC 1918 Private
    ipaddress.ip_network("192.0.0.0/24"),       # IETF Protocol Assignments
    ipaddress.ip_network("192.0.2.0/24"),       # TEST-NET-1
    ipaddress.ip_network("192.168.0.0/16"),     # RFC 1918 Private
    ipaddress.ip_network("198.18.0.0/15"),      # Network Interconnect Device Benchmark Testing
    ipaddress.ip_network("198.51.100.0/24"),    # TEST-NET-2
    ipaddress.ip_network("203.0.113.0/24"),     # TEST-NET-3
    ipaddress.ip_network("224.0.0.0/4"),        # Multicast
    ipaddress.ip_network("240.0.0.0/4"),        # Reserved
    ipaddress.ip_network("255.255.255.255/32"), # Broadcast
    # IPv6 ranges
    ipaddress.ip_network("::/128"),             # Unspecified
    ipaddress.ip_network("::1/128"),           # Loopback
    ipaddress.ip_network("fc00::/7"),           # Unique Local Address (ULA)
    ipaddress.ip_network("fe80::/10"),          # Link-Local Unicast
    ipaddress.ip_network("ff00::/8"),           # Multicast
]

def is_ip_disallowed(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Checks if an IP address belongs to any private, loopback, or cloud-metadata network."""
    if (
        ip.is_private or
        ip.is_loopback or
        ip.is_link_local or
        ip.is_multicast or
        ip.is_reserved or
        ip.is_unspecified
    ):
        return True
    for net in DISALLOWED_NETWORKS:
        if ip in net:
            return True
    return False

def validate_safe_url(url: str) -> None:
    """
    Validates that a URL uses http/https and does NOT resolve to local/internal/cloud metadata IPs.
    Prevents Server-Side Request Forgery (SSRF).
    """
    if not url or not isinstance(url, str):
        raise HTTPException(status_code=400, detail="URL must be a non-empty string.")

    url_str = url.strip()
    try:
        parsed = urlparse(url_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed URL.")

    if parsed.scheme.lower() not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only HTTP and HTTPS URLs are permitted.")

    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(status_code=400, detail="URL missing valid hostname.")

    # Block well-known metadata or local hostnames immediately
    lower_host = hostname.lower()
    if lower_host in ("localhost", "metadata.google.internal", "instance-data", "kubernetes.default"):
        raise HTTPException(status_code=400, detail="Access to internal/loopback hostname is prohibited.")

    # If hostname is a literal IP address (e.g. 169.254.169.254 or 127.0.0.1)
    try:
        ip_obj = ipaddress.ip_address(hostname)
        if is_ip_disallowed(ip_obj):
            raise HTTPException(
                status_code=400,
                detail=f"Target URL points to restricted IP ({hostname}). Prohibited."
            )
        return
    except ValueError:
        pass

    # Resolve hostname to all associated IP addresses
    try:
        addr_info = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
        for info in addr_info:
            sockaddr = info[4]
            ip_str = sockaddr[0]
            try:
                ip_obj = ipaddress.ip_address(ip_str)
                if is_ip_disallowed(ip_obj):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Target URL resolves to restricted network IP ({ip_str}). Prohibited."
                    )
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid IP address encountered in DNS resolution.")
    except socket.gaierror:
        # If running in isolated sandbox or offline environment, let it raise or handle
        raise HTTPException(status_code=400, detail=f"Could not resolve hostname '{hostname}'.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"DNS resolution failure: {str(e)}")

async def safe_http_fetch(
    url: str,
    timeout: float = 15.0,
    max_redirects: int = 3,
    max_bytes: int = 25 * 1024 * 1024,
    headers: Optional[dict] = None
) -> httpx.Response:
    """
    Safely executes an outbound HTTP GET request with SSRF validation at every hop,
    redirect limits, and payload size bounds.
    """
    current_url = url.strip()
    redirect_count = 0
    req_headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept": "*/*"
    }
    if headers:
        req_headers.update(headers)

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        while True:
            # Validate URL at every hop (stops open redirect SSRF attacks)
            validate_safe_url(current_url)

            resp = await client.get(current_url, headers=req_headers)

            if resp.status_code in (301, 302, 303, 307, 308):
                redirect_count += 1
                if redirect_count > max_redirects:
                    raise HTTPException(status_code=400, detail="Too many redirects encountered.")
                loc = resp.headers.get("Location")
                if not loc:
                    raise HTTPException(status_code=400, detail="Redirect response missing Location header.")
                
                # Resolve relative redirect URLs
                if loc.startswith("/"):
                    parsed = urlparse(current_url)
                    current_url = f"{parsed.scheme}://{parsed.netloc}{loc}"
                else:
                    current_url = loc
                continue

            # Check response size limit
            content_length = resp.headers.get("Content-Length")
            if content_length and int(content_length) > max_bytes:
                raise HTTPException(status_code=400, detail=f"Response exceeds maximum allowed size of {max_bytes // (1024*1024)} MB.")

            if len(resp.content) > max_bytes:
                raise HTTPException(status_code=400, detail=f"Response body exceeds maximum allowed size of {max_bytes // (1024*1024)} MB.")

            return resp
