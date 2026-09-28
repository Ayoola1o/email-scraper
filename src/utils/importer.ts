import { ScrapedEmailRecord } from '../types/record';
import {
  hasValidTld,
  isRoleBasedEmail,
  isDisposableDomain,
  inferNameFromEmail,
  normalizeEmail
} from './emailExtractor';

export interface ImportOptions {
  sourceName?: string;
  defaultCompany?: string;
  jobId?: string;
}

export interface SyntaxErrorInfo {
  line: number;
  raw: string;
  reason: string;
}

export interface ParsedImportResult {
  records: ScrapedEmailRecord[];
  totalRowsProcessed: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  syntaxErrors: SyntaxErrorInfo[];
  detectedColumns: string[];
  detectedFormat: 'csv' | 'json' | 'plaintext';
}

/**
 * Standard RFC-5322 compliant email regex for syntax validation
 */
const EMAIL_SYNTAX_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Parses a single CSV line taking quotes and commas into account
 */
function parseCsvLine(line: string, delimiter: string = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote ("")
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Detects delimiter used in CSV/TSV (comma, semicolon, tab)
 */
function detectDelimiter(headerLine: string): string {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const tabCount = (headerLine.match(/\t/g) || []).length;
  const semiCount = (headerLine.match(/;/g) || []).length;

  if (tabCount > commaCount && tabCount > semiCount) return '\t';
  if (semiCount > commaCount && semiCount > tabCount) return ';';
  return ',';
}

/**
 * Categorizes email into Business, Personal, or General
 */
function categorizeEmail(email: string, domain: string, isRole: boolean): 'Business' | 'Personal' | 'General' {
  if (isRole) return 'General';
  const freeProviders = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com',
    'outlook.com', 'live.com', 'icloud.com', 'me.com', 'aol.com',
    'protonmail.com', 'proton.me', 'zoho.com', 'mail.com', 'gmx.com'
  ]);
  if (freeProviders.has(domain.toLowerCase())) {
    return 'Personal';
  }
  return 'Business';
}

/**
 * Parses and validates an email string into a ScrapedEmailRecord
 */
function createRecordFromEmail(
  rawEmail: string,
  extra: {
    name?: string;
    jobTitle?: string;
    company?: string;
    phone?: string;
    linkedin?: string;
    sourceUrl?: string;
    jobId?: string;
    tags?: string[];
  } = {}
): { record?: ScrapedEmailRecord; error?: string } {
  const email = normalizeEmail(rawEmail.trim().replace(/^<|>$/g, ''));
  if (!email || !email.includes('@')) {
    return { error: 'Missing "@" symbol or empty email' };
  }

  if (!EMAIL_SYNTAX_REGEX.test(email)) {
    return { error: 'Invalid email syntax format' };
  }

  if (!hasValidTld(email)) {
    return { error: 'Invalid or unrecognized Top-Level Domain (TLD)' };
  }

  const parts = email.split('@');
  const domain = parts[1].toLowerCase().trim();
  const isRole = isRoleBasedEmail(email);
  const isDisposable = isDisposableDomain(domain);
  const inferredName = inferNameFromEmail(email);

  const now = new Date().toISOString();
  const record: ScrapedEmailRecord = {
    email,
    domain,
    type: isRole ? 'role' : 'personal',
    sourceUrl: extra.sourceUrl || 'Imported List',
    pageTitle: extra.company ? `${extra.company} Contact` : `Imported Contact`,
    discoveredAt: now,
    name: extra.name || inferredName || undefined,
    jobTitle: extra.jobTitle || (isRole ? 'Department Desk' : undefined),
    company: extra.company || undefined,
    phone: extra.phone || undefined,
    socials: extra.linkedin ? { linkedin: extra.linkedin } : undefined,
    mxStatus: isDisposable ? 'disposable' : 'pending',
    mxRecords: [],
    validity: {
      syntax: true,
      tld: true,
      isDisposable
    },
    confidence: isRole ? 85 : 95,
    emailCategory: categorizeEmail(email, domain, isRole),
    jobId: extra.jobId || `import_${Date.now().toString(36)}`,
    tags: extra.tags || ['imported']
  };

  return { record };
}

