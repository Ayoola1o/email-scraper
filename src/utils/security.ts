import dns from 'dns/promises';
import { URL } from 'url';

/**
 * Security, Resource Limits & SSRF Protection Utility
 */

export interface UrlValidationOptions {
  allowLocalhost?: boolean;
}

/**
 * Maximum system security limits
 */
export const CRAWL_SECURITY_LIMITS = {
  MAX_PAGES_CAP: 200,
  MAX_DEPTH_CAP: 10,
  MAX_CONCURRENCY_CAP: 5,
  MAX_RESPONSE_BYTES: 10 * 1024 * 1024, // 10MB
  MAX_REDIRECTS: 5,
  REQUEST_TIMEOUT_MS: 10000
};

/**
 * Checks whether an IPv4 or IPv6 address belongs to private, loopback, or metadata ranges
 */
export function isRestrictedIpAddress(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return true;

  const normalized = ip.trim();

  // IPv6 Loopback / Unspecified / Link-local / Unique Local (ULA)
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.toLowerCase().startsWith('fe80:')) return true; // link-local
  if (normalized.toLowerCase().startsWith('fc00:') || normalized.toLowerCase().startsWith('fd00:')) return true; // ULA

  // Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  const ipv4 = normalized.startsWith('::ffff:') ? normalized.substring(7) : normalized;

  const parts = ipv4.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(isNaN)) {
    return false;
  }

  const [a, b, c, d] = parts;

  // 0.0.0.0/8 (Broadcast/Current network)
  if (a === 0) return true;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;

  // 10.0.0.0/8 (RFC 1918 Private)
  if (a === 10) return true;

  // 172.16.0.0/12 (RFC 1918 Private: 172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 (RFC 1918 Private)
  if (a === 192 && b === 168) return true;

  // 169.254.0.0/16 (Link-Local / AWS/GCP/Azure Cloud Metadata)
  if (a === 169 && b === 254) return true;

  // 100.64.0.0/10 (Carrier-Grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  return false;
}

/**
 * Validates a target URL against SSRF and invalid protocols
 */
export async function validateSafeScrapeUrl(
  rawUrl: string,
  options: UrlValidationOptions = {}
): Promise<{ safe: boolean; error?: string; url?: URL }> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { safe: false, error: 'Target URL is missing or invalid' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { safe: false, error: `Invalid URL format: "${rawUrl}"` };
  }

  // Enforce http/https only
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, error: `Invalid protocol "${parsed.protocol}". Only http: and https: are allowed.` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Explicit check for cloud metadata hostnames
  if (
    hostname === 'metadata.google.internal' ||
    hostname === '169.254.169.254' ||
    hostname === 'instance-data'
  ) {
    return { safe: false, error: 'Access to cloud metadata endpoints is strictly forbidden (SSRF protection).' };
  }

  // Localhost and localhost subdomain check
  const isLocalHost = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '::1';
  const isDemoEndpoint = isLocalHost && (parsed.pathname.startsWith('/api/demo') || parsed.pathname === '/');
  const allowLocal = options.allowLocalhost !== undefined
    ? options.allowLocalhost
    : (isDemoEndpoint || process.env.ALLOW_LOCAL_SCRAPING === 'true' || process.env.NODE_ENV === 'test');

  if (isLocalHost) {
    if (!allowLocal) {
      return { safe: false, error: 'Scraping localhost or loopback destinations is blocked (SSRF protection).' };
    }
    return { safe: true, url: parsed };
  }

  // If host is direct IP address, verify it
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    if (isRestrictedIpAddress(hostname)) {
      if (!allowLocal) {
        return { safe: false, error: `Access to private or restricted IP ${hostname} is blocked (SSRF protection).` };
      }
    }
    return { safe: true, url: parsed };
  }

  // Resolve hostname via DNS to prevent DNS rebinding / private IP resolutions
  try {
    const addresses = await dns.resolve4(hostname).catch(async () => {
      return await dns.resolve6(hostname).catch(() => []);
    });

    for (const addr of addresses) {
      if (isRestrictedIpAddress(addr) && !allowLocal) {
        return {
          safe: false,
          error: `Domain "${hostname}" resolves to restricted IP ${addr} (SSRF protection).`
        };
      }
    }
  } catch (dnsErr: any) {
    // DNS resolution failure
    return { safe: false, error: `DNS lookup failed for host "${hostname}": ${dnsErr.message}` };
  }

  return { safe: true, url: parsed };
}

