import dns from 'dns/promises';
import { URL } from 'url';
import { executeSecureRequest } from './secureHttpClient';

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
 * Parses IPv4-mapped IPv6 formats (both dotted decimal "::ffff:127.0.0.1" and WHATWG hex "::ffff:7f00:1")
 */
export function parseIpv4MappedIpv6(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!trimmed.startsWith('::ffff:')) return null;

  const remainder = trimmed.substring(7);

  // Dotted decimal: e.g. "127.0.0.1"
  if (remainder.includes('.')) {
    return remainder;
  }

  // Hex chunks: e.g. "7f00:1" or "7f00:0001" or "a9fe:a9fe"
  const hexParts = remainder.split(':');
  if (hexParts.length === 2 && hexParts.every(p => /^[0-9a-f]{1,4}$/i.test(p))) {
    const high = parseInt(hexParts[0], 16);
    const low = parseInt(hexParts[1], 16);
    const a = (high >> 8) & 255;
    const b = high & 255;
    const c = (low >> 8) & 255;
    const d = low & 255;
    return `${a}.${b}.${c}.${d}`;
  }

  // Single 32-bit hex without colon, e.g. "7f000001"
  if (/^[0-9a-f]{1,8}$/i.test(remainder)) {
    const num = parseInt(remainder, 16);
    const a = Math.floor(num / 16777216) & 255;
    const b = Math.floor(num / 65536) & 255;
    const c = Math.floor(num / 256) & 255;
    const d = num & 255;
    return `${a}.${b}.${c}.${d}`;
  }

  return null;
}

/**
 * Normalizes alternative IP representations into standard dotted-decimal IPv4 format.
 * Handles:
 * - Dword / 32-bit integer (e.g. "2130706433" -> "127.0.0.1")
 * - Hexadecimal: single 32-bit (e.g. "0x7f000001" -> "127.0.0.1") or dotted hex ("0x7f.0.0.1")
 * - Octal: single integer ("017700000001") or dotted octal ("0177.0.0.1")
 * - BSD shorthand: 1 part ("2130706433"), 2 parts ("127.1" -> "127.0.0.1"), 3 parts ("10.0.1" -> "10.0.0.1")
 * - Mixed bases: e.g. "127.0.0x0.1"
 * - IPv4-mapped IPv6: "::ffff:127.0.0.1", "::ffff:7f00:1", "[::ffff:127.0.0.1]"
 * Returns standard dotted-quad "a.b.c.d" or null if not an alternative/numeric IP.
 */
export function normalizeAlternativeIpString(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  let trimmed = input.trim().toLowerCase().replace(/^\[|\]$/g, '');

  if (trimmed.startsWith('::ffff:')) {
    const mapped = parseIpv4MappedIpv6(trimmed);
    if (mapped) return mapped;
  }

  // If contains colons (IPv6), not an alternative IPv4 format
  if (trimmed.includes(':')) {
    return null;
  }

  // Must only contain digits, a-f, x, and dots
  if (!/^[0-9a-fx.]+$/i.test(trimmed)) {
    return null;
  }

  const parts = trimmed.split('.');
  if (parts.length > 4 || parts.length === 0) {
    return null;
  }

  const parsedParts: number[] = [];
  for (const part of parts) {
    if (part.length === 0) return null;
    let val: number;
    if (part.startsWith('0x') || part.startsWith('0X')) {
      val = parseInt(part, 16);
    } else if (part.startsWith('0') && part.length > 1) {
      if (/[89]/.test(part)) return null; // Invalid octal
      val = parseInt(part, 8);
    } else {
      if (!/^\d+$/.test(part)) return null;
      val = parseInt(part, 10);
    }
    if (isNaN(val) || val < 0) return null;
    parsedParts.push(val);
  }

  let ipNum: number;
  if (parsedParts.length === 1) {
    ipNum = parsedParts[0];
    if (ipNum < 0 || ipNum > 0xffffffff) return null;
  } else if (parsedParts.length === 2) {
    if (parsedParts[0] > 0xff || parsedParts[1] > 0xffffff) return null;
    ipNum = (parsedParts[0] * 16777216) + parsedParts[1];
  } else if (parsedParts.length === 3) {
    if (parsedParts[0] > 0xff || parsedParts[1] > 0xff || parsedParts[2] > 0xffff) return null;
    ipNum = (parsedParts[0] * 16777216) + (parsedParts[1] * 65536) + parsedParts[2];
  } else {
    if (parsedParts.some(p => p > 0xff)) return null;
    ipNum = (parsedParts[0] * 16777216) + (parsedParts[1] * 65536) + (parsedParts[2] * 256) + parsedParts[3];
  }

  const a = Math.floor(ipNum / 16777216) & 255;
  const b = Math.floor(ipNum / 65536) & 255;
  const c = Math.floor(ipNum / 256) & 255;
  const d = ipNum & 255;

  return `${a}.${b}.${c}.${d}`;
}

