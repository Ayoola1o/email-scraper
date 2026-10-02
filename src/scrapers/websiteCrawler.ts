import { Browser } from '../types/browser';
import { extractAndNormalizeEmails, extractEmailRecordsFromHtml, extractPageTitle } from '../utils/emailExtractor';
import { ScrapedEmailRecord } from '../types/record';
import { validateSafeScrapeUrl, safeFetch } from '../utils/security';
import { hardenBrowserPage } from '../utils/browserSecurity';
import {
  robotsManager,
  domainRateLimiter,
  classifyHttpStatus,
  calculateBackoffWithJitter,
  getDefaultUserAgent
} from './crawlerPolicy';

/**
 * Real-time crawl progress event data with Phase 2 observability
 */
export interface CrawlProgress {
  url: string;
  depth: number;
  pagesVisited: number;
  maxPages: number;
  queueLength: number;
  emailsFoundOnPage: number;
  totalUniqueEmails: number;
  pageTitle?: string;
  statusCode?: number;
  phase?: 'initializing' | 'checking_robots' | 'crawling' | 'throttled' | 'finalizing';
  pagesDiscovered?: number;
  pagesSkipped?: number;
  pagesFailed?: number;
  retriesCount?: number;
  lastRetryReason?: string;
  currentHost?: string;
  accessRestrictedReason?: string;
}

/**
 * Validated, documented options for website crawling
 */
export interface WebsiteCrawlerOptions {
  maxDepth?: number;
  maxPages?: number;
  sameDomainOnly?: boolean;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
  delayMs?: number;
  useBrowser?: boolean;
  browser?: Browser;
  userAgent?: string;
  contactEmail?: string;
  respectRobotsTxt?: boolean;
  maxRetries?: number;
  maxRetryBudgetMs?: number;
  onPageVisited?: (url: string, depth: number, emailCount: number) => void;
  onProgress?: (progress: CrawlProgress) => void;
  onRecordFound?: (record: ScrapedEmailRecord) => void;
  onError?: (url: string, error: Error) => void;
  isCancelled?: () => boolean;
}

/**
 * Extracts the domain from a URL
 */
function getDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Normalizes a URL (resolves relative URLs, strips fragments, validates protocol)
 */
function normalizeUrl(url: string, baseUrl: string): string | null {
  try {
    const base = new URL(baseUrl);
    const resolved = new URL(url, base);
    resolved.hash = ''; // Remove fragments

    // Only accept http and https protocols
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null;
    }

    // Skip static assets
    const pathname = resolved.pathname.toLowerCase();
    if (pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|woff|woff2|ttf|pdf|zip|mp4|webm|avi|mp3|wav|tar|gz|exe)$/)) {
      return null;
    }

    // Strip common tracking query parameters
    const searchParams = resolved.searchParams;
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
    for (const p of trackingParams) {
      searchParams.delete(p);
    }

    return resolved.href;
  } catch {
    return null;
  }
}

/**
 * Checks if a URL path is a likely contact, about, or team page
 */
function isHighPriorityContactUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    return /\b(contact|about|team|staff|people|support|reach|impressum|touch)\b/i.test(path);
  } catch {
    return false;
  }
}

/**
 * Extracts canonical URL from HTML if declared
 */
function extractCanonicalUrl(html: string, baseUrl: string): string | null {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ||
                html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  if (match && match[1]) {
    return normalizeUrl(match[1].trim(), baseUrl);
  }
  return null;
}

/**
 * Extracts links from HTML content with structured deduplication
 */
function extractLinks(html: string, baseUrl: string): Set<string> {
  const links = new Set<string>();
  const linkRegex = /<a[^>]+href=["']([^"']+)["']/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1].trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
      continue;
    }
    const normalized = normalizeUrl(href, baseUrl);
    if (normalized) {
      links.add(normalized);
    }
  }

  return links;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Crawls a website and returns detailed ScrapedEmailRecords with full policy enforcement
 */
