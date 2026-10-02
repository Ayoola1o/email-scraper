/**
 * Frontend Security Sanitizers & XSS Defense Utilities
 * Enforces strict sanitization of untrusted scraped text, URLs, and filenames.
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;'
};

/**
 * Escapes characters that could lead to HTML / script injection.
 */
export function escapeHtml(unsafe: string | null | undefined): string {
  if (!unsafe || typeof unsafe !== 'string') return '';
  return unsafe.replace(/[&<>"'`/]/g, (char) => HTML_ESCAPE_MAP[char] || char);
}

/**
 * Validates and sanitizes a URL before rendering in <a href="...">.
 * Rejects javascript:, vbscript:, data: (except safe images), and control characters.
 */
export function sanitizeUrl(url: string | null | undefined): string {
  if (!url || typeof url !== 'string') return '#';
  const cleanUrl = url.trim();

  // Reject dangerous protocols
  const lower = cleanUrl.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:') ||
    lower.startsWith('data:text/html') ||
    lower.startsWith('data:application/')
  ) {
    return '#';
  }

  // Allow standard web protocols
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('/')) {
    // Check for control characters or CRLF injection
    if (/[\x00-\x1F\x7F]/.test(cleanUrl)) {
      return '#';
    }
    return cleanUrl;
  }

  // If protocol-relative or relative
  if (cleanUrl.startsWith('./') || cleanUrl.startsWith('../')) {
    return cleanUrl;
  }

  // Prepend https:// if it looks like a domain name
  if (/^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}/.test(cleanUrl)) {
    return `https://${cleanUrl}`;
  }

  return '#';
}

/**
 * Sanitizes contextual text snippets by removing dangerous tags,
 * trimming whitespace, and bounding length.
 */
export function sanitizeSnippet(snippet: string | null | undefined, maxChars = 200): string {
  if (!snippet || typeof snippet !== 'string') return '';
  
  // Strip any script or iframe tags
  let cleaned = snippet
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (cleaned.length > maxChars) {
    const cut = Math.max(0, maxChars - 3);
    cleaned = cleaned.slice(0, cut) + '...';
  }

  return cleaned;
}

/**
 * Validates email display string to prevent breaking DOM or injection.
 */
export function sanitizeEmailDisplay(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') return '';
  return email.trim().replace(/[^\w.@+-]/g, '');
}

/**
 * Sanitizes filenames for export downloads to prevent directory traversal or invalid characters.
 */
export function sanitizeFilename(filename: string | null | undefined, fallback = 'export'): string {
  if (!filename || typeof filename !== 'string') return fallback;
  const clean = filename.replace(/\.\./g, '').replace(/[/\\?%*:|"<>]/g, '_').trim();
  return clean || fallback;
}
