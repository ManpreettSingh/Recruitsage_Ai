import dns from "dns/promises";
import net from "net";
import { URL } from "url";
import axios, { AxiosResponse } from "axios";

// Disallowed IP ranges (private, loopback, link-local, cloud metadata)
function isDisallowedIP(ip: string): boolean {
  if (!ip) return true;

  // Clean IPv6 brackets or mapped IPv4
  if (ip.startsWith("::ffff:")) {
    ip = ip.substring(7);
  }

  if (ip === "::1" || ip === "0.0.0.0" || ip === "::") {
    return true;
  }

  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map((n) => parseInt(n, 10));
    if (parts.length !== 4) return true;

    // 0.0.0.0/8
    if (parts[0] === 0) return true;
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 100.64.0.0/10 (CGNAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (Link-Local / AWS metadata 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.0.0.0/24, 192.0.2.0/24
    if (parts[0] === 192 && parts[1] === 0) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 198.18.0.0/15
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    // 198.51.100.0/24
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
    // 203.0.113.0/24
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (parts[0] >= 224) return true;

    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // Unique local address fc00::/7
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    // Link local fe80::/10
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
    // Multicast ff00::/8
    if (lower.startsWith("ff")) return true;
    return false;
  }

  return true;
}

export async function validateSafeUrl(urlStr: string): Promise<void> {
  if (!urlStr || typeof urlStr !== "string") {
    throw new Error("URL must be a non-empty string.");
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    throw new Error("Malformed URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are permitted.");
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    throw new Error("URL missing valid hostname.");
  }

  const lowerHost = hostname.toLowerCase();
  if (["localhost", "metadata.google.internal", "instance-data", "kubernetes.default"].includes(lowerHost)) {
    throw new Error("Access to internal/loopback hostname is prohibited.");
  }

  // If hostname is literal IP
  if (net.isIP(hostname)) {
    if (isDisallowedIP(hostname)) {
      throw new Error(`Target URL points to restricted IP (${hostname}). Prohibited.`);
    }
    return;
  }

  // DNS resolution check
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const addr of addresses) {
      if (isDisallowedIP(addr.address)) {
        throw new Error(`Target URL resolves to restricted network IP (${addr.address}). Prohibited.`);
      }
    }
  } catch (err: any) {
    if (err.message && err.message.includes("restricted")) {
      throw err;
    }
    throw new Error(`Could not resolve hostname '${hostname}': ${err.message}`);
  }
}

export interface SafeFetchResponse {
  status_code: number;
  text: string;
  content: Buffer;
  headers: Record<string, string>;
}

export async function safeHttpFetch(
  url: string,
  options: {
    timeout?: number;
    max_redirects?: number;
    max_bytes?: number;
    headers?: Record<string, string>;
  } = {}
): Promise<SafeFetchResponse> {
  const timeout = (options.timeout || 15.0) * 1000;
  const maxRedirects = options.max_redirects ?? 3;
  const maxBytes = options.max_bytes || 25 * 1024 * 1024;
  let currentUrl = url.trim();
  let redirectCount = 0;

  const reqHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    Accept: "*/*",
    ...(options.headers || {}),
  };

  while (true) {
    await validateSafeUrl(currentUrl);

    let res: AxiosResponse;
    try {
      res = await axios.get(currentUrl, {
        headers: reqHeaders,
        timeout,
        responseType: "arraybuffer",
        maxRedirects: 0,
        validateStatus: () => true,
      });
    } catch (err: any) {
      throw new Error(`HTTP request failed: ${err.message}`);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        throw new Error("Too many redirects encountered.");
      }
      const loc = res.headers["location"];
      if (!loc) {
        throw new Error("Redirect response missing Location header.");
      }

      if (loc.startsWith("/")) {
        const parsed = new URL(currentUrl);
        currentUrl = `${parsed.protocol}//${parsed.host}${loc}`;
      } else {
        currentUrl = loc;
      }
      continue;
    }

    const buf = Buffer.from(res.data);
    if (buf.length > maxBytes) {
      throw new Error(`Response body exceeds maximum allowed size of ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
    }

    const flatHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) {
      if (typeof v === "string") flatHeaders[k.toLowerCase()] = v;
      else if (Array.isArray(v)) flatHeaders[k.toLowerCase()] = v.join(", ");
    }

    return {
      status_code: res.status,
      text: buf.toString("utf-8"),
      content: buf,
      headers: flatHeaders,
    };
  }
}
