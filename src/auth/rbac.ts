import { Request, Response, NextFunction } from 'express';
import { UserRole, Permission, UserContext, AuthContext } from './types';
import { TokenManager } from './tokenManager';
import { ApiKeyManager } from './keyManager';

// Extend Express Request type with auth context
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Role-to-Permissions Mapping Table
 */
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: ['*'],
  user: [
    'crawl:create',
    'crawl:read',
    'crawl:cancel',
    'scrape:create',
    'scrape:read',
    'import:create',
    'export:read',
    'folders:read',
    'folders:manage',
    'keys:manage_own',
    'privacy:manage',
    'system:read'
  ],
  readonly: [
    'crawl:read',
    'scrape:read',
    'export:read',
    'folders:read',
    'system:read'
  ],
  service: [
    'crawl:read',
    'scrape:create',
    'scrape:read',
    'import:create',
    'export:read',
    'huntiq:sync',
    'system:read'
  ]
};

/**
 * Checks if a given role possesses a requested permission
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  if (role === 'admin') return true;
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes('*') || permissions.includes(permission);
}

/**
 * Verifies resource ownership for multi-tenant and IDOR protection
 * Administrators can access any resource. Standard users can only access resources they own.
 */
export function verifyOwnership(resourceOwnerId: string | undefined, user: UserContext): boolean {
  if (user.role === 'admin') return true;
  if (!resourceOwnerId) return true; // Legacy or public resources
  return resourceOwnerId === user.id;
}

/**
 * Extracts and authenticates user context from request headers or cookies.
 * Supports:
 * 1. Authorization: Bearer <session_token> OR Bearer <api_key>
 * 2. X-API-Key: <api_key>
 * 3. Cookie: esp_session=<session_token>
 * 4. ADMIN_API_KEY / SCRAPER_ADMIN_TOKEN (legacy backward compatibility)
 * 5. Test/Development mode fallback when no credentials are provided
 */
export function authenticateRequest(req: Request): AuthContext | null {
  const authHeader = req.headers['authorization'];
  const xApiKey = req.headers['x-api-key'];
  const cookieHeader = req.headers['cookie'];

  // 1. Check X-API-Key header
  if (typeof xApiKey === 'string' && xApiKey.trim()) {
    const keyRes = ApiKeyManager.verifyApiKey(xApiKey.trim());
    if (keyRes.valid && keyRes.record) {
      return {
        user: {
          id: keyRes.record.userId,
          username: keyRes.record.name,
          role: keyRes.record.role
        },
        authMethod: 'api_key',
        keyId: keyRes.record.id
      };
    }
    // Explicit key provided but invalid/expired/revoked
    return null;
  }

  // 2. Check Authorization Header (Bearer token or Bearer API key)
  if (typeof authHeader === 'string' && authHeader.trim()) {
    const trimmed = authHeader.trim();
    const token = trimmed.startsWith('Bearer ') ? trimmed.substring(7).trim() : trimmed;

    // Check if token is an API key format
    if (token.startsWith('esp_live_') || token.startsWith('esp_test_')) {
      const keyRes = ApiKeyManager.verifyApiKey(token);
      if (keyRes.valid && keyRes.record) {
        return {
          user: {
            id: keyRes.record.userId,
            username: keyRes.record.name,
            role: keyRes.record.role
          },
          authMethod: 'api_key',
          keyId: keyRes.record.id
        };
      }
      return null;
    }

    // Check if token is an Admin API Key
    const adminKey = process.env.ADMIN_API_KEY || process.env.SCRAPER_ADMIN_TOKEN;
    if (adminKey && token === adminKey) {
      return {
        user: {
          id: 'admin_sys',
          username: 'System Administrator',
          role: 'admin'
        },
        authMethod: 'admin_token'
      };
    }

    // Check if token is a signed Session Token
    const sessionRes = TokenManager.verifySessionToken(token);
    if (sessionRes.valid && sessionRes.payload) {
      return {
        user: {
          id: sessionRes.payload.sub,
          username: sessionRes.payload.username,
          role: sessionRes.payload.role
        },
        authMethod: 'bearer_token'
      };
    }

    // Explicit token provided but invalid/expired/revoked
    return null;
  }

  // 3. Check Cookie (esp_session)
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map(c => c.trim());
    const sessionCookie = cookies.find(c => c.startsWith('esp_session='));
    if (sessionCookie) {
      const rawVal = sessionCookie.substring('esp_session='.length).trim();
      const token = decodeURIComponent(rawVal);
      const sessionRes = TokenManager.verifySessionToken(token);
      if (sessionRes.valid && sessionRes.payload) {
        return {
          user: {
            id: sessionRes.payload.sub,
            username: sessionRes.payload.username,
            role: sessionRes.payload.role
          },
          authMethod: 'session_cookie'
        };
      }
    }
  }

  // 4. In test / dev environments when NO auth header was supplied, assign dev default context
  // This preserves 100% backward compatibility for existing automated test suites
  const isDevOrTest = process.env.NODE_ENV !== 'production' || process.env.ALLOW_ANONYMOUS_DEV === 'true';
  const requireAuthEnv = process.env.REQUIRE_AUTH === 'true';

  if (isDevOrTest && !requireAuthEnv) {
    return {
      user: {
        id: 'dev_user_default',
        username: 'Developer Default',
        role: 'admin' // Full dev permissions
      },
      authMethod: 'dev_fallback'
    };
  }

  return null;
}

/**
 * Express Middleware: Enforces that a request is authenticated
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = authenticateRequest(req);
  if (!auth) {
    return res.status(401).json({
      error: 'Unauthorized',
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Valid authentication credentials (Bearer token or X-API-Key) are required'
    });
  }

  req.auth = auth;
  next();
}

/**
 * Express Middleware: Enforces specific permission check
 */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      const auth = authenticateRequest(req);
      if (!auth) {
        return res.status(401).json({
          error: 'Unauthorized',
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Valid authentication credentials are required'
        });
      }
      req.auth = auth;
    }

    if (!hasPermission(req.auth.user.role, permission)) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'INSUFFICIENT_PERMISSIONS',
        message: `Action requires permission "${permission}". Your role is "${req.auth.user.role}".`
      });
    }

    next();
  };
}

/**
 * Express Middleware: Enforces specific allowed roles
 */
export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      const auth = authenticateRequest(req);
      if (!auth) {
        return res.status(401).json({
          error: 'Unauthorized',
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Valid authentication credentials are required'
        });
      }
      req.auth = auth;
    }

    if (!allowedRoles.includes(req.auth.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'ROLE_NOT_PERMITTED',
        message: `Action requires one of the following roles: [${allowedRoles.join(', ')}]. Your role is "${req.auth.user.role}".`
      });
    }

    next();
  };
}