/**
 * Strictly parses and validates an IPv4 address string.
 * Returns { valid: true, isIpPattern: true, octets: [a, b, c, d] } if strictly valid (each octet 0-255).
 * Returns { valid: false, isIpPattern: true } if malformed IP pattern (e.g. 999.999.999.999).
 * Returns { valid: false, isIpPattern: false } if ordinary hostname string.
 */
export function parseAndValidateIpv4(ipStr: string): {
  valid: boolean;
  isIpPattern: boolean;
  octets?: [number, number, number, number];
} {
  if (!ipStr || typeof ipStr !== 'string') {
    return { valid: false, isIpPattern: false };
  }

  const trimmed = ipStr.trim();
  const parts = trimmed.split('.');

  if (parts.length === 4 && parts.every(p => /^\d+$/.test(p))) {
    const octets = parts.map(p => parseInt(p, 10));
    const allInRange = octets.every((num, idx) => {
      if (isNaN(num) || num < 0 || num > 255) return false;
      if (parts[idx].length > 1 && parts[idx].startsWith('0')) return false; // Reject ambiguous leading zeros
      return true;
    });

    if (allInRange) {
      return { valid: true, isIpPattern: true, octets: octets as [number, number, number, number] };
    }
    return { valid: false, isIpPattern: true };
  }

  // Detect numeric IP patterns (e.g. 1-3 parts or pure numeric integer notation)
  if (/^(\d+\.){1,3}\d+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
    return { valid: false, isIpPattern: true };
  }

  return { valid: false, isIpPattern: false };
}

/**
 * Checks whether an IPv4 or IPv6 address belongs to private, loopback, or metadata ranges.
 * Automatically inspects alternative and numeric formats.
 */
