import { Browser } from '../types/browser';
import { scrapeEmailsFromPage } from './webpageScraper';
import { extractAndNormalizeEmails, extractEmailRecordsFromHtml, extractPageTitle } from '../utils/emailExtractor';
import { ScrapedEmailRecord } from '../types/record';

/**
 * Real-time crawl progress event data
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
}

/**
 * Options for website crawling
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
 * Normalizes a URL (resolves relative URLs, removes fragments)
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
    if (pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|woff|woff2|ttf|pdf|zip|mp4|webm)$/)) {
      return null;
    }
    return resolved.href;
  } catch {
    return null;
  }
}

/**
 * Extracts links from HTML content
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
 * Crawls a website and returns detailed ScrapedEmailRecords
 */
export async function scrapeEmailRecordsFromWebsite(
  startUrl: string,
  options: WebsiteCrawlerOptions = {}
): Promise<{ records: ScrapedEmailRecord[]; pagesVisited: number; errors: number }> {
  const {
    maxDepth = 3,
    maxPages = 50,
    sameDomainOnly = true,
    waitUntil = 'load',
    timeout = 15000,
    delayMs = 200,
    useBrowser = false,
    browser,
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    onPageVisited,
    onProgress,
    onRecordFound,
    onError,
    isCancelled,
  } = options;

  const recordsMap = new Map<string, ScrapedEmailRecord>();
  const visited = new Set<string>();
  const toVisit: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
  const startDomain = getDomain(startUrl);
  let errorCount = 0;

  while (toVisit.length > 0 && visited.size < maxPages) {
    if (isCancelled && isCancelled()) {
      break;
    }

    const current = toVisit.shift()!;
    const { url, depth } = current;

    if (visited.has(url)) {
      continue;
    }

    if (depth > maxDepth) {
      continue;
    }

    // Check domain restriction
    if (sameDomainOnly && getDomain(url) !== startDomain) {
      continue;
    }

    visited.add(url);

    // Rate limiting delay between crawls
    if (delayMs > 0 && visited.size > 1) {
      await sleep(delayMs);
    }

    try {
      let pageTitle = '';
      let html = '';
      let pageRecords: ScrapedEmailRecord[] = [];

      if (useBrowser && browser) {
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil, timeout });
          html = await page.content();
          pageTitle = extractPageTitle(html);
          pageRecords = extractEmailRecordsFromHtml(html, url, pageTitle, depth);
        } finally {
          await page.close();
        }
      } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
          continue;
        }

        html = await response.text();
        pageTitle = extractPageTitle(html);
        pageRecords = extractEmailRecordsFromHtml(html, url, pageTitle, depth);
      }

      // Record newly found emails
      let newEmailsCount = 0;
      for (const rec of pageRecords) {
        if (!recordsMap.has(rec.email)) {
          recordsMap.set(rec.email, rec);
          newEmailsCount++;
          if (onRecordFound) {
            onRecordFound(rec);
          }
        }
      }

      if (onPageVisited) {
        onPageVisited(url, depth, pageRecords.length);
      }

      if (onProgress) {
        onProgress({
          url,
          depth,
          pagesVisited: visited.size,
          maxPages,
          queueLength: toVisit.length,
          emailsFoundOnPage: pageRecords.length,
          totalUniqueEmails: recordsMap.size,
          pageTitle,
          statusCode: 200,
        });
      }

      // Extract links for next depth level
      if (depth < maxDepth) {
        const links = extractLinks(html, url);
        links.forEach((link) => {
          if (!visited.has(link) && (!sameDomainOnly || getDomain(link) === startDomain)) {
            // Avoid queue duplicates
            if (!toVisit.some((item) => item.url === link)) {
              toVisit.push({ url: link, depth: depth + 1 });
            }
          }
        });
      }
    } catch (error) {
      errorCount++;
      const errorObj = error instanceof Error ? error : new Error(String(error));
      if (onError) {
        onError(url, errorObj);
      }
      if (onProgress) {
        onProgress({
          url,
          depth,
          pagesVisited: visited.size,
          maxPages,
          queueLength: toVisit.length,
          emailsFoundOnPage: 0,
          totalUniqueEmails: recordsMap.size,
          statusCode: 500,
        });
      }
    }
  }

  return {
    records: Array.from(recordsMap.values()),
    pagesVisited: visited.size,
    errors: errorCount,
  };
}

/**
 * Crawls a website and scrapes emails from all pages (backwards-compatible Set<string> return)
 */
export async function scrapeEmailsFromWebsite(
  startUrl: string,
  options: WebsiteCrawlerOptions = {}
): Promise<Set<string>> {
  const result = await scrapeEmailRecordsFromWebsite(startUrl, options);
  return new Set(result.records.map(r => r.email));
}
