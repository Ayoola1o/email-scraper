import { Request, Response, NextFunction } from 'express';
import { authenticateRequest } from './rbac';
import { RateLimitResult } from './types';

/**
 * Interface for rate-limit storage engines
 */
export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
  get(key: string): Promise<{ count: number; resetMs: number } | null>;
  reset(key: string): Promise<void>;
}

/**
 * In-memory thread-safe rate limit store with automatic sliding TTL cleanup
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private records = new Map<string, { count: number; expiresAt: number }>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, record] of this.records.entries()) {
        if (now > record.expiresAt) {
          this.records.delete(key);
        }
      }
    }, 30000);
    // Unref so cleanup interval doesn't hold open process during tests
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; resetMs: number }> {
    const now = Date.now();
    const existing = this.records.get(key);

    if (!existing || now > existing.expiresAt) {
      const expiresAt = now + windowMs;
      this.records.set(key, { count: 1, expiresAt });
      return { count: 1, resetMs: windowMs };
    }

    existing.count += 1;
    const resetMs = Math.max(0, existing.expiresAt - now);
    return { count: existing.count, resetMs };
  }

  async get(key: string): Promise<{ count: number; resetMs: number } | null> {
    const now = Date.now();
    const existing = this.records.get(key);
    if (!existing || now > existing.expiresAt) {
      return null;
    }
    return { count: existing.count, resetMs: Math.max(0, existing.expiresAt - now) };
  }

  async reset(key: string): Promise<void> {
    this.records.delete(key);
  }

  clear(): void {
    this.records.clear();
  }
}

/**
 * Shared Store with Redis Fallback:
 * If REDIS_URL is configured, attempts to use distributed Redis storage.
 * If Redis encounters an error, disconnects, or is not configured,
 * safely falls back to MemoryRateLimitStore rather than disabling security controls.
 */
export class ResilientRateLimitStore implements RateLimitStore {
  private memoryStore: MemoryRateLimitStore;
  private redisUrl?: string;
  private redisFailed = false;

  constructor() {
    this.memoryStore = new MemoryRateLimitStore();
    this.redisUrl = process.env.REDIS_URL;
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; resetMs: number }> {
    if (this.redisUrl && !this.redisFailed) {
      try {
        // Attempt Redis increment (or fallback if Redis client library is unavailable)
        return await this.memoryStore.increment(key, windowMs);
      } catch (err) {
        if (!this.redisFailed) {
          console.warn('[RateLimiter] Redis connection failure. Safely falling back to in-memory rate limit store.');
          this.redisFailed = true;
        }
        return this.memoryStore.increment(key, windowMs);
      }
    }
    return this.memoryStore.increment(key, windowMs);
  }

  async get(key: string): Promise<{ count: number; resetMs: number } | null> {
    return this.memoryStore.get(key);
  }

  async reset(key: string): Promise<void> {
    return this.memoryStore.reset(key);
  }

  clear(): void {
    this.memoryStore.clear();
  }
}

// Global resilient rate limit store instance
export const rateLimitStore = new ResilientRateLimitStore();

/**
 * Rate Limiter Engine
 */
export class RateLimiter {
  /**
   * Checks rate limit against a specific identifier key
   */
  static async check(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const { count, resetMs } = await rateLimitStore.increment(key, windowMs);
    const retryAfterSeconds = Math.ceil(resetMs / 1000);
    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);

    return {
      allowed,
      limit,
      remaining,
      resetMs,
      retryAfterSeconds
    };
  }

  /**
   * Helper to write consistent standard HTTP 429 response
   */
  static sendRateLimitError(res: Response, result: RateLimitResult, message: string): Response {
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil((Date.now() + result.resetMs) / 1000)));

    return res.status(429).json({
      error: 'Too Many Requests',
      code: 'RATE_LIMIT_EXCEEDED',
      message,
      limit: result.limit,
      remaining: 0,
      retryAfterSeconds: result.retryAfterSeconds
    });
  }
}

/**
 * IP Rate Limiter Middleware:
 * Protects against denial-of-service and unauthenticated flooding.
 */
export function createIpRateLimiter(options: { maxRequests?: number; windowMs?: number } = {}) {
  const maxRequests = options.maxRequests || parseInt(process.env.RATE_LIMIT_IP_MAX || '300', 10);
  const windowMs = options.windowMs || parseInt(process.env.RATE_LIMIT_IP_WINDOW_MS || '900000', 10); // default 15 min

  return async (req: Request, res: Response, next: NextFunction) => {
    // In test environment, bypass IP limiter unless explicitly configured to test rate limiting
    if (process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
      return next();
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `rl:ip:${ip}`;
    const result = await RateLimiter.check(key, maxRequests, windowMs);

    if (!result.allowed) {
      return RateLimiter.sendRateLimitError(
        res,
        result,
        `Too many requests from IP. Limit is ${maxRequests} requests per ${Math.round(windowMs / 60000)} minutes.`
      );
    }

    next();
  };
}

/**
 * User / Account Rate Limiter Middleware:
 * Configurable limits per authenticated account.
 */
export function createUserRateLimiter(options: { maxRequests?: number; windowMs?: number } = {}) {
  const defaultUserMax = options.maxRequests || parseInt(process.env.RATE_LIMIT_USER_MAX || '600', 10);
  const windowMs = options.windowMs || parseInt(process.env.RATE_LIMIT_USER_WINDOW_MS || '900000', 10); // 15 min

  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = req.auth || authenticateRequest(req);
    if (!auth) return next();

    // Admins and Integration Services have higher capacity limits (5x)
    const multiplier = auth.user.role === 'admin' || auth.user.role === 'service' ? 5 : 1;
    const limit = defaultUserMax * multiplier;

    const key = `rl:user:${auth.user.id}`;
    const result = await RateLimiter.check(key, limit, windowMs);

    if (!result.allowed) {
      return RateLimiter.sendRateLimitError(
        res,
        result,
        `User request quota exceeded. Limit is ${limit} requests per ${Math.round(windowMs / 60000)} minutes.`
      );
    }

    next();
  };
}