export function isRestrictedIpAddress(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return true;

  const normalized = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');

  // IPv6 Loopback / Unspecified / Link-local / Unique Local (ULA) / Multicast / Doc / Discard / 6to4
  if (normalized === '::1' || normalized === '::' || normalized === '0:0:0:0:0:0:0:0' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (/^fe[89ab][0-9a-f]{0,2}:/i.test(normalized) || normalized.startsWith('fe80:')) return true; // IPv6 link-local fe80::/10
  if (/^f[cd][0-9a-f]{0,2}:/i.test(normalized) || normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // IPv6 ULA fc00::/7
  if (/^ff[0-9a-f]{0,2}:/i.test(normalized) || normalized.startsWith('ff')) return true; // IPv6 multicast ff00::/8
  if (normalized.startsWith('2001:db8:')) return true; // IPv6 documentation
  if (normalized.startsWith('100::')) return true; // Discard-only
  if (normalized.startsWith('2002:')) return true; // 6to4
  if (normalized.startsWith('fd00:ec2::')) return true; // AWS IPv6 metadata

  // Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  let candidate = normalized;
  if (candidate.startsWith('::ffff:')) {
    candidate = candidate.substring(7);
  }

  // Check alternative IP formats
  const altNormalized = normalizeAlternativeIpString(candidate);
  const ipToCheck = altNormalized || candidate;

  const parsed = parseAndValidateIpv4(ipToCheck);
  if (parsed.isIpPattern) {
    if (!parsed.valid || !parsed.octets) {
      return true; // Malformed IPv4 is always restricted
    }
    const [a, b, c, d] = parsed.octets;

    // 0.0.0.0/8 (Current network / broadcast)
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

    // 100.64.0.0/10 (Carrier-Grade NAT: 100.64.0.0 - 100.127.255.255)
    if (a === 100 && b >= 64 && b <= 127) return true;

    // 100.100.100.200 (Alibaba Cloud Metadata)
    if (a === 100 && b === 100 && c === 100 && d === 200) return true;

    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (a === 192 && b === 0 && c === 0) return true;

    // 192.0.2.0/24 (TEST-NET-1)
    if (a === 192 && b === 0 && c === 2) return true;

    // 198.51.100.0/24 (TEST-NET-2)
    if (a === 198 && b === 51 && c === 100) return true;

    // 203.0.113.0/24 (TEST-NET-3)
    if (a === 203 && b === 0 && c === 113) return true;

    // 198.18.0.0/15 (Network Benchmark Tests: 198.18.0.0 - 198.19.255.255)
    if (a === 198 && (b === 18 || b === 19)) return true;

    // 224.0.0.0/4 (Multicast: 224.0.0.0 - 239.255.255.255)
    if (a >= 224 && a <= 239) return true;

    // 240.0.0.0/4 (Reserved / Future Use / Broadcast: 240.0.0.0 - 255.255.255.255)
    if (a >= 240) return true;

    return false;
  }

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

  // Reject null bytes, control characters, or suspicious newline injections
  if (rawUrl.includes('\0') || rawUrl.includes('%00') || /[\r\n\t]/.test(rawUrl)) {
    return { safe: false, error: 'URL contains prohibited control characters or null bytes (SSRF protection).' };
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

  // Reject URL credentials (username/password in URL)
  if (parsed.username || parsed.password) {
    return { safe: false, error: 'URL credentials (user:pass@) are forbidden (SSRF protection).' };
  }

  const rawHostname = parsed.hostname.toLowerCase();
  const hostname = rawHostname.replace(/^\[|\]$/g, '');

  if (!hostname || hostname.length === 0) {
    return { safe: false, error: 'URL hostname is empty or invalid.' };
  }

  // Explicit check for cloud metadata hostnames
  if (
    hostname === 'metadata.google.internal' ||
    hostname === '169.254.169.254' ||
    hostname === 'instance-data' ||
    hostname === 'metadata.titus.netflix.com'
  ) {
    return { safe: false, error: 'Access to cloud metadata endpoints is strictly forbidden (SSRF protection).' };
  }

  // Check alternative IP representation (dword, hex, octal, shorthand, IPv4-mapped IPv6)
  const altIp = normalizeAlternativeIpString(hostname);
  const effectiveIp = altIp || hostname;

  // Strict IPv4 validation: reject malformed IP addresses without DNS lookup
  const ipCheck = parseAndValidateIpv4(effectiveIp);
  if (ipCheck.isIpPattern) {
    if (!ipCheck.valid || !ipCheck.octets) {
      return { safe: false, error: `Invalid or malformed IPv4 address: "${hostname}"` };
    }

    const [a, b, c, d] = ipCheck.octets;

    // Loopback 127.0.0.0/8 check
    if (a === 127) {
      const isDemoEndpoint = parsed.pathname === '/api/demo' || parsed.pathname.startsWith('/api/demo/');
      const allowLocal = options.allowLocalhost !== undefined
        ? options.allowLocalhost
        : (isDemoEndpoint || process.env.ALLOW_LOCAL_SCRAPING === 'true');

      if (!allowLocal) {
        return { safe: false, error: 'Scraping localhost or loopback destinations is blocked (SSRF protection).' };
      }
      return { safe: true, url: parsed };
    }

    // Cloud metadata or link-local is strictly forbidden unconditionally
    if ((a === 169 && b === 254) || (a === 100 && b === 100 && c === 100 && d === 200)) {
      return { safe: false, error: `Access to cloud metadata IP ${hostname} is strictly forbidden (SSRF protection).` };
    }

    if (isRestrictedIpAddress(effectiveIp)) {
      return { safe: false, error: `Access to private or restricted IP ${hostname} is blocked (SSRF protection).` };
    }
    return { safe: true, url: parsed };
  }

  // Localhost, localhost subdomain, and IPv6 loopback check
  const isLocalHost = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1';
  const isDemoEndpoint = isLocalHost && (parsed.pathname === '/api/demo' || parsed.pathname.startsWith('/api/demo/'));
  const allowLocal = options.allowLocalhost !== undefined
    ? options.allowLocalhost
    : (isDemoEndpoint || process.env.ALLOW_LOCAL_SCRAPING === 'true');

  if (isLocalHost) {
    if (!allowLocal) {
      return { safe: false, error: 'Scraping localhost or loopback destinations is blocked (SSRF protection).' };
    }
    return { safe: true, url: parsed };
  }

  // If hostname is IPv6 or restricted IP directly (e.g. fe80::1, fd00:ec2::254)
  if (isRestrictedIpAddress(hostname)) {
    return { safe: false, error: `Access to restricted IP address "${hostname}" is blocked (SSRF protection).` };
  }

  // Resolve hostname via dual-stack DNS (IPv4 and IPv6) to prevent DNS rebinding / private IP resolutions
  try {
    const [ipv4Addrs, ipv6Addrs] = await Promise.all([
      dns.resolve4(hostname).catch(() => [] as string[]),
      dns.resolve6(hostname).catch(() => [] as string[])
    ]);

    const allAddresses = [...ipv4Addrs, ...ipv6Addrs];
    if (allAddresses.length === 0) {
      // Try dns.lookup as fallback for systems with non-standard local hosts
      const lookupResult = await dns.lookup(hostname, { all: true }).catch(() => []);
      if (lookupResult && lookupResult.length > 0) {
        for (const item of lookupResult) {
          allAddresses.push(item.address);
        }
      }
    }

    if (allAddresses.length === 0) {
      return { safe: false, error: `Could not resolve any IP address for host "${hostname}"` };
    }

    for (const addr of allAddresses) {
      if (isRestrictedIpAddress(addr) && !allowLocal) {
        return {
          safe: false,
          error: `Domain "${hostname}" resolves to restricted IP ${addr} (SSRF protection).`
        };
      }
    }
  } catch (dnsErr: any) {
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
  headers: {
    get(name: string): string | null;
    [key: string]: any;
  };
}

/**
 * Safe HTTP client that enforces:
 * 1. SSRF check on initial target URL
 * 2. Connection-level destination enforcement (DNS rebinding protection)
 * 3. Manual redirect handling with SSRF revalidation on every hop & protocol downgrade prevention
 * 4. Max response payload size caps with early streaming abort & decompression bomb protection
 * 5. Request timeout and stalled stream abort
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

  const result = await executeSecureRequest(initialUrl, {
    method: 'GET',
    timeout,
    headers: {
      'User-Agent': userAgent,
      ...headers
    },
    maxRedirects,
    maxBytes,
    allowLocalhost
  });

  const normalizedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(result.headers)) {
    normalizedHeaders[k.toLowerCase()] = v;
  }

  const headerObj = {
    ...normalizedHeaders,
    get: (name: string): string | null => {
      return normalizedHeaders[name.toLowerCase()] ?? null;
    }
  };

  return {
    text: result.text,
    status: result.status,
    finalUrl: result.finalUrl,
    headers: headerObj as any
  };
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
