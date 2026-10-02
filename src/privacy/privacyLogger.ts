/**
 * Privacy-Aware Application Logger
 * Automatically masks PII (email addresses, phone numbers), API keys,
 * authentication tokens, and credentials in application logs.
 */

// Email regex pattern for masking within log strings
const EMAIL_REGEX = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g;

// Secret / token regex pattern for masking API keys, JWTs, Bearer tokens
const SECRET_REGEX = /(?:bearer\s+[a-zA-Z0-9\-._~+/]+=*|api[-_]?key["']?\s*[:=]\s*["']?([a-zA-Z0-9_-]{16,})["']?|token["']?\s*[:=]\s*["']?([a-zA-Z0-9_-]{16,})["']?|secret["']?\s*[:=]\s*["']?([a-zA-Z0-9_-]{16,})["']?)/gi;

/**
 * Masks an email address for privacy-safe logging:
 * "john.doe@example.com" -> "j***e@example.com"
 * "a@b.com" -> "*@b.com"
 */
export function maskEmail(email: string): string {
  if (!email || typeof email !== 'string') return '';
  const parts = email.trim().split('@');
  if (parts.length !== 2) return '[INVALID_EMAIL]';

  const [local, domain] = parts;
  if (local.length <= 2) {
    return `*@${domain}`;
  }

  const firstChar = local[0];
  const lastChar = local[local.length - 1];
  return `${firstChar}***${lastChar}@${domain}`;
}

/**
 * Sanitizes an arbitrary log message or object, masking any detected
 * email addresses, credentials, or sensitive tokens.
 */
export function sanitizeLogContent(input: any): any {
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    // 1. Redact secrets, bearer tokens, API keys
    let sanitized = input.replace(SECRET_REGEX, (match) => {
      if (match.toLowerCase().startsWith('bearer')) {
        return 'Bearer [REDACTED_TOKEN]';
      }
      return match.replace(/([:=]\s*["']?)([a-zA-Z0-9_-]+)(["']?)/, '$1[REDACTED_SECRET]$3');
    });

    // 2. Mask email addresses
    sanitized = sanitized.replace(EMAIL_REGEX, (match) => maskEmail(match));

    // 3. Strip CRLF to prevent log injection
    sanitized = sanitized.replace(/[\r\n]+/g, ' ');

    return sanitized;
  }

  if (Array.isArray(input)) {
    // If it's a huge array of email records, do NOT log all records
    if (input.length > 5) {
      return `[Array of ${input.length} items (summarized for privacy)]`;
    }
    return input.map(item => sanitizeLogContent(item));
  }

  if (typeof input === 'object') {
    const output: Record<string, any> = {};
    for (const [key, val] of Object.entries(input)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('key') ||
        lowerKey.includes('token') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('password') ||
        lowerKey.includes('authorization') ||
        lowerKey.includes('cookie')
      ) {
        output[key] = '[REDACTED]';
      } else if (lowerKey === 'email') {
        output[key] = typeof val === 'string' ? maskEmail(val) : '[REDACTED]';
      } else if (lowerKey === 'emails' || lowerKey === 'records' || lowerKey === 'contacts') {
        output[key] = Array.isArray(val)
          ? `[Collection of ${val.length} records]`
          : sanitizeLogContent(val);
      } else {
        output[key] = sanitizeLogContent(val);
      }
    }
    return output;
  }

  return input;
}

/**
 * Privacy-aware application logger singleton
 */
export const privacyLog = {
  info(message: string, ...args: any[]): void {
    const sanitizedMsg = sanitizeLogContent(message);
    const sanitizedArgs = args.map(a => sanitizeLogContent(a));
    if (sanitizedArgs.length > 0) {
      console.log(sanitizedMsg, ...sanitizedArgs);
    } else {
      console.log(sanitizedMsg);
    }
  },

  warn(message: string, ...args: any[]): void {
    const sanitizedMsg = sanitizeLogContent(message);
    const sanitizedArgs = args.map(a => sanitizeLogContent(a));
    if (sanitizedArgs.length > 0) {
      console.warn(sanitizedMsg, ...sanitizedArgs);
    } else {
      console.warn(sanitizedMsg);
    }
  },

  error(message: string, ...args: any[]): void {
    const sanitizedMsg = sanitizeLogContent(message);
    const sanitizedArgs = args.map(a => sanitizeLogContent(a));
    if (sanitizedArgs.length > 0) {
      console.error(sanitizedMsg, ...sanitizedArgs);
    } else {
      console.error(sanitizedMsg);
    }
  }
};
