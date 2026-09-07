import { extractAndNormalizeEmails, extractEmailRecordsFromHtml, extractPageTitle } from '../utils/emailExtractor';
import { ScrapedEmailRecord } from '../types/record';

/**
 * Options for HTTP scraping
 */
export interface HttpScraperOptions {
  timeout?: number;
  headers?: Record<string, string>;
  userAgent?: string;
}

/**
 * Scrapes detailed email records with page title and context snippets from a single webpage
 */
export async function scrapeEmailRecordsFromUrl(
  url: string,
  options: HttpScraperOptions = {}
): Promise<{ records: ScrapedEmailRecord[]; pageTitle: string; statusCode: number }> {
  const {
    timeout = 10000,
    headers = {},
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  } = options;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...headers,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const pageTitle = extractPageTitle(html);
    const records = extractEmailRecordsFromHtml(html, url, pageTitle);

    return { records, pageTitle, statusCode: response.status };
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
