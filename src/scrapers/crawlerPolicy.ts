import { URL } from 'url';
import { safeFetch } from '../utils/security';

export interface RobotsRule {
  userAgent: string;
  disallow: string[];
  allow: string[];
  crawlDelay?: number;
}

export interface CachedRobots {
  rules: RobotsRule[];
  fetchedAt: number;
  ttlMs: number;
  isDisallowedAll: boolean;
}

export type HttpStatusCategory =
  | 'SUCCESS'
  | 'ACCESS_RESTRICTED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'TRANSIENT_SERVER_ERROR'
  | 'SECURITY_REJECTED'
  | 'CLIENT_ERROR';

export interface HttpStatusClassification {
  category: HttpStatusCategory;
  statusCode: number;
  retryable: boolean;
  userReason: string;
  retryAfterMs?: number;
}

/**
 * Standard, transparent User-Agent identification for ethical web scraping.
 * Does not impersonate browser engines in HTTP mode.
 */
export function getDefaultUserAgent(contactEmail?: string): string {
  const contact = contactEmail || process.env.CRAWLER_CONTACT_EMAIL || 'crawler@emailfinder-sigma.vercel.app';
  const appUrl = process.env.APP_URL || 'https://emailfinder-sigma.vercel.app';
  return `EmailScraperPro/2.0 (+${appUrl}; ${contact})`;
}

/**
 * Parses Retry-After header supporting both decimal seconds (e.g. "120")
 * and RFC 1123 / HTTP-Date format (e.g. "Wed, 21 Oct 2026 07:28:00 GMT").
 */
export function parseRetryAfter(headerValue?: string | null): number | undefined {
  if (!headerValue || typeof headerValue !== 'string') return undefined;
  const trimmed = headerValue.trim();

  // Seconds integer/float
  if (/^\d+$/.test(trimmed)) {
    const sec = parseInt(trimmed, 10);
    return Math.max(0, sec * 1000);
  }

  // HTTP-Date format
  const dateVal = Date.parse(trimmed);
  if (!isNaN(dateVal)) {
    const diff = dateVal - Date.now();
    return Math.max(0, diff);
  }

  return undefined;
}

/**
 * Classifies HTTP status codes and extracts retry instructions
 */
export function classifyHttpStatus(
  status: number,
  headers?: Record<string, string> | Headers
): HttpStatusClassification {
  const getHeader = (name: string): string | null => {
    if (!headers) return null;
    if (typeof (headers as any).get === 'function') {
      return (headers as any).get(name);
    }
    const lower = name.toLowerCase();
    return (headers as Record<string, string>)[lower] || null;
  };

  const retryAfterHeader = getHeader('retry-after');
  const retryAfterMs = parseRetryAfter(retryAfterHeader);

  // 2xx Success
  if (status >= 200 && status < 300) {
    return {
      category: 'SUCCESS',
      statusCode: status,
      retryable: false,
      userReason: 'Request succeeded'
    };
  }

  // 401 / 403 Forbidden / Access Restricted
  if (status === 401 || status === 403) {
    return {
      category: 'ACCESS_RESTRICTED',
      statusCode: status,
      retryable: false,
      userReason: status === 401
        ? 'Target website requires authentication credentials'
        : 'Target website explicitly denied access (HTTP 403 Forbidden)'
    };
  }

  // 404 / 410 Not Found / Gone
  if (status === 404 || status === 410) {
    return {
      category: 'NOT_FOUND',
      statusCode: status,
      retryable: false,
      userReason: status === 404 ? 'Page not found (HTTP 404)' : 'Resource permanently removed (HTTP 410)'
    };
  }

  // 429 Too Many Requests
  if (status === 429) {
    return {
      category: 'RATE_LIMITED',
      statusCode: status,
      retryable: true,
      retryAfterMs,
      userReason: 'Target site rate-limit encountered (HTTP 429 Too Many Requests)'
    };
  }

  // 503 Service Unavailable (often rate-limited or maintenance)
  if (status === 503) {
    return {
      category: 'RATE_LIMITED',
      statusCode: status,
      retryable: true,
      retryAfterMs,
      userReason: 'Target server is temporarily unavailable or overloaded (HTTP 503)'
    };
  }

  // Transient Server & Gateway Errors (500, 502, 504, 408)
  if ([500, 502, 504, 408].includes(status)) {
    return {
      category: 'TRANSIENT_SERVER_ERROR',
      statusCode: status,
      retryable: true,
      retryAfterMs,
      userReason: `Transient server error encountered (HTTP ${status})`
    };
  }

  // General 4xx client errors
  if (status >= 400 && status < 500) {
    return {
      category: 'CLIENT_ERROR',
      statusCode: status,
      retryable: false,
      userReason: `Client request rejected (HTTP ${status})`
    };
  }

  return {
    category: 'TRANSIENT_SERVER_ERROR',
    statusCode: status,
    retryable: true,
    userReason: `Server returned unexpected HTTP ${status}`
  };
}

