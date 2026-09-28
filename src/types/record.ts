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
  mxStatus?: 'deliverable' | 'undeliverable' | 'disposable' | 'unverified' | 'pending' | 'risky';
  /** Resolved MX mail exchange servers */
  mxRecords?: string[];
  /** Validation and metadata flags */
  validity?: {
    syntax: boolean;
    tld: boolean;
    isDisposable: boolean;
    isCatchAll?: boolean;
    provider?: string;
  };
  /** Identified Email Service Provider / Mail Server (e.g. Google Workspace, Microsoft 365, Proofpoint) */
  provider?: string;
  /** Whether the domain mail server operates as a Catch-All / Accept-All gateway */
  isCatchAll?: boolean;
  /** Associated company or organization name */
  company?: string;
  /** Categorization: Business, Personal, or General */
  emailCategory?: 'Business' | 'Personal' | 'General';
  /** Scrape or Import Job ID */
  jobId?: string;
  /** Custom organizational tags */
  tags?: string[];
  /** Calculated accuracy / discovery confidence percentage */
  confidence?: number;
  /** Layer 1: Canonical deduplicated form (lowercase, subaddressing tags stripped, dot normalized) */
  canonicalEmail?: string;
  /** Layer 1: Levenshtein typo suggestion if mistyped domain detected */
  typoSuggestion?: string | null;
  /** Layer 1: Shannon entropy score (0.0 to 1.0) of local-part */
  entropyScore?: number;
  /** Layer 1: Whether local-part exhibits high entropy / gibberish pattern */
  isGibberish?: boolean;
  /** Layer 1: Free public email provider (Gmail, Yahoo, Hotmail, etc.) */
  isFreeMail?: boolean;
  /** Layer 1: Role-based group alias (support, info, sales, admin, etc.) */
  isRoleAccount?: boolean;
  /** Layer 1: Known spam trap / honeypot pattern */
  isSpamTrap?: boolean;
  /** Layer 1: Static checks summary (how many of the 16 checks passed) */
  staticChecks?: {
    passed: number;
    total: number;
    failedChecks: string[];
    details?: Record<string, { pass: boolean; reason?: string }>;
  };
  /** Layer 2: Complete MX Enrichment Block */
  mxEnrichment?: {
    ip: string;
    hostname: string;
    priority: number;
    country: string;
    city: string;
    isp: string;
    asn: string;
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
