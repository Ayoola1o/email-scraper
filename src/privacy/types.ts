/**
 * Email Data Security, Privacy, and Compliance Types (Phase Six)
 */

export type SuppressionType = 'email' | 'domain' | 'sha256' | 'md5';

export type SuppressionReason =
  | 'UNSUBSCRIBE'
  | 'BOUNCE'
  | 'DO_NOT_CONTACT'
  | 'COMPLAINT'
  | 'MANUAL'
  | 'LEGAL_REQUEST';

export interface SuppressionEntry {
  id: string;
  type: SuppressionType;
  value: string;
  reason: SuppressionReason;
  addedByUserId?: string;
  createdAt: string;
  note?: string;
}

export interface SuppressionCheckResult {
  isSuppressed: boolean;
  reason?: SuppressionReason;
  matchedType?: SuppressionType;
  matchedValue?: string;
}

export interface ExportAuditLog {
  id: string;
  userId: string;
  userRole: string;
  timestamp: string;
  format: 'csv' | 'json' | 'txt' | 'vcf';
  recordCount: number;
  clientIp: string;
  exportedFields?: string[];
  exportSegment?: string;
  filename?: string;
  filterSuppressed?: boolean;
}

export interface PrivacyConfig {
  retentionDays: number;
  maskEmailsInLogs: boolean;
  sanitizeContextSnippets: boolean;
  contextSnippetMaxChars: number;
  stripContextSnippets: boolean;
  honorRobotsTxt: boolean;
}

export interface ProvenanceMetadata {
  sourceUrl: string;
  extractedAt: string;
  jobId?: string;
  depth?: number;
  extractionMethod?: 'http' | 'browser' | 'bulk_import' | 'manual';
  contextType?: 'mailto' | 'text' | 'metadata' | 'script';
  discoveryDomain?: string;
}

export interface ComplianceNotice {
  proofOfMailboxExistence: false;
  outreachConsentConfirmed: false;
  legalDisclaimer: string;
  verificationType: string;
}

export interface DeletionResult {
  success: boolean;
  deletedJobsCount: number;
  deletedRecordsCount: number;
  deletedFoldersCount: number;
  timestamp: string;
  details: string;
}
