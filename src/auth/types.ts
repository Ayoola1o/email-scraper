/**
 * Authentication, Authorization (RBAC) & Rate Limiting Types
 */

export type UserRole = 'admin' | 'user' | 'readonly' | 'service';

export type Permission =
  | '*'
  | 'crawl:create'
  | 'crawl:read'
  | 'crawl:cancel'
  | 'scrape:create'
  | 'scrape:read'
  | 'import:create'
  | 'export:read'
  | 'folders:read'
  | 'folders:manage'
  | 'huntiq:config'
  | 'huntiq:sync'
  | 'keys:manage'
  | 'keys:manage_own'
  | 'privacy:manage'
  | 'privacy:audit:read'
  | 'system:read';

export interface UserContext {
  id: string;
  username: string;
  role: UserRole;
  quotaMultiplier?: number;
}

export interface AuthContext {
  user: UserContext;
  authMethod: 'bearer_token' | 'api_key' | 'session_cookie' | 'admin_token' | 'dev_fallback';
  keyId?: string;
}

export interface ApiKeyRecord {
  id: string;
  keyHash: string;
  name: string;
  role: UserRole;
  userId: string;
  createdAt: number;
  expiresAt?: number;
  lastUsedAt?: number;
  revokedAt?: number;
  isRevoked: boolean;
}

export interface SessionTokenPayload {
  sub: string; // userId
  username: string;
  role: UserRole;
  iat: number;
  exp: number;
  jti: string; // token id for revocation
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
  retryAfterSeconds: number;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}