/**
 * Computes exponential backoff with full jitter
 */
export function calculateBackoffWithJitter(
  attempt: number,
  baseMs = 500,
  maxMs = 10000
): number {
  const exponential = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  // Full jitter: uniformly distributed random delay up to exponential
  const jittered = Math.floor(Math.random() * (exponential - baseMs + 1)) + baseMs;
  return Math.min(maxMs, jittered);
}

/**
 * Parses and evaluates robots.txt rules according to RFC 9309 standards
 */
export class RobotsManager {
  private cache: Map<string, CachedRobots> = new Map();
  private defaultTtlMs = 3600 * 1000; // 1 hour cache

  /**
   * Cleans path patterns for prefix/wildcard matching
   */
  private matchesPattern(pattern: string, path: string): boolean {
    if (!pattern || pattern === '/') return true;
    if (pattern === '') return false;

    // Convert robots wildcard syntax (* and $) to regex
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\*/g, '.*')
      .replace(/\\\$$/g, '$');

    const regex = new RegExp(`^${escaped}`);
    return regex.test(path);
  }

  /**
   * Parses raw robots.txt content into structured rules
   */
  parseRobotsTxt(content: string): RobotsRule[] {
    const lines = content.split('\n');
    const rules: RobotsRule[] = [];
    let currentUserAgents: string[] = [];
    let currentDisallows: string[] = [];
    let currentAllows: string[] = [];
    let currentCrawlDelay: number | undefined;

    const flushGroup = () => {
      if (currentUserAgents.length > 0) {
        for (const ua of currentUserAgents) {
          rules.push({
            userAgent: ua.toLowerCase(),
            disallow: [...currentDisallows],
            allow: [...currentAllows],
            crawlDelay: currentCrawlDelay
          });
        }
      }
      currentUserAgents = [];
      currentDisallows = [];
      currentAllows = [];
      currentCrawlDelay = undefined;
    };

    for (let line of lines) {
      // Strip comments
      const hashIndex = line.indexOf('#');
      if (hashIndex !== -1) {
        line = line.substring(0, hashIndex);
      }
      line = line.trim();
      if (!line) continue;

      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const field = line.substring(0, colonIndex).trim().toLowerCase();
      const value = line.substring(colonIndex + 1).trim();

      if (field === 'user-agent') {
        if (currentDisallows.length > 0 || currentAllows.length > 0) {
          flushGroup();
        }
        currentUserAgents.push(value);
      } else if (field === 'disallow') {
        if (value) currentDisallows.push(value);
      } else if (field === 'allow') {
        if (value) currentAllows.push(value);
      } else if (field === 'crawl-delay') {
        const parsedDelay = parseFloat(value);
        if (!isNaN(parsedDelay) && parsedDelay > 0) {
          currentCrawlDelay = parsedDelay;
        }
      }
    }

    flushGroup();
    return rules;
  }

  /**
   * Fetches and caches robots.txt for a given hostname
   */
  async getRobotsForHost(hostname: string, protocol = 'https:'): Promise<CachedRobots> {
    const cleanHost = hostname.toLowerCase();
    const existing = this.cache.get(cleanHost);
    const now = Date.now();

    if (existing && (now - existing.fetchedAt) < existing.ttlMs) {
      return existing;
    }

    const robotsUrl = `${protocol}//${cleanHost}/robots.txt`;
    try {
      const res = await safeFetch(robotsUrl, {
        timeout: 8000,
        userAgent: getDefaultUserAgent(),
        allowLocalhost: process.env.ALLOW_LOCAL_SCRAPING === 'true' || process.env.NODE_ENV === 'test'
      });

      if (res.status === 200 && res.text) {
        const rules = this.parseRobotsTxt(res.text);
        const cached: CachedRobots = {
          rules,
          fetchedAt: now,
          ttlMs: this.defaultTtlMs,
          isDisallowedAll: rules.some(r => r.userAgent === '*' && r.disallow.includes('/'))
        };
        this.cache.set(cleanHost, cached);
        return cached;
      }
    } catch {
      // If fetching robots.txt fails or 404, assume open access
    }

    const emptyCache: CachedRobots = {
      rules: [],
      fetchedAt: now,
      ttlMs: this.defaultTtlMs,
      isDisallowedAll: false
    };
    this.cache.set(cleanHost, emptyCache);
    return emptyCache;
  }

  /**
   * Verifies if a specific target URL path is permitted under robots.txt policy
   */
  isAllowed(robots: CachedRobots, targetUrl: string, userAgent = 'emailscraperpro'): { allowed: boolean; crawlDelayMs?: number; reason?: string } {
    if (!robots.rules || robots.rules.length === 0) {
      return { allowed: true };
    }

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return { allowed: false, reason: 'Invalid target URL' };
    }

    const pathAndQuery = parsed.pathname + parsed.search;
    const cleanUa = userAgent.toLowerCase();

    // 1. Check specific matching rules for our declared user-agent
    let applicableRule = robots.rules.find(r => r.userAgent !== '*' && cleanUa.includes(r.userAgent));
    // 2. Fall back to wildcard *
    if (!applicableRule) {
      applicableRule = robots.rules.find(r => r.userAgent === '*');
    }

    if (!applicableRule) {
      return { allowed: true };
    }

    const crawlDelayMs = applicableRule.crawlDelay ? Math.round(applicableRule.crawlDelay * 1000) : undefined;

    // Check allow rules first (RFC 9309 longest-match or explicit allow override)
    for (const allowPattern of applicableRule.allow) {
      if (this.matchesPattern(allowPattern, pathAndQuery)) {
        return { allowed: true, crawlDelayMs };
      }
    }

    // Check disallow rules
    for (const disallowPattern of applicableRule.disallow) {
      if (this.matchesPattern(disallowPattern, pathAndQuery)) {
        return {
          allowed: false,
          crawlDelayMs,
          reason: `Path disallowed by robots.txt directive "${disallowPattern}"`
        };
      }
    }

    return { allowed: true, crawlDelayMs };
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const robotsManager = new RobotsManager();

