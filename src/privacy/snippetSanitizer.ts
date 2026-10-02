/**
 * Contextual Snippet Sanitizer & Data Minimization
 * Scans surrounding webpage snippets and redacts sensitive PII,
 * credentials, credit cards, SSNs, and enforces length bounds.
 */

// Credit Card Regex (Visa, MC, Amex, Discover 13-16 digits with optional dashes/spaces)
const CC_REGEX = /\b(?:\d{4}[-\s]?){3}\d{4}\b|\b3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}\b/g;

// US Social Security Number Regex (9 digits: XXX-XX-XXXX)
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;

// Potential inline passwords or tokens
const INLINE_PASSWORD_REGEX = /(?:password|passwd|pwd|secret)\s*[:=]\s*["']?([^\s"';,]+)["']?/gi;

// Bearer or JWT token pattern in text
const JWT_REGEX = /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g;

export interface SnippetSanitizeOptions {
  maxChars?: number;
  stripSnippet?: boolean;
  redactPii?: boolean;
}

const DEFAULT_MAX_CHARS = 150;

/**
 * Sanitizes a contextual text snippet for data minimization and PII protection.
 */
export function sanitizeContextSnippet(
  snippet: string | undefined | null,
  options: SnippetSanitizeOptions = {}
): string | undefined {
  if (!snippet || typeof snippet !== 'string') return undefined;

  // If client or policy requires total snippet stripping for data minimization
  if (options.stripSnippet) {
    return undefined;
  }

  const maxChars = options.maxChars && options.maxChars > 0 ? options.maxChars : DEFAULT_MAX_CHARS;
  const redactPii = options.redactPii !== false; // Default true

  let cleaned = snippet.trim();

  // Strip HTML tags if any were left in the snippet
  cleaned = cleaned.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  if (redactPii) {
    // Redact Credit Card Numbers
    cleaned = cleaned.replace(CC_REGEX, '[REDACTED_CARD]');

    // Redact SSNs
    cleaned = cleaned.replace(SSN_REGEX, '[REDACTED_SSN]');

    // Redact Inline Passwords
    cleaned = cleaned.replace(INLINE_PASSWORD_REGEX, (match, pass) => {
      return match.replace(pass, '[REDACTED_SECRET]');
    });

    // Redact JWT Tokens
    cleaned = cleaned.replace(JWT_REGEX, '[REDACTED_TOKEN]');
  }

  // Enforce length limit with graceful ellipsis
  if (cleaned.length > maxChars) {
    cleaned = cleaned.substring(0, maxChars).trim() + '...';
  }

  return cleaned || undefined;
}
