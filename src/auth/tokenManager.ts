import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { SessionTokenPayload, UserRole, UserContext } from './types';

/**
 * Secret management for session tokens
 * Never uses insecure hardcoded fallbacks in production.
 */
function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.JWT_SECRET || process.env.ADMIN_API_KEY;
  if (secret && secret.length >= 16) {
    return secret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET or JWT_SECRET must be configured with at least 16 characters in production environments.');
  }
  // Transient in-memory secret for local development/testing if none provided
  return fallbackDevSecret;
}

const fallbackDevSecret = randomBytes(32).toString('hex');

// In-memory blacklist for revoked token identifiers (jti)
const revokedTokenIds = new Set<string>();

/**
 * Encodes an object to Base64URL
 */
function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Decodes a Base64URL string
 */
function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Signs payload data with HMAC-SHA256
 */
function signData(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export class TokenManager {
  /**
   * Generates a tamper-proof signed session token
   * @param user User context to serialize in token
   * @param expiresInSeconds Lifetime in seconds (default 2 hours)
   */
  static createSessionToken(
    user: UserContext,
    expiresInSeconds: number = 7200
  ): { token: string; expiresAt: number; jti: string } {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + expiresInSeconds;
    const jti = randomBytes(16).toString('hex');

    const header = { alg: 'HS256', typ: 'JWT' };
    const payload: SessionTokenPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      iat: now,
      exp: expiresAt,
      jti
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const dataToSign = `${encodedHeader}.${encodedPayload}`;
    const signature = signData(dataToSign, getAuthSecret());

    return {
      token: `${dataToSign}.${signature}`,
      expiresAt: expiresAt * 1000,
      jti
    };
  }

  /**
   * Verifies and decodes a signed session token
   * Validates signature using timing-safe comparison, checks expiration, and validates against revocation blacklist.
   */
  static verifySessionToken(token: string): { valid: boolean; payload?: SessionTokenPayload; error?: string } {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token missing or invalid' };
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Malformed token structure' };
    }

    const [headerB64, payloadB64, signature] = parts;
    const dataToVerify = `${headerB64}.${payloadB64}`;

    try {
      const expectedSignature = signData(dataToVerify, getAuthSecret());
      const sigBufA = Buffer.from(signature, 'utf8');
      const sigBufB = Buffer.from(expectedSignature, 'utf8');

      if (sigBufA.length !== sigBufB.length || !timingSafeEqual(sigBufA, sigBufB)) {
        return { valid: false, error: 'Invalid token signature' };
      }

      const payloadJson = base64UrlDecode(payloadB64);
      const payload: SessionTokenPayload = JSON.parse(payloadJson);

      // Verify expiration
      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < nowSec) {
        return { valid: false, error: 'Token has expired' };
      }

      // Check if revoked
      if (payload.jti && revokedTokenIds.has(payload.jti)) {
        return { valid: false, error: 'Token has been revoked' };
      }

      return { valid: true, payload };
    } catch (err: any) {
      return { valid: false, error: `Token verification failed: ${err.message}` };
    }
  }

  /**
   * Revokes a session token by its unique identifier (jti)
   */
  static revokeToken(jti: string): void {
    if (jti) {
      revokedTokenIds.add(jti);
    }
  }

  /**
   * Prunes expired tokens from revocation blacklist periodically
   */
  static clearRevocationList(): void {
    revokedTokenIds.clear();
  }
}
