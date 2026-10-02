import { ComplianceNotice } from './types';

/**
 * Standard legal disclaimer and compliance notice for MX / Syntax validation.
 * Mandated: An MX lookup or syntax check does not constitute proof that an individual mailbox
 * exists or that its owner consented to marketing outreach under CAN-SPAM, GDPR, PECR, or CASL.
 */
export const COMPLIANCE_DISCLAIMER =
  'An MX lookup, syntax check, or DNS verification does NOT constitute proof that an individual ' +
  'mailbox exists, is active, or that its owner consented to marketing outreach or cold communications ' +
  'under CAN-SPAM, GDPR, CASL, PECR, or applicable data protection regulations.';

/**
 * Creates a standard compliance notice object attached to validation outputs and exports
 */
export function getStandardComplianceNotice(): ComplianceNotice {
  return {
    proofOfMailboxExistence: false,
    outreachConsentConfirmed: false,
    legalDisclaimer: COMPLIANCE_DISCLAIMER,
    verificationType: 'deliverability_and_syntax_heuristics_only'
  };
}

/**
 * Sensitive or restricted URL paths that must never be targeted for automated scraping
 * in compliance with website access restrictions, privacy standards, and platform terms.
 */
const RESTRICTED_PATH_PATTERNS = [
  /^\/(?:wp-admin|admin|administrator|backend|manage|controlpanel)(?:\/.*)?$/i,
  /^\/(?:login|signin|auth|oauth|session|authenticate|sso)(?:\/.*)?$/i,
  /^\/(?:checkout|cart|basket|payment|order|invoice|billing)(?:\/.*)?$/i,
  /^\/(?:user\/password|reset-password|forgot-password)(?:\/.*)?$/i,
  /^\/(?:\.git|\.env|\.svn|\.hg|\.well-known\/security\.txt|\.aws|\.ssh)(?:\/.*)?$/i,
  /^\/(?:private|internal|confidential|secret|sysadmin)(?:\/.*)?$/i
];

/**
 * Verifies if a given path or URL violates platform privacy boundaries or access restrictions
 */
export function isRestrictedCompliancePath(urlString: string): { restricted: boolean; reason?: string } {
  try {
    const parsed = new URL(urlString);
    const pathname = parsed.pathname.toLowerCase();

    for (const pattern of RESTRICTED_PATH_PATTERNS) {
      if (pattern.test(pathname)) {
        return {
          restricted: true,
          reason: `Access to restricted/sensitive path "${pathname}" is prohibited under platform compliance policies.`
        };
      }
    }
    return { restricted: false };
  } catch {
    return { restricted: true, reason: 'Malformed URL path cannot be verified for compliance.' };
  }
}

/**
 * Simple robots.txt Disallow rule matcher
 */
export function isPathDisallowedByRobotsTxt(robotsTxtContent: string, path: string, userAgent = '*'): boolean {
  if (!robotsTxtContent || !path) return false;

  const lines = robotsTxtContent.split(/\r?\n/);
  let appliesToUs = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const lower = line.toLowerCase();
    if (lower.startsWith('user-agent:')) {
      const agent = lower.replace('user-agent:', '').trim();
      appliesToUs = agent === '*' || agent.includes(userAgent.toLowerCase());
    } else if (appliesToUs && lower.startsWith('disallow:')) {
      const disallowPath = line.substring('disallow:'.length).trim();
      if (!disallowPath) continue; // Empty disallow means allow all
      if (disallowPath === '/' || path.startsWith(disallowPath)) {
        return true;
      }
    }
  }

  return false;
}
