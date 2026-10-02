import { extractAndNormalizeEmails, extractEmailRecordsFromHtml, extractPageTitle } from '../utils/emailExtractor';
import { ScrapedEmailRecord } from '../types/record';
import { safeFetch } from '../utils/security';
import { getDefaultUserAgent, classifyHttpStatus } from './crawlerPolicy';

/**
 * Options for HTTP scraping
 */
export interface HttpScraperOptions {
  timeout?: number;
  headers?: Record<string, string>;
  userAgent?: string;
  contactEmail?: string;
  allowLocalhost?: boolean;
}

/**
 * Scrapes detailed email records with page title and context snippets from a single webpage
 * Enforces SSRF checks, redirect safety, memory-safe streaming limits, and policy compliance
 */
export async function scrapeEmailRecordsFromUrl(
  url: string,
  options: HttpScraperOptions = {}
): Promise<{ records: ScrapedEmailRecord[]; pageTitle: string; statusCode: number; statusCategory?: string }> {
  const {
    timeout = 10000,
    headers = {},
    userAgent = getDefaultUserAgent(options.contactEmail),
    allowLocalhost = process.env.ALLOW_LOCAL_SCRAPING === 'true' || process.env.NODE_ENV === 'test'
  } = options;

  try {
    const fetchResult = await safeFetch(url, {
      timeout,
      headers,
      userAgent,
      allowLocalhost
    });

    const classification = classifyHttpStatus(fetchResult.status, fetchResult.headers);

    if (fetchResult.status >= 400) {
      throw new Error(`HTTP ${fetchResult.status}: ${classification.userReason}`);
    }

    const html = fetchResult.text;
    const pageTitle = extractPageTitle(html);
    const records = extractEmailRecordsFromHtml(html, fetchResult.finalUrl, pageTitle);

    return {
      records,
      pageTitle,
      statusCode: fetchResult.status,
      statusCategory: classification.category
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to scrape ${url}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Scrapes emails from a webpage using HTTP requests (backwards-compatible Set<string> return)
 */
export async function scrapeEmailsFromUrl(
  url: string,
  options: HttpScraperOptions = {}
): Promise<Set<string>> {
  const result = await scrapeEmailRecordsFromUrl(url, options);
  return new Set(result.records.map(r => r.email));
}
