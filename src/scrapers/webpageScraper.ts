import { Page } from '../types/browser';
import { extractAndNormalizeEmails } from '../utils/emailExtractor';
import { validateSafeScrapeUrl } from '../utils/security';

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

  // Enforce SSRF validation before browser navigation
  const validation = await validateSafeScrapeUrl(url, {
    allowLocalhost: allowLocalhost !== undefined
      ? allowLocalhost
      : (process.env.ALLOW_LOCAL_SCRAPING === 'true' || process.env.NODE_ENV === 'test')
  });

  if (!validation.safe) {
    throw new Error(`SSRF blocked navigation to unsafe URL: ${validation.error || url}`);
  }

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

