import { ScrapedEmailRecord } from '../types/record';

export type ExportableField =
  | 'email'
  | 'name'
  | 'jobTitle'
  | 'phone'
  | 'type'
  | 'domain'
  | 'mxStatus'
  | 'linkedin'
  | 'sourceUrl'
  | 'pageTitle'
  | 'contextSnippet'
  | 'discoveredAt';

export const DEFAULT_FIELDS: ExportableField[] = [
  'email',
  'name',
  'jobTitle',
  'phone',
  'type',
  'domain',
  'mxStatus',
  'sourceUrl',
  'pageTitle',
  'contextSnippet',
  'discoveredAt'
];

export const FIELD_LABELS: Record<ExportableField, string> = {
  email: 'Email',
  name: 'Name',
  jobTitle: 'Job Title',
  phone: 'Phone Number',
  type: 'Type',
  domain: 'Domain',
  mxStatus: 'MX Deliverability',
  linkedin: 'LinkedIn Profile',
  sourceUrl: 'Source URL',
  pageTitle: 'Page Title',
  contextSnippet: 'Context Snippet',
  discoveredAt: 'Discovered At'
};

/**
 * Escapes a field for safe CSV representation
 */
function escapeCsvField(val: string | undefined | null): string {
  if (val === undefined || val === null) return '""';
  const str = String(val).replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
  return `"${str}"`;
}

/**
 * Exports records to Excel-ready CSV format with customizable columns
 */
export function toCSV(records: ScrapedEmailRecord[], selectedFields: ExportableField[] = DEFAULT_FIELDS): string {
  const BOM = '\uFEFF';
  const fields = selectedFields.length > 0 ? selectedFields : DEFAULT_FIELDS;
  const headers = fields.map(f => FIELD_LABELS[f] || f);

  const rows = records.map(r => {
    return fields.map(f => {
      let val: any;
      if (f === 'linkedin') {
        val = r.socials?.linkedin || '';
      } else {
        val = r[f as keyof ScrapedEmailRecord];
      }
      return escapeCsvField(typeof val === 'string' ? val : (val ? JSON.stringify(val) : ''));
    }).join(',');
  });

  return BOM + [headers.map(h => `"${h}"`).join(','), ...rows].join('\r\n');
}

/**
 * Exports records to formatted JSON with customizable keys
 */
export function toJSON(records: ScrapedEmailRecord[], selectedFields: ExportableField[] = DEFAULT_FIELDS, pretty = true): string {
  const fields = selectedFields.length > 0 ? selectedFields : DEFAULT_FIELDS;

  // Filter keys for each record
  const projected = records.map(r => {
    const item: Record<string, any> = {};
    for (const f of fields) {
      item[f] = r[f as keyof ScrapedEmailRecord] ?? '';
    }
    return item;
  });

  return JSON.stringify(projected, null, pretty ? 2 : 0);
}

/**
 * Exports plain list of unique email addresses (one per line)
 */
export function toPlainText(records: ScrapedEmailRecord[]): string {
  const uniqueEmails = Array.from(new Set(records.map(r => r.email.toLowerCase().trim()))).sort();
  return uniqueEmails.join('\n');
}

/**
 * Extracts a plausible friendly name from an email address
 */
function inferNameFromEmail(email: string): string {
  const user = email.split('@')[0];
  const words = user.split(/[\._\-+]/).filter(Boolean);
  if (words.length === 0) return email;
  return words
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Exports records to vCard 3.0 format for easy import into Outlook / Google Contacts / Apple Contacts / CRMs
 */
export function toVCard(records: ScrapedEmailRecord[], selectedFields: ExportableField[] = DEFAULT_FIELDS): string {
  const cards: string[] = [];
  const fieldsSet = new Set(selectedFields);

  for (const r of records) {
    const formattedName = r.name || inferNameFromEmail(r.email);
    const domain = r.domain.toUpperCase();
    const note = [
      r.jobTitle ? `Title: ${r.jobTitle}` : '',
      fieldsSet.has('pageTitle') && r.pageTitle ? `Discovered on: ${r.pageTitle}` : '',
      fieldsSet.has('sourceUrl') && r.sourceUrl ? `Source: ${r.sourceUrl}` : '',
      fieldsSet.has('contextSnippet') && r.contextSnippet ? `Snippet: ${r.contextSnippet}` : ''
    ].filter(Boolean).join(' | ');

    cards.push([
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${formattedName}`,
      `N:;${formattedName};;;`,
      r.jobTitle && fieldsSet.has('jobTitle') ? `TITLE:${r.jobTitle}` : '',
      `EMAIL;TYPE=INTERNET,WORK:${r.email}`,
      r.phone && fieldsSet.has('phone') ? `TEL;TYPE=WORK,VOICE:${r.phone}` : '',
      fieldsSet.has('domain') ? `ORG:${domain}` : '',
      fieldsSet.has('sourceUrl') && r.sourceUrl ? `URL:${r.sourceUrl}` : '',
      r.socials?.linkedin && fieldsSet.has('linkedin') ? `X-SOCIALPROFILE;TYPE=linkedin:${r.socials.linkedin}` : '',
      note ? `NOTE:${note.replace(/[\r\n]+/g, ' ')}` : '',
      'END:VCARD'
    ].filter(Boolean).join('\r\n'));
  }

  return cards.join('\r\n\r\n');
}

/**
 * Formats scraped records according to requested format and selected fields
 */
export function formatRecords(
  records: ScrapedEmailRecord[],
  format: 'csv' | 'json' | 'txt' | 'vcf',
  fields?: ExportableField[]
): { data: string; mimeType: string; extension: string } {
  const selectedFields = fields && fields.length > 0 ? fields : DEFAULT_FIELDS;

  switch (format) {
    case 'csv':
      return {
        data: toCSV(records, selectedFields),
        mimeType: 'text/csv; charset=utf-8',
        extension: 'csv'
      };
    case 'json':
      return {
        data: toJSON(records, selectedFields),
        mimeType: 'application/json; charset=utf-8',
        extension: 'json'
      };
    case 'txt':
      return {
        data: toPlainText(records),
        mimeType: 'text/plain; charset=utf-8',
        extension: 'txt'
      };
    case 'vcf':
      return {
        data: toVCard(records, selectedFields),
        mimeType: 'text/vcard; charset=utf-8',
        extension: 'vcf'
      };
  }
}
