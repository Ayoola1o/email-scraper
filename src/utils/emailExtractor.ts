import tlds from 'tlds';
import { ScrapedEmailRecord } from '../types/record';

/**
 * Creates a Set of valid TLDs for fast O(1) lookup
 */
const tldSet = new Set(tlds.map(tld => tld.toLowerCase()));

/**
 * Known file extensions that frequently trigger false-positive regex matches in HTML/JS
 */
const ASSET_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico',
  'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'less', 'map',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'mp4', 'webm', 'ogg', 'mp3', 'wav',
  'json', 'xml', 'pdf', 'zip', 'tar', 'gz'
]);

/**
 * Common role-based usernames
 */
const ROLE_PREFIXES = new Set([
  'info', 'support', 'contact', 'contactus', 'sales', 'admin', 'administrator',
  'team', 'help', 'helpdesk', 'press', 'media', 'pr', 'billing', 'accounts',
  'careers', 'jobs', 'hr', 'recruiting', 'talent', 'privacy', 'legal',
  'compliance', 'security', 'hello', 'hi', 'office', 'inquiries', 'enquiries',
  'service', 'customer', 'feedback', 'marketing', 'media', 'investors',
  'general', 'mailbox', 'frontdesk', 'reception', 'newsletter', 'editor'
]);

/**
 * Common disposable / temporary email domains
 */
const DISPOSABLE_DOMAINS = new Set([
  'tempmail.com', 'mailinator.com', 'guerrillamail.com', '10minutemail.com',
  'throwawaymail.com', 'yopmail.com', 'trashmail.com', 'dispostable.com',
  'sharklasers.com', 'getairmail.com', 'fakemailgenerator.com'
]);

/**
 * Decodes HTML entities and URL encodings commonly used to obfuscate email addresses
 */
export function decodeObfuscation(text: string): string {
  let decoded = text;

  // 1. Decode URL percent encodings (e.g. %40 -> @, %2E -> .)
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // If malformed URI, manually replace %40
    decoded = decoded.replace(/%40/gi, '@').replace(/%2e/gi, '.');
  }

  // 2. Decode HTML numeric character entities (&#64; -> @, &#x40; -> @)
  decoded = decoded.replace(/&#(\d+);/g, (_, dec) => {
    try {
      return String.fromCharCode(parseInt(dec, 10));
    } catch {
      return _;
    }
  });
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch {
      return _;
    }
  });

  // 3. Decode common HTML named entities
  decoded = decoded
    .replace(/&commat;/gi, '@')
    .replace(/&period;/gi, '.')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

  // 4. Decode explicit bracketed obfuscations like [at], (at), <at>, {at}
  decoded = decoded.replace(/\s*[\(\[\{<]\s*(?:at|@)\s*[\)\]\}>]\s*/gi, '@');
  decoded = decoded.replace(/\s*[\(\[\{<]\s*(?:dot|\.)\s*[\)\]\}>]\s*/gi, '.');

  // 5. Decode word-based obfuscations like "username at domain dot com"
  decoded = decoded.replace(/\b([a-zA-Z0-9._%+-]+)\s+at\s+([a-zA-Z0-9-]+)\s+dot\s+([a-zA-Z]{2,})\b/gi, '$1@$2.$3');

  return decoded;
}

/**
 * Extracts and validates the TLD from an email address
 * Handles multi-part TLDs like .co.uk, .com.au, etc.
 */
export function hasValidTld(email: string): boolean {
  const parts = email.split('@');
  if (parts.length !== 2) return false;

  const domain = parts[1].toLowerCase();
  const domainParts = domain.split('.');

  if (domainParts.length < 2) return false;

  const lastPart = domainParts[domainParts.length - 1];

  // Rejection of asset/script file names falsely parsed as emails
  if (ASSET_EXTENSIONS.has(lastPart)) {
    return false;
  }

  // Check single TLD (e.g. .com, .org, .io)
  if (tldSet.has(lastPart)) {
    return true;
  }

  // Check two-part TLD (e.g., .co.uk, .com.au)
  if (domainParts.length >= 3) {
    const twoPartTld = domainParts.slice(-2).join('.');
    if (tldSet.has(twoPartTld)) {
      return true;
    }
  }

  return false;
}

/**
 * Normalizes email addresses (lowercase, trim)
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Determines whether an email is likely a generic / role-based inbox
 */
