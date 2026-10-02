import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';

// Extend Express Request with requestId and validatedData
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      validatedBody?: any;
      validatedQuery?: any;
      validatedParams?: any;
    }
  }
}

/**
 * Middleware that attaches a unique, trace-friendly requestId to every request
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const existingId = req.headers['x-request-id'];
  const requestId = typeof existingId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(existingId)
    ? existingId
    : `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

/**
 * Formats a consistent, production-safe API error response.
 * Never exposes stack traces, internal paths, raw db/system errors, or credentials.
 */
export function createErrorResponse(
  code: string,
  message: string,
  requestId = 'req_unknown',
  details?: any[]
) {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details && details.length > 0 ? { details } : {}),
      requestId
    },
    message // Legacy convenience string
  };
}

/**
 * Formats Zod validation errors into a clean, field-by-field detail list
 */
export function formatZodError(error: z.ZodError, requestId = 'req_unknown') {
  const issues = (error as any).issues || (error as any).errors || [];
  const details = issues.map((e: any) => ({
    field: Array.isArray(e.path) ? e.path.join('.') : String(e.path || ''),
    message: e.message
  }));

  const mainMessage = details.length > 0
    ? `${details[0].field ? details[0].field + ': ' : ''}${details[0].message}`
    : 'Invalid request parameters';

  return createErrorResponse('INVALID_INPUT', mainMessage, requestId, details);
}

/**
 * Validates request body against a Zod schema.
 * Rejects unexpected properties, malformed types, and out-of-bounds parameters.
 */
export function validateBody(schema: z.ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    // If request has content-type, ensure application/json
    const contentType = req.headers['content-type'];
    if (contentType && !contentType.includes('application/json') && req.method !== 'GET') {
      return res.status(415).json(
        createErrorResponse(
          'UNSUPPORTED_MEDIA_TYPE',
          'Content-Type must be application/json',
          req.requestId
        )
      );
    }

    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(formatZodError(result.error, req.requestId));
    }

    req.validatedBody = result.data;
    req.body = result.data;
    next();
  };
}

/**
 * Validates request query parameters against a Zod schema
 */
export function validateQuery(schema: z.ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json(formatZodError(result.error, req.requestId));
    }

    req.validatedQuery = result.data;
    next();
  };
}

/**
 * Validates request route parameters (:id, :jobId) against a Zod schema
 */
export function validateParams(schema: z.ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json(formatZodError(result.error, req.requestId));
    }

    req.validatedParams = result.data;
    next();
  };
}

/**
 * Global Express Error Handler.
 * Intercepts malformed JSON, payload-too-large, and unhandled errors.
 * Strictly guarantees that internal paths, secrets, and stack traces are NEVER exposed.
 */
export function globalErrorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  const reqId = req.requestId || 'req_unknown';

  // 1. Malformed JSON Body Error (from express.json())
  if (err instanceof SyntaxError && 'body' in err && (err as any).status === 400) {
    return res.status(400).json(
      createErrorResponse('MALFORMED_JSON', 'Malformed JSON payload in request body', reqId)
    );
  }

  // 2. Payload Too Large Error
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json(
      createErrorResponse('PAYLOAD_TOO_LARGE', 'Request payload exceeds maximum allowed size', reqId)
    );
  }

  // 3. Known Safe Application Error
  const status = typeof err.status === 'number' && err.status >= 400 && err.status < 600
    ? err.status
    : 500;

  // Mask internal 500 errors in production to avoid leaking database/filesystem/stack details
  const safeMessage = status >= 500
    ? 'An unexpected internal error occurred. Please try again later.'
    : (err.message || 'An error occurred processing the request');

  const code = err.code || (status === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR');

  return res.status(status).json(createErrorResponse(code, safeMessage, reqId));
}