/**
 * Options for safe HTTP fetch execution
 */
export interface SafeFetchOptions {
  timeout?: number;
  headers?: Record<string, string>;
  userAgent?: string;
  maxRedirects?: number;
  maxBytes?: number;
  allowLocalhost?: boolean;
}

export interface SafeFetchResult {
  text: string;
  status: number;
  finalUrl: string;
  headers: Headers;
}

/**
 * Safe HTTP client that enforces:
 * 1. SSRF check on initial target URL
 * 2. Manual redirect handling with SSRF revalidation on every hop
 * 3. Max response payload size caps with early abort on streaming
 * 4. Request timeout abort
 */
export async function safeFetch(
  initialUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const {
    timeout = CRAWL_SECURITY_LIMITS.REQUEST_TIMEOUT_MS,
    headers = {},
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    maxRedirects = CRAWL_SECURITY_LIMITS.MAX_REDIRECTS,
    maxBytes = CRAWL_SECURITY_LIMITS.MAX_RESPONSE_BYTES,
    allowLocalhost = false
  } = options;

  let currentUrl = initialUrl;
  let redirectCount = 0;

  while (true) {
    // 1. SSRF validation of target URL
    const validation = await validateSafeScrapeUrl(currentUrl, { allowLocalhost });
    if (!validation.safe) {
      throw new Error(`SSRF blocked request to "${currentUrl}": ${validation.error}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual', // Crucial: inspect every redirect hop manually!
        signal: controller.signal,
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...headers
        }
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // 2. Handle redirects (301, 302, 303, 307, 308)
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        throw new Error(`Too many redirects (exceeded limit of ${maxRedirects})`);
      }

      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`Redirect HTTP ${response.status} returned without Location header`);
      }

      // Resolve relative redirect destination against currentUrl
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }

    // 3. Early check on Content-Length header
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > maxBytes) {
      throw new Error(`Response size ${contentLength} bytes exceeds limit of ${maxBytes} bytes`);
    }

    // 4. Stream response body and count bytes to protect memory
    if (!response.body) {
      const text = await response.text();
      return { text, status: response.status, finalUrl: currentUrl, headers: response.headers };
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          receivedBytes += value.length;
          if (receivedBytes > maxBytes) {
            await reader.cancel();
            throw new Error(`Response size exceeded limit of ${maxBytes} bytes`);
          }
          chunks.push(value);
        }
      }
    } catch (streamErr: any) {
      if (streamErr.message?.includes('limit of')) {
        throw streamErr;
      }
      throw new Error(`Failed reading response stream: ${streamErr.message}`);
    }

    // Concatenate chunks and decode into string
    const totalBuffer = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      totalBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(totalBuffer);

    return {
      text,
      status: response.status,
      finalUrl: currentUrl,
      headers: response.headers
    };
  }
}

/**
 * Sanitizes crawl depth and page limits against malicious or excessive inputs
 */
export function sanitizeCrawlLimits(maxDepth?: number, maxPages?: number) {
  const depth = Math.min(
    CRAWL_SECURITY_LIMITS.MAX_DEPTH_CAP,
    Math.max(1, parseInt(String(maxDepth || 2), 10) || 2)
  );
  const pages = Math.min(
    CRAWL_SECURITY_LIMITS.MAX_PAGES_CAP,
    Math.max(1, parseInt(String(maxPages || 30), 10) || 30)
  );
  return { depth, pages };
}
