import { randomUUID } from 'crypto';
import { ScrapedEmailRecord } from '../../types/record';
import {
  HuntIQContact,
  HuntIQEmailStatus,
  HuntIQEmailType,
  HuntIQIdentityInference,
  HuntIQSourceType,
  HuntIQSyncPayload
} from './huntiqTypes';

export interface HuntIQMappingOptions {
  jobId?: string;
  sourceType?: 'website_email_scraper' | 'batch_scraper' | 'raw_text_extractor';
  /** Explicitly verified company name (if discovered by scraper) */
  discoveredCompanyName?: string;
  /** Explicitly verified website URL (if crawled) */
  discoveredWebsiteUrl?: string;
  /** Explicit domain */
  domain?: string;
}

/**
 * Categorizes source URL to determine provenance sourceType
 */
export function classifySourceType(url?: string): HuntIQSourceType {
  if (!url) return 'RAW_TEXT';
  const lower = url.toLowerCase();
  if (lower.includes('/contact') || lower.includes('contact-us')) return 'CONTACT_PAGE';
  if (lower.includes('/team') || lower.includes('/people') || lower.includes('/leadership') || lower.includes('/staff')) return 'TEAM_PAGE';
  if (lower.includes('/about') || lower.includes('about-us') || lower.includes('/company')) return 'ABOUT_PAGE';
  if (lower.includes('#footer') || lower.includes('footer')) return 'FOOTER';
  if (url.startsWith('http://') || url.startsWith('https://')) return 'WEBSITE';
  return 'OTHER';
}

/**
 * Calculates evidence confidence score based on discovery attributes
 */
export function calculateConfidence(record: ScrapedEmailRecord): number {
  let score = 0.70;

  // MX validation increases confidence
  if (record.mxStatus === 'deliverable') {
    score += 0.20;
  } else if (record.mxStatus === 'disposable') {
    score -= 0.40;
  } else if (record.mxStatus === 'undeliverable') {
    score -= 0.50;
  }

  // Explicit title / contextual evidence
  if (record.jobTitle) {
    score += 0.05;
  }
  if (record.phone) {
    score += 0.03;
  }
  if (record.socials && (record.socials.linkedin || record.socials.twitter)) {
    score += 0.05;
  }

  // Cap score between 0.10 and 0.99
  return Math.min(0.99, Math.max(0.10, Math.round(score * 100) / 100));
}

/**
 * Maps email status from record verification status
 */
export function mapEmailStatus(record: ScrapedEmailRecord): HuntIQEmailStatus {
  if (record.mxStatus === 'deliverable') return 'VALIDATED';
  if (record.mxStatus === 'undeliverable' || record.mxStatus === 'disposable') return 'UNVERIFIED';
  return 'FOUND';
}

/**
 * Maps email type to strongly-typed enum
 */
export function mapEmailType(record: ScrapedEmailRecord): HuntIQEmailType {
  if (record.type === 'personal') return 'PERSONAL';
  if (record.type === 'role') return 'ROLE_BASED';
  return 'UNKNOWN';
}

/**
 * Maps a single ScrapedEmailRecord into a HuntIQContact.
 * Strictly adheres to rule: NEVER fabricate contact identity or company info.
 */
export function mapRecordToHuntIQContact(record: ScrapedEmailRecord): HuntIQContact {
  const sourceType = classifySourceType(record.sourceUrl);
  const confidence = calculateConfidence(record);
  const emailStatus = mapEmailStatus(record);
  const emailType = mapEmailType(record);

  // Identity handling:
  // If record has an explicit name found on the page, verify source.
  // If inferred from email local part or heuristics, place in identityInference, NOT name!
  let explicitName: string | null = null;
  let identityInference: HuntIQIdentityInference | undefined = undefined;
  let identitySource: 'website' | 'inferred' | undefined = undefined;

  if (record.name) {
    // Check if the name looks like an inference (e.g. inferred from email username)
    // or an explicitly discovered DOM name
    const localPart = record.email.split('@')[0].toLowerCase();
    const cleanName = record.name.toLowerCase().replace(/\s+/g, '');

    // If name matches the local part stripped of punctuation, it's inferred
    const isSyntheticInference = cleanName === localPart.replace(/[._\-+]/g, '');

    if (isSyntheticInference) {
      const parts = record.name.trim().split(/\s+/);
      identityInference = {
        firstName: parts[0],
        lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
        confidence: 0.45,
        source: 'email_local_part'
      };
      identitySource = 'inferred';
      explicitName = null; // Do NOT report as verified name!
    } else {
      explicitName = record.name;
      identitySource = 'website';
    }
  }

  return {
    email: record.email.toLowerCase().trim(),
    emailType,
    emailStatus,
    confidence,
    sourceUrl: record.sourceUrl || null,
    sourceType,
    name: explicitName,
    jobTitle: record.jobTitle || null,
    identityInference,
    identitySource,
    phone: record.phone || null,
    socials: record.socials || {},
    contextSnippet: record.contextSnippet || undefined,
    depth: record.depth,
    discoveredAt: record.discoveredAt || new Date().toISOString(),
    mxRecords: record.mxRecords
  };
}

/**
 * Maps an array of ScrapedEmailRecords into the versioned HuntIQSyncPayload (v1.0).
 * Deduplicates contacts and ensures zero data fabrication.
 */
export function mapRecordsToHuntIQPayload(
  records: ScrapedEmailRecord[],
  options: HuntIQMappingOptions = {}
): HuntIQSyncPayload {
  const seenEmails = new Set<string>();
  const contacts: HuntIQContact[] = [];

  for (const record of records) {
    const normalized = (record.email || '').toLowerCase().trim();
    if (!normalized || seenEmails.has(normalized)) {
      continue;
    }
    seenEmails.add(normalized);
    contacts.push(mapRecordToHuntIQContact(record));
  }

  // Derive domain only if all records share the same domain or if provided
  let domain: string | null = options.domain || null;
  if (!domain && records.length > 0) {
    const firstDomain = records[0].domain;
    const allSameDomain = records.every(r => r.domain === firstDomain);
    if (allSameDomain && firstDomain) {
      domain = firstDomain;
    }
  }

  // NEVER invent company.name (e.g. capitalizing domain)
  // NEVER invent company.website (e.g. https:// + domain) unless crawled
  const company = {
    name: options.discoveredCompanyName || null,
    domain,
    website: options.discoveredWebsiteUrl || null
  };

  return {
    integration: 'email-scraper',
    version: '1.0',
    requestId: randomUUID(),
    source: {
      type: options.sourceType || 'website_email_scraper',
      jobId: options.jobId
    },
    company,
    contacts
  };
}
