import { Page } from '../types/browser';
import { extractAndNormalizeEmails } from '../utils/emailExtractor';
import { validateSafeScrapeUrl } from '../utils/security';
import { hardenBrowserPage } from '../utils/browserSecurity';

/**
 * Options for webpage scraping
 */
export interface WebpageScraperOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
  allowLocalhost?: boolean;
}

/**
 * Scrapes emails from a webpage using a browser page instance
 */
export async function scrapeEmailsFromPage(
  page: Page,
  url: string,
  options: WebpageScraperOptions = {}
): Promise<Set<string>> {
  const { waitUntil = 'load', timeout = 30000, allowLocalhost } = options;

  const isAllowed = allowLocalhost !== undefined
    ? allowLocalhost
    : (process.env.ALLOW_LOCAL_SCRAPING === 'true' || process.env.NODE_ENV === 'test');

  // Enforce SSRF validation before browser navigation
  const validation = await validateSafeScrapeUrl(url, {
    allowLocalhost: isAllowed
  });

  if (!validation.safe) {
    throw new Error(`SSRF blocked navigation to unsafe URL: ${validation.error || url}`);
  }

  // Harden page against subresource SSRF, popups, and malicious downloads
  await hardenBrowserPage(page, { allowLocalhost: isAllowed });

  try {
    await page.goto(url, {
      waitUntil,
      timeout,
    });

    const content = await page.content();
    return extractAndNormalizeEmails(content);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to scrape ${url}: ${error.message}`);
    }
    throw error;
  }
}

