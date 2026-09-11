import dns from 'dns/promises';
import { URL } from 'url';

/**
 * Security & SSRF Protection Utility
 */

export interface UrlValidationOptions {
  allowLocalhost?: boolean;
}

/**
 * Checks whether an IPv4 or IPv6 address belongs to private, loopback, or metadata ranges
 */
export function isRestrictedIpAddress(ip: string): boolean {
  // IPv6 Loopback / Link-local / Unique Local
  if (ip === '::1' || ip === '::') return true;
  if (ip.toLowerCase().startsWith('fe80:')) return true; // link-local
  if (ip.toLowerCase().startsWith('fc00:') || ip.toLowerCase().startsWith('fd00:')) return true; // ULA

  // Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  const ipv4 = ip.startsWith('::ffff:') ? ip.substring(7) : ip;

  const parts = ipv4.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(isNaN)) {
    return false;
  }

  const [a, b, c, d] = parts;

  // 0.0.0.0/8
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

  // Localhost check
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  const isDemoEndpoint = isLocalHost && (parsed.pathname.startsWith('/api/demo') || parsed.pathname === '/');
  const allowLocal = options.allowLocalhost || isDemoEndpoint || process.env.ALLOW_LOCAL_SCRAPING === 'true' || process.env.NODE_ENV === 'test';

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
 * Maximum limits for crawl execution
 */
export const CRAWL_SECURITY_LIMITS = {
  MAX_PAGES_CAP: 200,
  MAX_DEPTH_CAP: 10,
  MAX_RESPONSE_BYTES: 10 * 1024 * 1024 // 10MB
};

/**
 * Sanitizes crawl depth and page limits against malicious inputs
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