/**
 * Per-domain rate limiter & adaptive concurrency tracker
 * Guarantees that the scraper respects crawl-delay and does not flood any single target host.
 */
export class DomainRateLimiter {
  private lastRequestTimes: Map<string, number> = new Map();
  private activeConnections: Map<string, number> = new Map();
  private defaultMinDelayMs = 250;
  private maxDomainConcurrency = 2;

  /**
   * Waits for the polite domain crawl-delay before allowing the next request to proceed
   */
  async throttleDomain(hostname: string, customDelayMs?: number): Promise<void> {
    const cleanHost = hostname.toLowerCase();
    const delay = Math.max(customDelayMs || 0, this.defaultMinDelayMs);
    const now = Date.now();
    const last = this.lastRequestTimes.get(cleanHost) || 0;
    const elapsed = now - last;

    if (elapsed < delay) {
      const waitTime = delay - elapsed;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTimes.set(cleanHost, Date.now());
  }

  /**
   * Tracks in-flight connection slots per domain
   */
  acquireSlot(hostname: string): boolean {
    const cleanHost = hostname.toLowerCase();
    const active = this.activeConnections.get(cleanHost) || 0;
    if (active >= this.maxDomainConcurrency) {
      return false;
    }
    this.activeConnections.set(cleanHost, active + 1);
    return true;
  }

  releaseSlot(hostname: string): void {
    const cleanHost = hostname.toLowerCase();
    const active = this.activeConnections.get(cleanHost) || 1;
    this.activeConnections.set(cleanHost, Math.max(0, active - 1));
  }
}

export const domainRateLimiter = new DomainRateLimiter();