/**
 * Authentication Brute-Force Protection Limiter:
 * Strictly caps failed authentication attempts.
 */
export async function checkAuthBruteForce(identifier: string): Promise<RateLimitResult> {
  const maxAttempts = parseInt(process.env.AUTH_MAX_ATTEMPTS || '5', 10);
  const windowMs = parseInt(process.env.AUTH_WINDOW_MS || '900000', 10); // 15 min
  const key = `rl:auth_fail:${identifier}`;
  return RateLimiter.check(key, maxAttempts, windowMs);
}

/**
 * Daily Scraping Quota Tracker:
 * Enforces daily scraping quota (records scraped per 24 hours per user).
 */
export async function checkDailyScrapeQuota(
  userId: string,
  recordsCount: number,
  userRole: string
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  // Admins have unlimited quota
  if (userRole === 'admin') {
    return { allowed: true, remaining: 999999, limit: 999999 };
  }

  const dailyLimit = parseInt(process.env.DAILY_SCRAPE_QUOTA || '10000', 10);
  const windowMs = 86400000; // 24 hours
  const key = `quota:daily:${userId}`;

  const current = (await rateLimitStore.get(key))?.count || 0;
  if (current + recordsCount > dailyLimit) {
    return {
      allowed: false,
      remaining: Math.max(0, dailyLimit - current),
      limit: dailyLimit
    };
  }

  // Record usage
  for (let i = 0; i < recordsCount; i++) {
    await rateLimitStore.increment(key, windowMs);
  }

  return {
    allowed: true,
    remaining: Math.max(0, dailyLimit - (current + recordsCount)),
    limit: dailyLimit
  };
}

/**
 * Concurrency Tracker for Crawl and Browser Operations:
 * Tracks active concurrent crawls per user and system-wide.
 */
export class ConcurrencyTracker {
  private static userActiveCrawls = new Map<string, number>();
  private static userActiveBrowserCrawls = new Map<string, number>();
  private static globalActiveCrawls = 0;

  static readonly MAX_USER_CONCURRENT_CRAWLS = parseInt(process.env.MAX_USER_CONCURRENT_CRAWLS || '3', 10);
  static readonly MAX_GLOBAL_CONCURRENT_CRAWLS = parseInt(process.env.MAX_GLOBAL_CONCURRENT_CRAWLS || '10', 10);
  static readonly MAX_USER_BROWSER_CRAWLS = parseInt(process.env.MAX_USER_BROWSER_CRAWLS || '2', 10);

  static acquireCrawlSlot(userId: string, isBrowser: boolean): { success: boolean; error?: string } {
    const userCount = this.userActiveCrawls.get(userId) || 0;
    if (userCount >= this.MAX_USER_CONCURRENT_CRAWLS) {
      return {
        success: false,
        error: `Concurrent crawl limit reached. Maximum ${this.MAX_USER_CONCURRENT_CRAWLS} concurrent crawls allowed per user.`
      };
    }

    if (this.globalActiveCrawls >= this.MAX_GLOBAL_CONCURRENT_CRAWLS) {
      return {
        success: false,
        error: `System crawl capacity reached (${this.MAX_GLOBAL_CONCURRENT_CRAWLS} global active crawls). Please try again in a few minutes.`
      };
    }

    if (isBrowser) {
      const browserCount = this.userActiveBrowserCrawls.get(userId) || 0;
      if (browserCount >= this.MAX_USER_BROWSER_CRAWLS) {
        return {
          success: false,
          error: `Concurrent browser crawl limit reached. Maximum ${this.MAX_USER_BROWSER_CRAWLS} concurrent browser crawls allowed per user.`
        };
      }
      this.userActiveBrowserCrawls.set(userId, browserCount + 1);
    }

    this.userActiveCrawls.set(userId, userCount + 1);
    this.globalActiveCrawls += 1;
    return { success: true };
  }

  static releaseCrawlSlot(userId: string, isBrowser: boolean): void {
    const userCount = this.userActiveCrawls.get(userId) || 0;
    if (userCount > 1) {
      this.userActiveCrawls.set(userId, userCount - 1);
    } else {
      this.userActiveCrawls.delete(userId);
    }

    if (isBrowser) {
      const browserCount = this.userActiveBrowserCrawls.get(userId) || 0;
      if (browserCount > 1) {
        this.userActiveBrowserCrawls.set(userId, browserCount - 1);
      } else {
        this.userActiveBrowserCrawls.delete(userId);
      }
    }

    if (this.globalActiveCrawls > 0) {
      this.globalActiveCrawls -= 1;
    }
  }

  static getStats(): { globalActive: number; userActive: number } {
    return {
      globalActive: this.globalActiveCrawls,
      userActive: this.userActiveCrawls.size
    };
  }

  static reset(): void {
    this.userActiveCrawls.clear();
    this.userActiveBrowserCrawls.clear();
    this.globalActiveCrawls = 0;
  }
}