export function isRoleBasedEmail(email: string): boolean {
  const user = email.split('@')[0].toLowerCase();
  const cleanUser = user.replace(/[^a-z0-9]/g, '');
  if (ROLE_PREFIXES.has(user) || ROLE_PREFIXES.has(cleanUser)) {
    return true;
  }
  // Check prefix if it contains a separator (e.g. support-na@..., info.europe@...)
  for (const prefix of ROLE_PREFIXES) {
    if (user.startsWith(`${prefix}.`) || user.startsWith(`${prefix}-`) || user.startsWith(`${prefix}_`)) {
      return true;
    }
  }
  return false;
}

/**
 * Determines if domain is a disposable email service
 */
export function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain.toLowerCase());
}

/**
 * Extracts raw page title from HTML string
 */
export function extractPageTitle(html: string): string {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return match ? match[1].trim().replace(/\s+/g, ' ') : '';
}

/**
 * Strips HTML tags and excessive whitespace to produce clean text
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Finds a concise context snippet around the email occurrence
 */
function findContextSnippet(text: string, email: string, maxRadius = 50): string {
  const idx = text.toLowerCase().indexOf(email.toLowerCase());
  if (idx === -1) return '';

  const start = Math.max(0, idx - maxRadius);
  const end = Math.min(text.length, idx + email.length + maxRadius);
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();

  if (start > 0) snippet = `...${snippet}`;
  if (end < text.length) snippet = `${snippet}...`;

  return snippet;
}

/**
 * Extracts email addresses from a given text string using regex
 */
export function extractEmails(text: string): Set<string> {
  const decoded = decodeObfuscation(text);
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = decoded.match(emailRegex);
  if (!matches) return new Set();

  const validEmails = matches.filter(hasValidTld);
  return new Set(validEmails);
}

/**
 * Extracts and normalizes emails from text, filtering out invalid TLDs
 */
export function extractAndNormalizeEmails(text: string): Set<string> {
  const emails = extractEmails(text);
  return new Set(Array.from(emails).map(normalizeEmail));
}

/**
 * Extracts full, structured email records from HTML or plain text with context snippets and metadata
 */
export function extractEmailRecordsFromHtml(
  html: string,
  sourceUrl: string,
  pageTitle?: string,
  depth = 0
): ScrapedEmailRecord[] {
  const title = pageTitle || extractPageTitle(html);
  const decodedHtml = decodeObfuscation(html);

  // 1. Look for mailto: links specifically (high confidence)
  const mailtoRegex = /href=["']mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})[^"']*["']/gi;
  const directEmails = new Map<string, { email: string; context: string }>();

  let mailtoMatch;
  while ((mailtoMatch = mailtoRegex.exec(decodedHtml)) !== null) {
    const rawEmail = mailtoMatch[1];
    if (hasValidTld(rawEmail)) {
      const normalized = normalizeEmail(rawEmail);
      directEmails.set(normalized, {
        email: normalized,
        context: `mailto link on page`
      });
    }
  }

  // 2. Look in clean text body for text occurrences and context snippets
  const cleanText = stripHtml(decodedHtml);
  const textEmails = extractEmails(cleanText);

  for (const email of textEmails) {
    const normalized = normalizeEmail(email);
    const snippet = findContextSnippet(cleanText, email);
    if (!directEmails.has(normalized)) {
      directEmails.set(normalized, {
        email: normalized,
        context: snippet
      });
    } else if (snippet && directEmails.get(normalized)?.context.includes('mailto link')) {
      directEmails.set(normalized, {
        email: normalized,
        context: snippet
      });
    }
  }

  // 3. Scan full document HTML (including JSON-LD, metadata attributes, script blobs)
  const fullDocEmails = extractEmails(decodedHtml);
  for (const email of fullDocEmails) {
    const normalized = normalizeEmail(email);
    if (!directEmails.has(normalized)) {
      const rawSnippet = findContextSnippet(decodedHtml, email, 40)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, ' ')
        .trim();
      directEmails.set(normalized, {
        email: normalized,
        context: rawSnippet || 'Embedded in page metadata/scripts'
      });
    }
  }

  // Extract page-level phone numbers & social media profiles
  const pagePhones = extractPhoneNumbersFromHtml(html);
  const pageSocials = extractSocialProfiles(html);

  const records: ScrapedEmailRecord[] = [];
  const now = new Date().toISOString();

  for (const [normEmail, data] of directEmails.entries()) {
    const parts = normEmail.split('@');
    const domain = parts[1] || '';
    const isRole = isRoleBasedEmail(normEmail);
    const context = data.context || '';

    // Check if a specific phone appears near this email in context
    const contextPhone = pagePhones.find(p => context.includes(p)) || pagePhones[0];
    const inferredName = isRole ? undefined : inferNameFromEmail(normEmail);
    const jobTitle = detectJobTitle(context) || detectJobTitle(html);

    records.push({
      email: normEmail,
      domain,
      type: isRole ? 'role' : 'personal',
      name: inferredName || undefined,
      jobTitle: jobTitle || undefined,
      phone: contextPhone || undefined,
      socials: pageSocials,
      mxStatus: 'unverified',
      sourceUrl,
      pageTitle: title || undefined,
      contextSnippet: context || undefined,
      depth,
      discoveredAt: now,
      validity: {
        syntax: true,
        tld: true,
        isDisposable: isDisposableDomain(domain)
      }
    });
  }

  return records;
}

