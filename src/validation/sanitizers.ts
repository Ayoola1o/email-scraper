/**
 * Sanitization utilities for logs, filenames, and exported files
 */

/**
 * Sanitizes strings for safe inclusion in logs.
 * Strips newlines, carriage returns, and control characters to prevent log injection / CRLF attacks.
 */
export function sanitizeForLog(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  return str
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
    .trim();
}

/**
 * Sanitizes a filename to prevent path traversal, null byte injections,
 * and dangerous filesystem characters across Windows and POSIX systems.
 */
export function sanitizeFilename(filename: string, fallback = 'export.csv'): string {
  if (!filename || typeof filename !== 'string') {
    return fallback;
  }

  let clean = filename
    .replace(/[\0\r\n\t]/g, '') // strip null and control chars
    .replace(/\.{2,}/g, '.') // strip ../ traversal dots
    .replace(/[<>:"/\\|?*]/g, '_') // strip illegal windows / posix characters
    .trim();

  // Strip leading dots or slashes
  clean = clean.replace(/^[./\\]+/, '');

  if (clean.length === 0 || clean === '.' || clean === '..') {
    return fallback;
  }

  // Cap filename length to 128 characters
  if (clean.length > 128) {
    const extIdx = clean.lastIndexOf('.');
    if (extIdx > 0 && extIdx > clean.length - 10) {
      const ext = clean.substring(extIdx);
      clean = clean.substring(0, 128 - ext.length) + ext;
    } else {
      clean = clean.substring(0, 128);
    }
  }

  return clean;
}

/**
 * Sanitizes a string against CSV Formula Injection (DDE injection).
 * If a cell starts with =, +, -, @, \t, or \r, prepend a single quote (')
 * so spreadsheet software (Excel, LibreOffice, Google Sheets) treats it as literal text.
 */
export function sanitizeCsvField(field: any): string {
  if (field === null || field === undefined) return '';
  const str = String(field);

  // Check if string begins with dangerous formula triggers
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }

  return str;
}