export async function scrapeEmailRecordsFromWebsite(
  startUrl: string,
  options: WebsiteCrawlerOptions = {}
): Promise<{
  records: ScrapedEmailRecord[];
  pagesVisited: number;
  pagesSkipped: number;
  pagesFailed: number;
  errors: number;
  accessRestrictedReason?: string;
}> {
  const {
    maxDepth = 3,
    maxPages = 50,
    sameDomainOnly = true,
    waitUntil = 'load',
    timeout = 15000,
    delayMs = 200,
    useBrowser = false,
    browser,
    userAgent = getDefaultUserAgent(options.contactEmail),
    respectRobotsTxt = true,
    maxRetries = 2,
    maxRetryBudgetMs = 30000,
    onPageVisited,
    onProgress,
    onRecordFound,
    onError,
    isCancelled,
  } = options;

  const recordsMap = new Map<string, ScrapedEmailRecord>();
  const visited = new Set<string>();
  const queuedUrls = new Set<string>([startUrl]);
  const toVisit: Array<{ url: string; depth: number; priority: boolean }> = [
    { url: startUrl, depth: 0, priority: true }
  ];

  const startDomain = getDomain(startUrl);
  let errorCount = 0;
  let pagesSkipped = 0;
  let totalRetries = 0;
  let lastRetryReason: string | undefined;
  let globalAccessRestrictedReason: string | undefined;

  // 1. Fetch robots.txt policy for target domain if enabled
  let robotsPolicy: any = null;
  let robotsCrawlDelayMs: number | undefined;

  if (respectRobotsTxt && startDomain) {
    onProgress?.({
      url: startUrl,
      depth: 0,
      pagesVisited: 0,
      maxPages,
      queueLength: toVisit.length,
      emailsFoundOnPage: 0,
      totalUniqueEmails: 0,
      phase: 'checking_robots',
      currentHost: startDomain,
      pagesDiscovered: queuedUrls.size,
      pagesSkipped: 0,
      pagesFailed: 0
    });

    try {
      const parsedStart = new URL(startUrl);
      robotsPolicy = await robotsManager.getRobotsForHost(startDomain, parsedStart.protocol);
      if (robotsPolicy.isDisallowedAll) {
        globalAccessRestrictedReason = `Robots.txt on ${startDomain} disallows automated crawling for all agents.`;
      }
    } catch {
      // Continue if robots fetch fails
    }
  }

  // 2. Main Crawl Loop
  while (toVisit.length > 0 && visited.size < maxPages) {
    if (isCancelled && isCancelled()) {
      break;
    }

    // Sort queue: high-priority contact pages first
    toVisit.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      return a.depth - b.depth;
    });

    const current = toVisit.shift()!;
    const { url, depth } = current;

    if (visited.has(url)) {
      continue;
    }

    if (depth > maxDepth) {
      continue;
    }

    // Check domain restriction
    const currentDomain = getDomain(url);
    if (sameDomainOnly && currentDomain !== startDomain) {
      pagesSkipped++;
      continue;
    }

    // 3. Respect robots.txt policy
    if (respectRobotsTxt && robotsPolicy) {
      const check = robotsManager.isAllowed(robotsPolicy, url, userAgent);
      if (check.crawlDelayMs && (!robotsCrawlDelayMs || check.crawlDelayMs > robotsCrawlDelayMs)) {
        robotsCrawlDelayMs = check.crawlDelayMs;
      }

      if (!check.allowed) {
        pagesSkipped++;
        onProgress?.({
          url,
          depth,
          pagesVisited: visited.size,
          maxPages,
          queueLength: toVisit.length,
          emailsFoundOnPage: 0,
          totalUniqueEmails: recordsMap.size,
          phase: 'crawling',
          pagesDiscovered: queuedUrls.size,
          pagesSkipped,
          pagesFailed: errorCount,
          currentHost: currentDomain,
          lastRetryReason: check.reason,
          statusCode: 403
        });
        continue;
      }
    }

    visited.add(url);

    // 4. Domain-aware rate limiting & courteous delay
    const effectiveDelay = Math.max(delayMs, robotsCrawlDelayMs || 0);
    if (effectiveDelay > 0 && visited.size > 1) {
      onProgress?.({
        url,
        depth,
        pagesVisited: visited.size,
        maxPages,
        queueLength: toVisit.length,
        emailsFoundOnPage: 0,
        totalUniqueEmails: recordsMap.size,
        phase: 'throttled',
        pagesDiscovered: queuedUrls.size,
        pagesSkipped,
        pagesFailed: errorCount,
        currentHost: currentDomain
      });
      await domainRateLimiter.throttleDomain(currentDomain, effectiveDelay);
    }

    // 5. Fetch Page with Retries & HTTP Classification
    let pageTitle = '';
    let html = '';
    let pageRecords: ScrapedEmailRecord[] = [];
    let fetchSuccess = false;
    let attempt = 0;
    const retryBudgetStart = Date.now();

    while (attempt <= maxRetries && !fetchSuccess) {
      if (isCancelled && isCancelled()) break;

      try {
        if (useBrowser && browser) {
          // Browser Execution Path
          const isAllowed = process.env.ALLOW_LOCAL_SCRAPING === 'true' || process.env.NODE_ENV === 'test';
          const validation = await validateSafeScrapeUrl(url, { allowLocalhost: isAllowed });
          if (!validation.safe) {
            throw new Error(`SSRF blocked crawl to unsafe URL: ${validation.error || url}`);
          }

          const page = await browser.newPage();
          try {
            await hardenBrowserPage(page, { allowLocalhost: isAllowed });
            await page.goto(url, { waitUntil, timeout });
            html = await page.content();
            pageTitle = extractPageTitle(html);
            pageRecords = extractEmailRecordsFromHtml(html, url, pageTitle, depth);
            fetchSuccess = true;
          } finally {
            await page.close().catch(() => {});
          }
        } else {
          // HTTP Execution Path
          const fetchResult = await safeFetch(url, {
            timeout,
            userAgent,
            allowLocalhost: process.env.ALLOW_LOCAL_SCRAPING === 'true' || process.env.NODE_ENV === 'test'
          });

          const classification = classifyHttpStatus(fetchResult.status, fetchResult.headers);

          if (classification.category === 'ACCESS_RESTRICTED') {
            globalAccessRestrictedReason = `${classification.userReason} on ${url}`;
            throw new Error(classification.userReason);
          }

          if (classification.category === 'NOT_FOUND') {
            // Non-retryable
            throw new Error(classification.userReason);
          }

          if (classification.category === 'RATE_LIMITED' || classification.category === 'TRANSIENT_SERVER_ERROR') {
            if (attempt < maxRetries && (Date.now() - retryBudgetStart) < maxRetryBudgetMs) {
              attempt++;
              totalRetries++;
              lastRetryReason = classification.userReason;
              const backoff = classification.retryAfterMs || calculateBackoffWithJitter(attempt, 800, 10000);
              await sleep(backoff);
              continue;
            } else {
              throw new Error(`HTTP ${fetchResult.status}: ${classification.userReason}`);
            }
          }

          if (fetchResult.status >= 400) {
            throw new Error(`HTTP ${fetchResult.status}`);
          }

          const contentType = fetchResult.headers.get('content-type') || '';
          if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
            pagesSkipped++;
            fetchSuccess = true;
            break;
          }

          html = fetchResult.text;
          pageTitle = extractPageTitle(html);
          pageRecords = extractEmailRecordsFromHtml(html, fetchResult.finalUrl, pageTitle, depth);
          fetchSuccess = true;
        }
      } catch (err: any) {
        if (attempt >= maxRetries || (Date.now() - retryBudgetStart) >= maxRetryBudgetMs) {
          errorCount++;
          const errorObj = err instanceof Error ? err : new Error(String(err));
          onError?.(url, errorObj);
          break;
        }
        attempt++;
        totalRetries++;
        lastRetryReason = err.message;
        await sleep(calculateBackoffWithJitter(attempt, 600, 8000));
      }
    }

    if (!fetchSuccess) {
      onProgress?.({
        url,
        depth,
        pagesVisited: visited.size,
        maxPages,
        queueLength: toVisit.length,
        emailsFoundOnPage: 0,
        totalUniqueEmails: recordsMap.size,
        statusCode: 500,
        phase: 'crawling',
        pagesDiscovered: queuedUrls.size,
        pagesSkipped,
        pagesFailed: errorCount,
        retriesCount: totalRetries,
        lastRetryReason,
        currentHost: currentDomain,
        accessRestrictedReason: globalAccessRestrictedReason
      });
      continue;
    }

    // 6. Record newly discovered unique emails
    let newEmailsCount = 0;
    for (const rec of pageRecords) {
      if (!recordsMap.has(rec.email)) {
        recordsMap.set(rec.email, rec);
        newEmailsCount++;
        onRecordFound?.(rec);
      }
    }

    onPageVisited?.(url, depth, pageRecords.length);

    onProgress?.({
      url,
      depth,
      pagesVisited: visited.size,
      maxPages,
      queueLength: toVisit.length,
      emailsFoundOnPage: pageRecords.length,
      totalUniqueEmails: recordsMap.size,
      pageTitle,
      statusCode: 200,
      phase: 'crawling',
      pagesDiscovered: queuedUrls.size,
      pagesSkipped,
      pagesFailed: errorCount,
      retriesCount: totalRetries,
      currentHost: currentDomain
    });

    // 7. Check Canonical URL to avoid duplicate crawl trees
    const canonical = extractCanonicalUrl(html, url);
    if (canonical && canonical !== url && !visited.has(canonical) && !queuedUrls.has(canonical)) {
      if (!sameDomainOnly || getDomain(canonical) === startDomain) {
        queuedUrls.add(canonical);
        toVisit.push({
          url: canonical,
          depth,
          priority: isHighPriorityContactUrl(canonical)
        });
      }
    }

    // 8. Extract Links for Next Depth Level
    if (depth < maxDepth && visited.size < maxPages) {
      const links = extractLinks(html, url);
      links.forEach((link) => {
        if (!visited.has(link) && !queuedUrls.has(link)) {
          if (!sameDomainOnly || getDomain(link) === startDomain) {
            queuedUrls.add(link);
            const isPriority = isHighPriorityContactUrl(link);
            toVisit.push({ url: link, depth: depth + 1, priority: isPriority });
          }
        }
      });
    }
  }

  return {
    records: Array.from(recordsMap.values()),
    pagesVisited: visited.size,
    pagesSkipped,
    pagesFailed: errorCount,
    errors: errorCount,
    accessRestrictedReason: globalAccessRestrictedReason
  };
}

/**
 * Crawls a website and scrapes emails (backwards-compatible Set<string> return)
 */
export async function scrapeEmailsFromWebsite(
  startUrl: string,
  options: WebsiteCrawlerOptions = {}
): Promise<Set<string>> {
  const result = await scrapeEmailRecordsFromWebsite(startUrl, options);
  return new Set(result.records.map(r => r.email));
}