/**
 * Main parser: handles CSV, TSV, JSON, and raw plaintext lists
 */
export function parseEmailList(
  rawInput: string,
  options: ImportOptions = {}
): ParsedImportResult {
  const trimmed = (rawInput || '').trim();
  const seenEmails = new Set<string>();
  const records: ScrapedEmailRecord[] = [];
  const syntaxErrors: SyntaxErrorInfo[] = [];
  let totalRows = 0;
  let duplicateCount = 0;
  let detectedFormat: 'csv' | 'json' | 'plaintext' = 'plaintext';
  let detectedColumns: string[] = [];

  if (!trimmed) {
    return {
      records: [],
      totalRowsProcessed: 0,
      validCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
      syntaxErrors: [],
      detectedColumns: [],
      detectedFormat: 'plaintext'
    };
  }

  // 1. Try parsing as JSON first
  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try {
      const parsedJson = JSON.parse(trimmed);
      detectedFormat = 'json';
      let items: any[] = [];

      if (Array.isArray(parsedJson)) {
        items = parsedJson;
      } else if (Array.isArray(parsedJson.emails)) {
        items = parsedJson.emails;
      } else if (Array.isArray(parsedJson.records)) {
        items = parsedJson.records;
      } else if (Array.isArray(parsedJson.contacts)) {
        items = parsedJson.contacts;
      }

      totalRows = items.length;

      items.forEach((item, idx) => {
        let emailStr = '';
        let extra: any = {
          sourceUrl: options.sourceName,
          company: options.defaultCompany,
          jobId: options.jobId
        };

        if (typeof item === 'string') {
          emailStr = item;
        } else if (typeof item === 'object' && item !== null) {
          emailStr = item.email || item.mail || item.emailAddress || item.address || '';
          extra.name = item.name || item.fullName || (item.firstName ? `${item.firstName} ${item.lastName || ''}`.trim() : undefined);
          extra.jobTitle = item.jobTitle || item.title || item.role || item.position;
          extra.company = item.company || item.organization || options.defaultCompany;
          extra.phone = item.phone || item.tel || item.mobile;
          extra.linkedin = item.linkedin || (item.socials && item.socials.linkedin);
          if (Array.isArray(item.tags)) extra.tags = item.tags;
        }

        if (!emailStr) {
          syntaxErrors.push({ line: idx + 1, raw: JSON.stringify(item).slice(0, 50), reason: 'No email field found' });
          return;
        }

        const res = createRecordFromEmail(emailStr, extra);
        if (res.error) {
          syntaxErrors.push({ line: idx + 1, raw: emailStr, reason: res.error });
        } else if (res.record) {
          const lower = res.record.email.toLowerCase();
          if (seenEmails.has(lower)) {
            duplicateCount++;
          } else {
            seenEmails.add(lower);
            records.push(res.record);
          }
        }
      });

      return {
        records,
        totalRowsProcessed: totalRows,
        validCount: records.length,
        invalidCount: syntaxErrors.length,
        duplicateCount,
        syntaxErrors,
        detectedColumns: ['email', 'name', 'jobTitle', 'company', 'phone'],
        detectedFormat: 'json'
      };
    } catch {
      // If JSON parse fails, fall through to CSV / line-by-line
    }
  }

  // 2. Line-by-line / CSV parsing
  const rawLines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (rawLines.length === 0) {
    return {
      records: [],
      totalRowsProcessed: 0,
      validCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
      syntaxErrors: [],
      detectedColumns: [],
      detectedFormat: 'plaintext'
    };
  }

  const firstLine = rawLines[0];
  const delimiter = detectDelimiter(firstLine);
  const firstLineCells = parseCsvLine(firstLine, delimiter);

  // Check if first line is a header row
  const headerColIndexMap: Record<string, number> = {};
  let emailColIdx = -1;
  let nameColIdx = -1;
  let titleColIdx = -1;
  let companyColIdx = -1;
  let phoneColIdx = -1;
  let linkedinColIdx = -1;

  firstLineCells.forEach((cell, idx) => {
    const c = cell.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (c === 'email' || c === 'mail' || c === 'emailaddress' || c === 'contactemail' || c === 'e-mail') {
      emailColIdx = idx;
    } else if (c === 'name' || c === 'fullname' || c === 'contactname' || c === 'person') {
      nameColIdx = idx;
    } else if (c === 'title' || c === 'jobtitle' || c === 'position' || c === 'role') {
      titleColIdx = idx;
    } else if (c === 'company' || c === 'organization' || c === 'companyname' || c === 'account') {
      companyColIdx = idx;
    } else if (c === 'phone' || c === 'tel' || c === 'telephone' || c === 'mobile') {
      phoneColIdx = idx;
    } else if (c === 'linkedin' || c === 'linkedinurl' || c === 'social') {
      linkedinColIdx = idx;
    }
  });

  const hasHeader = emailColIdx !== -1 || (firstLineCells.length > 1 && !firstLine.includes('@'));

  if (firstLineCells.length > 1 || hasHeader) {
    detectedFormat = 'csv';
    detectedColumns = firstLineCells.map(c => c.trim());
  } else {
    detectedFormat = 'plaintext';
  }

  // If no explicit 'email' header found, scan columns of the first few rows to find which column holds emails
  if (hasHeader && emailColIdx === -1 && rawLines.length > 1) {
    const sampleCells = parseCsvLine(rawLines[1], delimiter);
    for (let i = 0; i < sampleCells.length; i++) {
      if (sampleCells[i].includes('@') && hasValidTld(sampleCells[i])) {
        emailColIdx = i;
        break;
      }
    }
  }

  // If single column or plaintext without header, column 0 is email
  if (emailColIdx === -1) {
    emailColIdx = 0;
  }

  const startLineIdx = hasHeader ? 1 : 0;
  totalRows = rawLines.length - (hasHeader ? 1 : 0);

  for (let lineNum = startLineIdx; lineNum < rawLines.length; lineNum++) {
    const rawLine = rawLines[lineNum];
    const cells = parseCsvLine(rawLine, delimiter);

    // Extract email candidate
    let rawEmail = (cells[emailColIdx] || '').trim();

    // If email column wasn't valid, check other cells on the same line for an email
    if (!rawEmail.includes('@') && cells.length > 1) {
      for (const cell of cells) {
        if (cell.includes('@')) {
          rawEmail = cell.trim();
          break;
        }
      }
    }

    // Extract name candidate: also supports format like "John Smith <john@example.com>"
    let extractedName: string | undefined = undefined;
    const bracketMatch = rawLine.match(/^([^<"]+?)\s*<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/);
    if (bracketMatch) {
      extractedName = bracketMatch[1].replace(/["']/g, '').trim();
      rawEmail = bracketMatch[2].trim();
    }

    if (!rawEmail) {
      syntaxErrors.push({
        line: lineNum + 1,
        raw: rawLine.slice(0, 60),
        reason: 'Empty line or email column not found'
      });
      continue;
    }

    const extra = {
      name: extractedName || (nameColIdx !== -1 ? cells[nameColIdx] : undefined),
      jobTitle: titleColIdx !== -1 ? cells[titleColIdx] : undefined,
      company: companyColIdx !== -1 ? cells[companyColIdx] : options.defaultCompany,
      phone: phoneColIdx !== -1 ? cells[phoneColIdx] : undefined,
      linkedin: linkedinColIdx !== -1 ? cells[linkedinColIdx] : undefined,
      sourceUrl: options.sourceName || 'Imported List',
      jobId: options.jobId
    };

    const res = createRecordFromEmail(rawEmail, extra);
    if (res.error) {
      syntaxErrors.push({
        line: lineNum + 1,
        raw: rawEmail,
        reason: res.error
      });
    } else if (res.record) {
      const lower = res.record.email.toLowerCase();
      if (seenEmails.has(lower)) {
        duplicateCount++;
      } else {
        seenEmails.add(lower);
        records.push(res.record);
      }
    }
  }

  return {
    records,
    totalRowsProcessed: totalRows,
    validCount: records.length,
    invalidCount: syntaxErrors.length,
    duplicateCount,
    syntaxErrors,
    detectedColumns,
    detectedFormat
  };
}