/**
 * Extracts phone numbers from HTML markup and plain text
 */
export function extractPhoneNumbersFromHtml(html: string): string[] {
  const phones = new Set<string>();

  // 1. tel: links
  const telRegex = /href=["']tel:([^"']+)["']/gi;
  let match;
  while ((match = telRegex.exec(html)) !== null) {
    const clean = match[1].trim().replace(/[^\d+]/g, '');
    if (clean.length >= 7) phones.add(match[1].trim());
  }

  // 2. Pattern matches for standard phone formats: +1 (555) 839-2049, (555) 123-4567
  const phonePattern = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
  while ((match = phonePattern.exec(html)) !== null) {
    const p = match[0].trim();
    if (!p.includes('@') && !p.startsWith('202') && p.length >= 10) {
      phones.add(p);
    }
  }

  return Array.from(phones);
}

/**
 * Extracts social media profile links (LinkedIn, Twitter/X, GitHub) from HTML
 */
export function extractSocialProfiles(html: string): { linkedin?: string; twitter?: string; github?: string } {
  const linkedinRegex = /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[a-zA-Z0-9._%-]+/i;
  const twitterRegex = /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+/i;
  const githubRegex = /https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9._%-]+/i;

  const linkedinMatch = linkedinRegex.exec(html);
  const twitterMatch = twitterRegex.exec(html);
  const githubMatch = githubRegex.exec(html);

  return {
    linkedin: linkedinMatch ? linkedinMatch[0] : undefined,
    twitter: twitterMatch ? twitterMatch[0] : undefined,
    github: githubMatch ? githubMatch[0] : undefined
  };
}

/**
 * Detects executive and professional job titles from surrounding context
 */
export function detectJobTitle(snippet: string): string | undefined {
  if (!snippet) return undefined;
  // Clean URLs and HTML tags so URL path slugs don't trigger false positives
  const clean = snippet
    .replace(/https?:\/\/[^\s"'<>]+/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  const titlePatterns = [
    /\bChief Executive Officer\b/i,
    /\bChief Technology Officer\b/i,
    /\bChief Operating Officer\b/i,
    /\bChief Financial Officer\b/i,
    /\bVice President(?:\s+of\s+[A-Za-z]+)?\b/i,
    /\b(?:Co-Founder|Founder)\b/i,
    /\b(?:President|Executive Director)\b/i,
    /\bHead of\s+[A-Za-z]+\b/i,
    /\bDirector(?:\s+of\s+[A-Za-z]+)?\b/i,
    /\b(?:Engineering Lead|Team Lead|Tech Lead)\b/i,
    /\bSenior\s+[A-Za-z]+\s+Engineer\b/i,
    /\b(?:Software Engineer|Developer|Architect)\b/i,
    /\b(?:Marketing Manager|Product Manager|Project Manager)\b/i,
    /\b(?:Sales Representative|Account Executive)\b/i,
    /\b(?:CEO|CTO|COO|CFO|VP)\b/i
  ];

  for (const pattern of titlePatterns) {
    const m = pattern.exec(clean);
    if (m) {
      const matchText = m[0];
      if (matchText.length <= 3) return matchText.toUpperCase();
      return matchText;
    }
  }
  return undefined;
}

/**
 * Infers personal name from the local-part of an email address (e.g. john.doe@ -> John Doe)
 */
export function inferNameFromEmail(email: string): string | undefined {
  if (!email || !email.includes('@')) return undefined;
  const localPart = email.split('@')[0];
  if (!localPart) return undefined;

  // Split on dots, underscores, dashes, plus signs
  const parts = localPart.split(/[._\-+]+/).filter(Boolean);
  if (parts.length === 0) return undefined;

  // Clean numbers out of words
  const cleanParts = parts
    .map(p => p.replace(/\d+/g, '').trim())
    .filter(p => p.length >= 2);

  if (cleanParts.length === 0) return undefined;

  return cleanParts
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}
