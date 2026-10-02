import { z } from 'zod';
import { CRAWL_SECURITY_LIMITS } from '../utils/security';

/**
 * Centralized Zod Schemas for Runtime Input Validation (Phase Four API Hardening)
 * Compatible with Zod v4 and TypeScript strict mode.
 * Every schema enforces strict property checking, type bounds, and value constraints.
 */

// Custom validator for safe http/https URL string
export const SafeUrlSchema = z
  .string()
  .min(1, 'URL cannot be empty')
  .max(2048, 'URL exceeds maximum length of 2048 characters')
  .refine(
    (val: string) => {
      if (/[\0\r\n\t]/.test(val)) return false;
      try {
        const u = new URL(val);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid HTTP or HTTPS URL without control characters' }
  );

// Safe Email Schema per RFC 5321 length limits (max 320 characters)
export const SafeEmailSchema = z
  .string()
  .min(3, 'Email too short')
  .max(320, 'Email exceeds maximum RFC 5321 length of 320 characters')
  .refine((val: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), {
    message: 'Invalid email address format'
  });

/**
 * Single-Page Scraping Schema
 * Validates target URL, timeout bounds, and crawler configurations
 */
export const SinglePageScrapeSchema = z
  .object({
    url: SafeUrlSchema,
    timeout: z
      .number()
      .int('timeout must be an integer')
      .min(1000, 'Timeout must be at least 1000ms')
      .max(60000, 'Timeout cannot exceed 60000ms')
      .optional()
      .default(12000),
    userAgent: z
      .string()
      .max(512, 'userAgent exceeds maximum length of 512 characters')
      .refine((val: string) => !/[\r\n]/.test(val), { message: 'userAgent cannot contain CRLF characters' })
      .optional(),
    useBrowser: z.boolean().optional().default(false),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional().default('load'),
    allowLocalhost: z.boolean().optional()
  })
  .strict();

/**
 * Text Scraping Schema
 * Validates raw HTML/text payload with size bounds
 */
export const TextScrapeSchema = z
  .object({
    text: z
      .string()
      .min(1, 'Text content is required')
      .max(10_000_000, 'Text payload exceeds maximum size of 10MB'),
    sourceName: z
      .string()
      .max(256, 'sourceName exceeds maximum length of 256 characters')
      .optional()
      .default('Manual Input'),
    sourceUrl: z
      .string()
      .max(2048, 'sourceUrl exceeds maximum length of 2048 characters')
      .optional()
  })
  .strict();

/**
 * Website Crawling Schema
 * Validates starting URL, page limits, crawl depth caps, and delays
 */
export const WebsiteCrawlSchema = z
  .object({
    url: SafeUrlSchema,
    maxPages: z
      .number()
      .int('maxPages must be an integer')
      .min(1, 'maxPages must be at least 1')
      .max(CRAWL_SECURITY_LIMITS.MAX_PAGES_CAP, `maxPages cannot exceed ${CRAWL_SECURITY_LIMITS.MAX_PAGES_CAP}`)
      .optional()
      .default(30),
    maxDepth: z
      .number()
      .int('maxDepth must be an integer')
      .min(1, 'maxDepth must be at least 1')
      .max(CRAWL_SECURITY_LIMITS.MAX_DEPTH_CAP, `maxDepth cannot exceed ${CRAWL_SECURITY_LIMITS.MAX_DEPTH_CAP}`)
      .optional()
      .default(2),
    sameDomainOnly: z.boolean().optional().default(true),
    useBrowser: z.boolean().optional().default(false),
    delayMs: z
      .number()
      .int('delayMs must be an integer')
      .min(0, 'delayMs cannot be negative')
      .max(30000, 'delayMs cannot exceed 30000ms')
      .optional()
      .default(250),
    timeout: z
      .number()
      .int('timeout must be an integer')
      .min(1000, 'timeout must be at least 1000ms')
      .max(60000, 'timeout cannot exceed 60000ms')
      .optional()
      .default(15000),
    headers: z
      .record(z.string(), z.string().max(1024))
      .optional()
      .refine(
        (hdrs) => {
          if (!hdrs) return true;
          for (const [k, v] of Object.entries(hdrs)) {
            if (/[\r\n]/.test(String(k)) || /[\r\n]/.test(String(v))) return false;
          }
          return true;
        },
        { message: 'Headers cannot contain CRLF carriage return or newline characters' }
      ),
    userAgent: z
      .string()
      .max(512, 'userAgent exceeds 512 characters')
      .refine((val: string) => !/[\r\n]/.test(val), { message: 'userAgent cannot contain CRLF characters' })
      .optional(),
    respectRobotsTxt: z.boolean().optional().default(true),
    contactEmail: z.string().email('contactEmail must be a valid email address').max(255).optional()
  })
  .strict();

/**
 * Batch URL Scraping Schema
 * Validates URL list and caps batch count to 100
 */
export const BatchScrapeSchema = z
  .object({
    urls: z
      .array(z.string().min(1).max(2048))
      .min(1, 'An array of URLs is required')
      .max(100, 'Batch scrape limit exceeded. Maximum 100 URLs per batch request.'),
    concurrency: z
      .number()
      .int('concurrency must be an integer')
      .min(1, 'Concurrency must be at least 1')
      .max(CRAWL_SECURITY_LIMITS.MAX_CONCURRENCY_CAP, `Concurrency cannot exceed ${CRAWL_SECURITY_LIMITS.MAX_CONCURRENCY_CAP}`)
      .optional()
      .default(3),
    timeout: z
      .number()
      .int('timeout must be an integer')
      .min(1000, 'Timeout must be at least 1000ms')
      .max(60000, 'Timeout cannot exceed 60000ms')
      .optional()
      .default(12000),
    delayMs: z
      .number()
      .int('delayMs must be an integer')
      .min(0, 'delayMs cannot be negative')
      .max(30000, 'delayMs cannot exceed 30000ms')
      .optional()
      .default(150)
  })
  .strict();

/**
 * Crawl Job ID Parameter Schema
 */
export const JobIdParamSchema = z
  .object({
    jobId: z
      .string()
      .min(1, 'Job ID cannot be empty')
      .max(128, 'Job ID exceeds maximum length')
      .regex(/^[a-zA-Z0-9_-]+$/, 'Job ID contains invalid characters')
  })
  .strict();

/**
 * Bulk Import Schema
 */
export const BulkImportSchema = z
  .object({
    text: z
      .string()
      .max(10 * 1024 * 1024, 'Import file size exceeds 10MB limit')
      .optional(),
    content: z
      .string()
      .max(10 * 1024 * 1024, 'Import file size exceeds 10MB limit')
      .optional(),
    records: z
      .array(z.record(z.string(), z.any()))
      .max(50_000, 'Maximum 50,000 records allowed per import')
      .optional(),
    verifyNow: z.boolean().optional().default(false),
    sourceName: z.string().max(256).optional().default('Imported List'),
    defaultCompany: z.string().max(256).optional(),
    jobId: z.string().max(128).optional(),
    format: z.enum(['csv', 'txt', 'json', 'tsv']).optional()
  })
  .refine(
    (data) => (data.text && data.text.trim().length > 0) ||
              (data.content && data.content.trim().length > 0) ||
              (Array.isArray(data.records) && data.records.length > 0),
    { message: 'Text content or records array is required for import' }
  )
  .strict();

/**
 * Bulk Validator Schema
 */
export const BulkValidatorSchema = z
  .object({
    csv: z.string().max(10 * 1024 * 1024, 'File size exceeds 10MB limit').optional(),
    text: z.string().max(10 * 1024 * 1024, 'File size exceeds 10MB limit').optional(),
    fileContent: z.string().max(10 * 1024 * 1024, 'File size exceeds 10MB limit').optional(),
    content: z.string().max(10 * 1024 * 1024, 'File size exceeds 10MB limit').optional(),
    records: z.array(z.any()).max(10_000, 'Cannot process more than 10,000 addresses in a single bulk validator run').optional(),
    emails: z.array(z.string().max(320)).max(10_000, 'Cannot process more than 10,000 addresses in a single bulk validator run').optional(),
    fileType: z.enum(['csv', 'txt']).optional(),
    autoVerifySmtp: z.boolean().optional().default(true)
  })
  .refine(
    (data) => Boolean(
      (data.csv && data.csv.trim().length > 0) ||
      (data.text && data.text.trim().length > 0) ||
      (data.fileContent && data.fileContent.trim().length > 0) ||
      (data.content && data.content.trim().length > 0) ||
      (Array.isArray(data.records) && data.records.length > 0) ||
      (Array.isArray(data.emails) && data.emails.length > 0)
    ),
    { message: 'Upload a CSV or TXT file content, or supply records/emails array' }
  )
  .strict();

/**
 * MX Verification Schema
 */
export const VerifyMxSchema = z
  .object({
    records: z.array(z.any()).max(5000, 'Cannot verify more than 5,000 records at once').optional(),
    emails: z.array(z.string().max(320)).max(5000, 'Cannot verify more than 5,000 records at once').optional()
  })
  .refine(
    (data) => (Array.isArray(data.records) && data.records.length > 0) ||
              (Array.isArray(data.emails) && data.emails.length > 0),
    { message: 'Valid records or emails array is required' }
  )
  .strict();

/**
 * Export Request Schema
 */
export const ExportRequestSchema = z
  .object({
    records: z
      .array(z.record(z.string(), z.any()))
      .min(1, 'Records array is required')
      .max(50_000, 'Cannot export more than 50,000 records at once'),
    format: z
      .enum(['csv', 'json', 'txt', 'vcf'] as const)
      .optional()
      .default('csv'),
    segment: z
      .enum(['all', 'clean', 'risky', 'personal', 'role', 'deliverable', 'undeliverable', 'disposable'] as const)
      .optional()
      .default('all'),
    fields: z.array(z.string().max(64)).max(50, 'Maximum 50 fields permitted').optional(),
    columns: z.array(z.string().max(64)).max(50, 'Maximum 50 columns permitted').optional(),
    filename: z.string().max(128, 'Filename exceeds maximum length of 128 characters').optional(),
    filterSuppressed: z.boolean().optional().default(false)
  })
  .strict();

/**
 * HUNTIQ Synchronization Schema
 */
export const HuntIQSyncSchema = z
  .object({
    records: z
      .array(z.record(z.string(), z.any()))
      .min(1, 'Valid records array is required')
      .max(5000, 'Maximum 5,000 records allowed per sync batch')
      .optional(),
    contacts: z
      .array(z.record(z.string(), z.any()))
      .min(1, 'Valid records array is required')
      .max(5000, 'Maximum 5,000 contacts allowed per sync batch')
      .optional(),
    jobId: z.string().max(128).optional(),
    companyDomain: z.string().max(256).optional(),
    companyWebsite: z.string().max(2048).optional(),
    companyName: z.string().max(256).optional(),
    sourceType: z.string().max(64).optional(),
    segment: z.string().max(64).optional(),
    options: z.record(z.string(), z.any()).optional(),
    // Untrusted client overrides that server strictly ignores
    apiKey: z.string().max(512).optional(),
    workspaceId: z.string().max(128).optional(),
    huntiqApiUrl: z.string().max(2048).optional(),
    userId: z.string().max(128).optional(),
    role: z.string().max(64).optional()
  })
  .refine(
    (data) => (Array.isArray(data.records) && data.records.length > 0) ||
              (Array.isArray(data.contacts) && data.contacts.length > 0),
    { message: 'Valid records array is required' }
  )
  .strict();

/**
 * HUNTIQ Configuration Schema
 */
export const HuntIQConfigSchema = z
  .object({
    apiUrl: z
      .string()
      .max(2048, 'apiUrl exceeds maximum length')
      .optional()
      .refine(
        (val) => {
          if (!val) return true;
          try {
            const u = new URL(val);
            return u.protocol === 'http:' || u.protocol === 'https:';
          } catch {
            return false;
          }
        },
        { message: 'apiUrl must be a valid URL (http or https only)' }
      ),
    apiKey: z.string().max(512, 'apiKey exceeds maximum length').optional(),
    enabled: z.boolean().optional(),
    timeoutMs: z
      .number()
      .int('timeoutMs must be an integer')
      .min(1000, 'timeoutMs must be between 1000 and 120000ms')
      .max(120000, 'timeoutMs must be between 1000 and 120000ms')
      .optional(),
    maxRetries: z
      .number()
      .int('maxRetries must be an integer')
      .min(0, 'maxRetries must be between 0 and 10')
      .max(10, 'maxRetries must be between 0 and 10')
      .optional()
  })
  .strict();

/**
 * Authentication / Token Generation Schema
 */
export const AuthTokenSchema = z
  .object({
    username: z
      .string()
      .min(1, 'Username is required')
      .max(64, 'Username exceeds maximum length of 64 characters')
      .optional(),
    password: z
      .string()
      .min(1, 'Password cannot be empty')
      .max(128, 'Password exceeds maximum length of 128 characters')
      .optional(),
    role: z.enum(['admin', 'user', 'readonly', 'service'] as const).optional().default('user'),
    apiKey: z.string().min(1).max(256).optional()
  })
  .refine(
    (data) => Boolean((data.username && data.username.trim().length > 0) || data.apiKey),
    { message: 'Username is required' }
  )
  .strict();

/**
 * Programmatic API Key Creation Schema
 */
export const CreateApiKeySchema = z
  .object({
    name: z
      .string()
      .min(1, 'Key name cannot be empty')
      .max(100, 'Key name exceeds 100 characters')
      .optional()
      .default('API Key'),
    role: z.enum(['admin', 'user', 'readonly', 'service'] as const).optional().default('user'),
    expiresInDays: z
      .number()
      .int('expiresInDays must be an integer')
      .min(1, 'expiresInDays must be at least 1')
      .max(365, 'expiresInDays cannot exceed 365')
      .optional()
  })
  .strict();

/**
 * Folder Management Schemas
 */
export const FolderSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Folder name is required')
      .max(100, 'Folder name cannot exceed 100 characters')
      .refine((val: string) => !/[/\\<>:"|?*]/.test(val) && !val.includes('..'), {
        message: 'Folder name cannot contain path separators or illegal characters'
      }),
    color: z.string().max(32).optional(),
    icon: z.string().max(32).optional()
  })
  .strict();

