/**
 * Represents a structured, enriched email record extracted from web scraping
 */
export interface ScrapedEmailRecord {
  /** Normalized lowercase email address */
  email: string;
  /** Host domain of the email address (e.g., acme.org) */
  domain: string;
  /** Email categorization: 'role' (generic like info@, support@) vs 'personal' */
  type: 'role' | 'personal';
  /** The full URL where the email was located */
  sourceUrl: string;
  /** HTML Page Title where the email was discovered */
  pageTitle?: string;
  /** Surrounding text snippet where the email was mentioned */
  contextSnippet?: string;
  /** Depth level in crawler where the page was visited */
  depth?: number;
  /** ISO timestamp of discovery */
  discoveredAt: string;
  /** Inferred person or team name */
  name?: string;
  /** Inferred or detected job title / executive role */
  jobTitle?: string;
  /** Contact phone number if discovered */
  phone?: string;
  /** Social profiles discovered on source page */
  socials?: {
    linkedin?: string;
    twitter?: string;
    github?: string;
  };
  /** Live MX record deliverability status */
  mxStatus?: 'deliverable' | 'undeliverable' | 'disposable' | 'unverified';
  /** Resolved MX mail exchange servers */
  mxRecords?: string[];
  /** Validation and metadata flags */
  validity?: {
    syntax: boolean;
    tld: boolean;
    isDisposable: boolean;
  };
}

/**
 * Summary of a crawl or scrape session
 */
export interface ScrapeSessionSummary {
  targetUrl: string;
  pagesVisited: number;
  emailsFound: number;
  uniqueDomains: number;
  roleCount: number;
  personalCount: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
}

/**
 * Supported export formats
 */
export type ExportFormat = 'csv' | 'json' | 'txt' | 'vcf';
