import { extractAndNormalizeEmails, extractEmailRecordsFromHtml, extractPageTitle } from '../utils/emailExtractor';
import { ScrapedEmailRecord } from '../types/record';
import { safeFetch } from '../utils/security';

/**
 * Options for HTTP scraping
 */
export interface HttpScraperOptions {
  timeout?: number;
  headers?: Record<string, string>;
  userAgent?: string;
  allowLocalhost?: boolean;
}

/**
 * Scrapes detailed email records with page title and context snippets from a single webpage
 * Enforces SSRF checks, redirect safety, and memory-safe streaming limits
 */
export async function scrapeEmailRecordsFromUrl(
  url: string,
  options: HttpScraperOptions = {}
): Promise<{ records: ScrapedEmailRecord[]; pageTitle: string; statusCode: number }> {
  const {
    timeout = 10000,
    headers = {},
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    allowLocalhost = process.env.ALLOW_LOCAL_SCRAPING === 'true' || process.env.NODE_ENV === 'test'
  } = options;

  try {
    const fetchResult = await safeFetch(url, {
      timeout,
      headers,
      userAgent,
      allowLocalhost
    });

    if (fetchResult.status >= 400) {
      throw new Error(`HTTP error! status: ${fetchResult.status}`);
    }

    const html = fetchResult.text;
    const pageTitle = extractPageTitle(html);
    const records = extractEmailRecordsFromHtml(html, fetchResult.finalUrl, pageTitle);

    return { records, pageTitle, statusCode: fetchResult.status };
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
