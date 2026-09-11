/**
 * HUNTIQ Integration Data Contracts (Specification v1.0)
 * 
 * Defines strongly-typed schemas for communication between
 * Email Scraper (Data Acquisition) and HUNTIQ (Intelligence & CRM).
 */

export type HuntIQSourceType =
  | 'WEBSITE'
  | 'CONTACT_PAGE'
  | 'TEAM_PAGE'
  | 'ABOUT_PAGE'
  | 'FOOTER'
  | 'RAW_TEXT'
  | 'OTHER';

export type HuntIQEmailType =
  | 'PERSONAL'
  | 'ROLE_BASED'
  | 'UNKNOWN';

export type HuntIQEmailStatus =
  | 'FOUND'
  | 'VALIDATED'
  | 'UNVERIFIED';

export interface HuntIQIdentityInference {
  firstName?: string;
  lastName?: string;
  confidence: number;
  source: 'email_local_part' | 'surrounding_text' | 'dom_pattern';
}

export interface HuntIQContact {
  email: string;
  emailType: HuntIQEmailType;
  emailStatus: HuntIQEmailStatus;
  confidence: number;
  sourceUrl: string | null;
  sourceType: HuntIQSourceType;
  /** Explicitly verified name discovered on the page (null if inferred) */
  name: string | null;
  /** Explicitly detected role/job title */
  jobTitle: string | null;
  /** Separated identity inference data when name was inferred rather than verified */
  identityInference?: HuntIQIdentityInference;
  /** Indicates source of name if verified */
  identitySource?: 'website' | 'inferred';
  phone: string | null;
  socials: {
    linkedin?: string;
    twitter?: string;
    github?: string;
    [key: string]: string | undefined;
  };
  contextSnippet?: string;
  depth?: number;
  discoveredAt: string;
  mxRecords?: string[];
}

export interface HuntIQCompany {
  /** Explicitly discovered company name; null if not explicitly found */
  name: string | null;
  /** Host domain of target */
  domain: string | null;
  /** Discovered canonical website URL; null if not explicitly discovered */
  website: string | null;
}

export interface HuntIQSyncPayload {
  integration: 'email-scraper';
  version: '1.0';
  requestId: string;
  source: {
    type: 'website_email_scraper' | 'batch_scraper' | 'raw_text_extractor';
    jobId?: string;
  };
  company: HuntIQCompany;
  contacts: HuntIQContact[];
}

export interface HuntIQSyncResponse {
  success: boolean;
  requestId: string;
  accepted: number;
  rejected: number;
  duplicates: number;
  errors: string[];
  huntiqResponse?: any;
}

export interface HuntIQConnectionTestResult {
  success: boolean;
  integration: 'huntiq';
  reachable: boolean;
  authenticated: boolean;
  message?: string;
  statusCode?: number;
}
