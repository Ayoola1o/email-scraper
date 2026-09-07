/**
 * Email Scraper - A TypeScript library for scraping emails from webpages and websites
 */

export {
  extractEmails,
  normalizeEmail,
  extractAndNormalizeEmails,
  extractEmailRecordsFromHtml,
  extractPhoneNumbersFromHtml,
  extractSocialProfiles,
  detectJobTitle,
  inferNameFromEmail,
  isRoleBasedEmail,
  isDisposableDomain,
  decodeObfuscation,
  hasValidTld,
  extractPageTitle
} from './utils/emailExtractor';

export {
  verifyDomainMx,
  verifyEmailRecords
} from './utils/verifier';

export {
  scrapeEmailsFromUrl,
  scrapeEmailRecordsFromUrl,
  type HttpScraperOptions
} from './scrapers/httpScraper';

export {
  scrapeEmailsFromPage,
  type WebpageScraperOptions
} from './scrapers/webpageScraper';

export {
  scrapeEmailsFromWebsite,
  scrapeEmailRecordsFromWebsite,
  type WebsiteCrawlerOptions,
  type CrawlProgress
} from './scrapers/websiteCrawler';

export {
  toCSV,
  toJSON,
  toPlainText,
  toVCard,
  formatRecords
} from './utils/formatters';

export type {
  ScrapedEmailRecord,
  ScrapeSessionSummary,
  ExportFormat
} from './types/record';

export type { Browser, Page, BrowserFactory } from './types/browser';

/**
 * Main scraper class for easy usage
 */
export class EmailScraper {
  private browser?: import('./types/browser').Browser;

  constructor(browser?: import('./types/browser').Browser) {
    this.browser = browser;
  }

  /**
   * Scrapes emails from a single webpage using HTTP requests
   */
  async scrapeFromUrl(url: string, options?: import('./scrapers/httpScraper').HttpScraperOptions): Promise<Set<string>> {
    const { scrapeEmailsFromUrl } = await import('./scrapers/httpScraper');
    return scrapeEmailsFromUrl(url, options);
  }

  /**
   * Scrapes detailed records from a single webpage
   */
  async scrapeRecordsFromUrl(url: string, options?: import('./scrapers/httpScraper').HttpScraperOptions) {
    const { scrapeEmailRecordsFromUrl } = await import('./scrapers/httpScraper');
    return scrapeEmailRecordsFromUrl(url, options);
  }

  /**
   * Scrapes emails from a single webpage using a browser
   */
  async scrapeFromPage(
    page: import('./types/browser').Page,
    url: string,
    options?: import('./scrapers/webpageScraper').WebpageScraperOptions
  ): Promise<Set<string>> {
    const { scrapeEmailsFromPage } = await import('./scrapers/webpageScraper');
    return scrapeEmailsFromPage(page, url, options);
  }

  /**
   * Scrapes emails from an entire website by crawling
   */
  async scrapeFromWebsite(
    url: string,
    options?: Omit<import('./scrapers/websiteCrawler').WebsiteCrawlerOptions, 'browser'>
  ): Promise<Set<string>> {
    const { scrapeEmailsFromWebsite } = await import('./scrapers/websiteCrawler');
    return scrapeEmailsFromWebsite(url, {
      ...options,
      useBrowser: !!this.browser,
      browser: this.browser,
    });
  }

  /**
   * Scrapes detailed email records from an entire website by crawling
   */
  async scrapeRecordsFromWebsite(
    url: string,
    options?: Omit<import('./scrapers/websiteCrawler').WebsiteCrawlerOptions, 'browser'>
  ) {
    const { scrapeEmailRecordsFromWebsite } = await import('./scrapers/websiteCrawler');
    return scrapeEmailRecordsFromWebsite(url, {
      ...options,
      useBrowser: !!this.browser,
      browser: this.browser,
    });
  }
}