export const SaveFolderRecordsSchema = z
  .object({
    records: z
      .array(z.record(z.string(), z.any()))
      .min(1, 'Valid records array is required')
      .max(10_000, 'Cannot save more than 10,000 records at once')
  })
  .strict();

export const FolderIdParamSchema = z
  .object({
    folderId: z
      .string()
      .min(1, 'Valid folder ID is required')
      .max(128, 'Folder ID exceeds maximum length')
      .regex(/^[a-zA-Z0-9_-]+$/, 'Folder ID contains invalid characters'),
    email: z.string().max(320).optional()
  })
  .strict();

/**
 * Privacy & Suppression Schemas
 */
export const SuppressionEntrySchema = z
  .object({
    type: z.enum(['email', 'domain', 'sha256', 'md5'] as const),
    value: z.string().min(1, 'Value is required').max(320, 'Value exceeds 320 characters'),
    reason: z.enum(['unsubscribe', 'bounce', 'complaint', 'manual', 'legal', 'dnc'] as const).optional().default('manual'),
    note: z.string().max(500, 'Note exceeds 500 characters').optional()
  })
  .strict();

export const BulkSuppressionSchema = z
  .object({
    entries: z.array(SuppressionEntrySchema).min(1, 'At least 1 entry is required').max(10_000, 'Maximum 10,000 entries per batch')
  })
  .strict();

export const PrivacyConfigSchema = z
  .object({
    retentionDays: z.number().int().min(1).max(3650).optional(),
    maskEmailsInLogs: z.boolean().optional(),
    sanitizeContextSnippets: z.boolean().optional(),
    contextSnippetMaxChars: z.number().int().min(10).max(1000).optional(),
    stripContextSnippets: z.boolean().optional()
  })
  .strict();

export const DeleteRecordByEmailSchema = z
  .object({
    email: z.string().min(3).max(320)
  })
  .strict();

