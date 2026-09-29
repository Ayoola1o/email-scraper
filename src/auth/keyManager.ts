import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { ApiKeyRecord, UserRole } from './types';

/**
 * In-memory secure API key registry.
 * Maps keyHash -> ApiKeyRecord.
 * Raw API keys are NEVER retained in memory or disk.
 */
const apiKeyStore = new Map<string, ApiKeyRecord>();

// Salt for key hashing to prevent rainbow table attacks
const KEY_HASH_SALT = process.env.API_KEY_SALT || 'email_scraper_sec_salt_v1';

/**
 * Computes SHA-256 hash of a raw API key with salt
 */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256')
    .update(`${KEY_HASH_SALT}:${rawKey}`)
    .digest('hex');
}

export class ApiKeyManager {
  /**
   * Generates a new cryptographically secure API key.
   * Returns the raw API key once (to present to the user/client).
   * Stores ONLY the SHA-256 hash.
   */
  static createApiKey(options: {
    name: string;
    role: UserRole;
    userId: string;
    expiresInDays?: number;
  }): { rawKey: string; keyRecord: Omit<ApiKeyRecord, 'keyHash'> } {
    const { name, role, userId, expiresInDays } = options;

    // Generate random 32-byte secret prefix + token
    const randomHex = randomBytes(24).toString('hex');
    const rawKey = `esp_live_${randomHex}`;
    const keyHash = hashApiKey(rawKey);

    const now = Date.now();
    const expiresAt = expiresInDays && expiresInDays > 0
      ? now + expiresInDays * 86400000
      : undefined;

    const id = `key_${randomBytes(8).toString('hex')}`;

    const record: ApiKeyRecord = {
      id,
      keyHash,
      name: name.trim() || 'Default API Key',
      role,
      userId,
      createdAt: now,
      expiresAt,
      isRevoked: false
    };

    apiKeyStore.set(keyHash, record);

    return {
      rawKey,
      keyRecord: {
        id: record.id,
        name: record.name,
        role: record.role,
        userId: record.userId,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        isRevoked: record.isRevoked
      }
    };
  }

  /**
   * Validates an API key using cryptographic hashing.
   * Updates lastUsedAt timestamp.
   */
  static verifyApiKey(rawKey: string): { valid: boolean; record?: ApiKeyRecord; error?: string } {
    if (!rawKey || typeof rawKey !== 'string') {
      return { valid: false, error: 'API key is missing or malformed' };
    }

    const trimmed = rawKey.trim();
    if (!trimmed.startsWith('esp_live_') && !trimmed.startsWith('esp_test_')) {
      return { valid: false, error: 'Invalid API key format' };
    }

    const incomingHash = hashApiKey(trimmed);
    const incomingBuf = Buffer.from(incomingHash, 'utf8');

    // Search constant-time across key store
    for (const [storedHash, record] of apiKeyStore.entries()) {
      const storedBuf = Buffer.from(storedHash, 'utf8');
      if (storedBuf.length === incomingBuf.length && timingSafeEqual(storedBuf, incomingBuf)) {
        if (record.isRevoked) {
          return { valid: false, error: 'API key has been revoked' };
        }

        if (record.expiresAt && Date.now() > record.expiresAt) {
          return { valid: false, error: 'API key has expired' };
        }

        // Record usage
        record.lastUsedAt = Date.now();
        return { valid: true, record };
      }
    }

    return { valid: false, error: 'Invalid or unknown API key' };
  }

  /**
   * Revokes an existing API key
   */
  static revokeApiKey(keyId: string, requesterUserId: string, requesterRole: UserRole): { success: boolean; error?: string } {
    for (const record of apiKeyStore.values()) {
      if (record.id === keyId) {
        // Enforce ownership: standard users can only revoke their own keys
        if (requesterRole !== 'admin' && record.userId !== requesterUserId) {
          return { success: false, error: 'Access denied: You do not own this API key' };
        }

        record.isRevoked = true;
        record.revokedAt = Date.now();
        return { success: true };
      }
    }
    return { success: false, error: 'API key not found' };
  }

  /**
   * Lists API keys for a user (without exposing raw keys or hashes)
   */
  static listApiKeys(requesterUserId: string, requesterRole: UserRole): Array<Omit<ApiKeyRecord, 'keyHash'>> {
    const results: Array<Omit<ApiKeyRecord, 'keyHash'>> = [];
    for (const record of apiKeyStore.values()) {
      if (requesterRole === 'admin' || record.userId === requesterUserId) {
        results.push({
          id: record.id,
          name: record.name,
          role: record.role,
          userId: record.userId,
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
          lastUsedAt: record.lastUsedAt,
          revokedAt: record.revokedAt,
          isRevoked: record.isRevoked
        });
      }
    }
    return results;
  }

  /**
   * Test helper to clear key store
   */
  static clear(): void {
    apiKeyStore.clear();
  }
}
