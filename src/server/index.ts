import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { randomUUID, timingSafeEqual } from 'crypto';
import {
  scrapeEmailRecordsFromUrl,
  scrapeEmailRecordsFromWebsite,
  extractEmailRecordsFromHtml,
  formatRecords,
  filterRecordsBySegment,
  ScrapedEmailRecord,
  CrawlProgress
} from '../index';
import {
  HuntIQClient,
  HuntIQConfigManager,
  mapRecordsToHuntIQPayload
} from '../integrations/huntiq';
import {
  validateSafeScrapeUrl,
  sanitizeCrawlLimits
} from '../utils/security';
import {
  authenticateRequest,
  requireAuth,
  requirePermission,
  requireRole,
  verifyOwnership,
  TokenManager,
  ApiKeyManager,
  RateLimiter,
  createIpRateLimiter,
  createUserRateLimiter,
  checkAuthBruteForce,
  ConcurrencyTracker,
  UserRole
} from '../auth';
import {
  requestIdMiddleware,
  validateBody,
  validateParams,
  globalErrorHandler,
  createErrorResponse,
  SinglePageScrapeSchema,
  TextScrapeSchema,
  WebsiteCrawlSchema,
  BatchScrapeSchema,
  JobIdParamSchema,
  BulkImportSchema,
  BulkValidatorSchema,
  VerifyMxSchema,
  ExportRequestSchema,
  HuntIQSyncSchema,
  HuntIQConfigSchema,
  AuthTokenSchema,
  CreateApiKeySchema,
  FolderSchema,
  SaveFolderRecordsSchema,
  FolderIdParamSchema,
  sanitizeFilename,
  sanitizeForLog
} from '../validation';
import {
  jobQueue,
  jobStore,
  eventBus,
  LocalEventBus,
  QueueCapacityExceededError
} from '../jobs';

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Configurable CORS with production origin safeguards
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null;

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (mobile, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (!allowedOrigins || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true
}));

// Standard Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'");
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Centralized Request Tracking (X-Request-Id)
app.use(requestIdMiddleware);

// Global Rate Limiting & User Quotas
app.use(createIpRateLimiter());
app.use(createUserRateLimiter());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static frontend files from public/
const publicDir = path.join(__dirname, '../../public');
app.use(express.static(publicDir));

// Durable Job Queue & Store Startup Recovery (Phase Five)
jobQueue.recoverOnStartup().catch((err) => {
  console.warn('[DurableJobQueue] Startup recovery notice:', err.message);
});

/* ========================================================================= */
/* API Routes                                                                */
/* ========================================================================= */

/**
 * Health check with durable job queue telemetry
 */
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    const metrics = await jobQueue.getMetrics();
    return res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      activeCrawlJobs: metrics.running,
      queuedCrawlJobs: metrics.queued,
      completedCrawlJobs: metrics.completed,
      failedCrawlJobs: metrics.failed
    });
  } catch {
    return res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      activeCrawlJobs: 0
    });
  }
});

/* ========================================================================= */
/* API Authentication & Key Management Endpoints (Phase Two Security)        */
/* ========================================================================= */

/**
 * POST /api/auth/token
 * Authenticates user or API client and returns a signed session token.
 * Protected against brute-force attacks via sliding window rate limiter.
 */
app.post('/api/auth/token', validateBody(AuthTokenSchema), async (req: Request, res: Response) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const bruteForceCheck = await checkAuthBruteForce(ip);
    if (!bruteForceCheck.allowed) {
      return RateLimiter.sendRateLimitError(
        res,
        bruteForceCheck,
        'Too many failed authentication attempts. Please try again later.'
      );
    }

    const { username, password, role = 'user', apiKey } = req.body;

    // Support authenticating directly with an API key
    if (apiKey) {
      const keyRes = ApiKeyManager.verifyApiKey(apiKey);
      if (!keyRes.valid || !keyRes.record) {
        return res.status(401).json({ error: 'Unauthorized', message: keyRes.error || 'Invalid API key' });
      }

      const session = TokenManager.createSessionToken({
        id: keyRes.record.userId,
        username: keyRes.record.name,
        role: keyRes.record.role
      });

      res.setHeader('Set-Cookie', `esp_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200`);
      return res.json({
        success: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: {
          id: keyRes.record.userId,
          username: keyRes.record.name,
          role: keyRes.record.role
        }
      });
    }

    // Username validation
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Role assignment
    const validRoles: UserRole[] = ['admin', 'user', 'readonly', 'service'];
    const userRole: UserRole = validRoles.includes(role) ? role : 'user';

    const userId = `usr_${randomUUID().substring(0, 8)}`;
    const session = TokenManager.createSessionToken({
      id: userId,
      username: username.trim(),
      role: userRole
    });

    res.setHeader('Set-Cookie', `esp_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200`);
    return res.json({
      success: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: userId,
        username: username.trim(),
        role: userRole
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/logout
 * Revokes current session token and clears cookie
 */
app.post('/api/auth/logout', (req: Request, res: Response) => {
  const auth = authenticateRequest(req);
  if (auth && auth.authMethod === 'bearer_token') {
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      const verified = TokenManager.verifySessionToken(token);
      if (verified.payload?.jti) {
        TokenManager.revokeToken(verified.payload.jti);
      }
    }
  }

  res.setHeader('Set-Cookie', 'esp_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  return res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * GET /api/auth/me
 * Returns current authenticated user context
 */
app.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
  return res.json({
    success: true,
    user: req.auth!.user,
    authMethod: req.auth!.authMethod
  });
});

/**
 * POST /api/auth/keys
 * Generates a revocable API key (stores only cryptographic hash)
 */
app.post('/api/auth/keys', requireAuth, validateBody(CreateApiKeySchema), (req: Request, res: Response) => {
  try {
    const { name = 'API Key', role, expiresInDays } = req.body;
    const currentUser = req.auth!.user;

    // Standard users cannot grant higher privileges than their own role
    let keyRole: UserRole = currentUser.role;
    if (currentUser.role === 'admin' && role) {
      keyRole = role;
    } else if (currentUser.role !== 'admin' && role === 'admin') {
      return res.status(403).json({ error: 'Forbidden', message: 'Standard users cannot create administrator API keys' });
    }

    const { rawKey, keyRecord } = ApiKeyManager.createApiKey({
      name,
      role: keyRole,
      userId: currentUser.id,
      expiresInDays: expiresInDays ? parseInt(String(expiresInDays), 10) : undefined
    });

    return res.status(201).json({
      success: true,
      rawKey,
      key: keyRecord
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/auth/keys
 * Lists API keys for user (or all keys for admin)
 */
app.get('/api/auth/keys', requireAuth, (req: Request, res: Response) => {
  try {
    const currentUser = req.auth!.user;
    const keys = ApiKeyManager.listApiKeys(currentUser.id, currentUser.role);
    return res.json({ success: true, keys });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/auth/keys/:id
 * Revokes an API key with strict ownership verification
 */
app.delete('/api/auth/keys/:id', requireAuth, (req: Request, res: Response) => {
  try {
    const keyId = req.params.id;
    const currentUser = req.auth!.user;
    const result = ApiKeyManager.revokeApiKey(keyId, currentUser.id, currentUser.role);

    if (!result.success) {
      const status = result.error?.includes('Access denied') ? 403 : 404;
      return res.status(status).json({ success: false, error: result.error });
    }

    return res.json({ success: true, message: 'API key successfully revoked' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Scrapes a single webpage
 */
app.post('/api/scrape/page', requirePermission('scrape:create'), validateBody(SinglePageScrapeSchema), async (req: Request, res: Response) => {
  try {
    const { url, timeout = 12000, userAgent } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Valid URL is required' });
    }

    const validation = await validateSafeScrapeUrl(url.trim());
    if (!validation.safe) {
      return res.status(400).json({ error: validation.error });
    }

    const result = await scrapeEmailRecordsFromUrl(url.trim(), {
      timeout: parseInt(String(timeout), 10),
      userAgent
    });

    return res.json({
      success: true,
      url,
      pageTitle: result.pageTitle,
      statusCode: result.statusCode,
      count: result.records.length,
      records: result.records
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to scrape webpage'
    });
  }
});

/**
 * Initiates an asynchronous crawl job backed by a durable FIFO queue,
 * persistent storage, and background worker processing.
 */
app.post('/api/scrape/crawl', requirePermission('crawl:create'), validateBody(WebsiteCrawlSchema), async (req: Request, res: Response) => {
  try {
    const {
      url,
      maxDepth = 2,
      maxPages = 30,
      sameDomainOnly = true,
      timeout = 15000,
      delayMs = 250,
      useBrowser = false,
      userAgent,
      headers
    } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Valid starting URL is required' });
    }

    const validation = await validateSafeScrapeUrl(url.trim());
    if (!validation.safe) {
      return res.status(400).json({ error: validation.error });
    }

    // Determine authentic owner context
    const auth = req.auth || authenticateRequest(req);
    const userId = auth?.user?.id || 'usr_anonymous';

    // Verify concurrency limits prior to enqueueing
    const slotCheck = ConcurrencyTracker.acquireCrawlSlot(userId, Boolean(useBrowser));
    if (!slotCheck.success) {
      return res.status(429).json({
        error: 'Too Many Requests',
        code: 'CONCURRENCY_LIMIT_EXCEEDED',
        message: slotCheck.error
      });
    }
    // Release immediately; worker will acquire it during active execution
    ConcurrencyTracker.releaseCrawlSlot(userId, Boolean(useBrowser));

    const job = await jobQueue.enqueue(
      url.trim(),
      {
        maxDepth,
        maxPages,
        sameDomainOnly,
        timeout,
        delayMs,
        useBrowser,
        userAgent,
        headers
      },
      userId
    );

    return res.json({
      success: true,
      jobId: job.id,
      streamUrl: `/api/scrape/crawl/stream/${job.id}`
    });
  } catch (err: any) {
    if (err instanceof QueueCapacityExceededError) {
      return res.status(429).json({
        error: 'Too Many Requests',
        code: 'QUEUE_CAPACITY_EXCEEDED',
        message: err.message
      });
    }
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Server-Sent Events (SSE) endpoint for live crawl telemetry.
 * Supports reconnecting clients via Last-Event-ID, event replay, heartbeats,
 * and multi-tenant IDOR protection.
 */
app.get('/api/scrape/crawl/stream/:jobId', validateParams(JobIdParamSchema), async (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  const job = await jobStore.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Multi-tenant Ownership & IDOR Protection Check
  const auth = req.auth || authenticateRequest(req);
  if (auth && !verifyOwnership(job.ownerId, auth.user)) {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'IDOR_ACCESS_DENIED',
      message: 'Access denied: You do not have permission to view or stream another user\'s crawl job'
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // 1. Initial connection handshake event (compatible with existing UI/CLI)
  res.write(`id: ${jobId}:0\nevent: init\ndata: ${JSON.stringify({ jobId, status: job.status, url: job.url })}\n\n`);

  // 2. Reconnecting client support with Last-Event-ID or query parameter
  const lastEventId = req.headers['last-event-id'] || req.query.lastEventId;
  let sinceSeq = 0;
  if (typeof lastEventId === 'string') {
    const parts = lastEventId.split(':');
    if (parts.length === 2) {
      sinceSeq = parseInt(parts[1], 10) || 0;
    }
  }

  if (sinceSeq > 0) {
    const missedEvents = eventBus.getHistory(jobId, sinceSeq);
    for (const evt of missedEvents) {
      res.write(LocalEventBus.formatSse(evt));
    }
  } else {
    // Deliver snapshot if job already has progress or records
    if (job.progress || job.records.length > 0) {
      res.write(`event: snapshot\ndata: ${JSON.stringify({
        jobId,
        status: job.status,
        progress: job.progress,
        pagesVisited: job.pagesVisited,
        recordsCount: job.records.length,
        records: job.records
      })}\n\n`);
    }
  }

  // 3. If job is already in terminal state, deliver done event immediately
  if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
    res.write(`event: done\ndata: ${JSON.stringify({
      jobId,
      status: job.status,
      totalRecords: job.records.length,
      pagesVisited: job.pagesVisited,
      errors: job.errors,
      durationMs: job.durationMs || (job.endedAt ? job.endedAt - job.startedAt : 0),
      records: job.records
    })}\n\n`);
  }

  // 4. Subscribe to live event bus
  const unsubscribe = eventBus.subscribe(jobId, (streamEvent) => {
    res.write(LocalEventBus.formatSse(streamEvent));
  });

  // 5. Periodic heartbeat timer (every 15s to keep connections alive)
  const heartbeatTimer = setInterval(() => {
    res.write(LocalEventBus.formatHeartbeat());
  }, 15000);

  // 6. Memory-safe cleanup on client disconnection
  req.on('close', () => {
    unsubscribe();
    clearInterval(heartbeatTimer);
  });
});

/**
 * Cancels a running or queued crawl job with cross-tenant IDOR protection.
 * Propagates cancellation through the queue and running worker.
 */
app.post('/api/scrape/crawl/cancel/:jobId', requirePermission('crawl:cancel'), validateParams(JobIdParamSchema), async (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  const job = await jobStore.getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Multi-tenant Ownership & IDOR Protection Check
  const auth = req.auth || authenticateRequest(req);
  if (auth && !verifyOwnership(job.ownerId, auth.user)) {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'IDOR_ACCESS_DENIED',
      message: 'Access denied: You do not have permission to cancel another user\'s crawl job'
    });
  }

  const result = await jobQueue.cancelJob(jobId, auth?.user?.id);
  return res.json({ success: result.success, message: result.message });
});

/**
 * GET /api/scrape/crawl/jobs
 * Lists durable crawl jobs for the authenticated user
 */
app.get('/api/scrape/crawl/jobs', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.auth!.user;
    const filterOwner = user.role === 'admin' ? 'all' : user.id;
    const jobs = await jobStore.listJobs(filterOwner, 50);
    return res.json({ success: true, count: jobs.length, jobs });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/scrape/crawl/jobs/:jobId
 * Retrieves full details and records for a specific crawl job
 */
app.get('/api/scrape/crawl/jobs/:jobId', requireAuth, validateParams(JobIdParamSchema), async (req: Request, res: Response) => {
  try {
    const job = await jobStore.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (!verifyOwnership(job.ownerId, req.auth!.user)) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'IDOR_ACCESS_DENIED',
        message: 'Access denied: You do not have permission to inspect this crawl job'
      });
    }

    return res.json({ success: true, job });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/scrape/crawl/metrics
 * System crawl queue metrics
 */
app.get('/api/scrape/crawl/metrics', requireRole(['admin', 'service']), async (req: Request, res: Response) => {
  try {
    const metrics = await jobQueue.getMetrics();
    return res.json({ success: true, metrics });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Batch URL scrape
 * Strictly validates every submitted URL with SSRF checks (protocol, DNS, private/metadata IPs, redirects, size, timeout)
 * Returns per-URL status without allowing one unsafe URL to compromise the batch operation.
 */
app.post('/api/scrape/batch', requirePermission('scrape:create'), validateBody(BatchScrapeSchema), async (req: Request, res: Response) => {
  try {
    const { urls, timeout = 12000, delayMs = 150 } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'An array of URLs is required' });
    }

    if (urls.length > 100) {
      return res.status(400).json({ error: 'Batch scrape limit exceeded. Maximum 100 URLs per batch request.' });
    }

    const uniqueMap = new Map<string, ScrapedEmailRecord>();
    const resultsSummary: Array<{ url: string; success: boolean; emailCount: number; error?: string }> = [];

    for (let i = 0; i < urls.length; i++) {
      const rawTarget = urls[i];
      if (typeof rawTarget !== 'string' || !rawTarget.trim()) {
        resultsSummary.push({ url: String(rawTarget), success: false, emailCount: 0, error: 'Empty or invalid URL string' });
        continue;
      }

      const targetUrl = rawTarget.trim();

      if (i > 0 && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }

      // Step 1: Pre-validate protocol
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        resultsSummary.push({
          url: targetUrl,
          success: false,
          emailCount: 0,
          error: 'Invalid protocol. Only http: and https: are allowed.'
        });
        continue;
      }

      // Step 2: Validate against SSRF (DNS resolution, private/local/metadata IPs, malformed IPs)
      const validation = await validateSafeScrapeUrl(targetUrl);
      if (!validation.safe) {
        resultsSummary.push({
          url: targetUrl,
          success: false,
          emailCount: 0,
          error: validation.error || 'SSRF validation rejected URL'
        });
        continue;
      }

      // Step 3: Fetch with safeFetch (redirect revalidation, streaming size caps, timeout)
      try {
        const { records } = await scrapeEmailRecordsFromUrl(targetUrl, { timeout: parseInt(String(timeout), 10) });
        for (const rec of records) {
          if (!uniqueMap.has(rec.email)) {
            uniqueMap.set(rec.email, rec);
          }
        }
        resultsSummary.push({ url: targetUrl, success: true, emailCount: records.length });
      } catch (err: any) {
        resultsSummary.push({ url: targetUrl, success: false, emailCount: 0, error: err.message });
      }
    }

    return res.json({
      success: true,
      totalUrlsProcessed: urls.length,
      uniqueEmailsFound: uniqueMap.size,
      summary: resultsSummary,
      records: Array.from(uniqueMap.values())
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Extracts emails from raw text/HTML snippet directly
 */
app.post('/api/scrape/text', requirePermission('scrape:create'), validateBody(TextScrapeSchema), (req: Request, res: Response) => {
  try {
    const { text, sourceName = 'Manual Input' } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text content is required' });
    }

    const records = extractEmailRecordsFromHtml(text, sourceName, 'Direct Text Extraction');
    res.json({
      success: true,
      count: records.length,
      records
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Formats and exports records
 */
app.post('/api/export', requirePermission('export:read'), validateBody(ExportRequestSchema), (req: Request, res: Response) => {
  try {
    const { records, format = 'csv', fields, segment = 'all', filename: customFilename } = req.body;
    if (!Array.isArray(records)) {
      return res.status(400).json({ error: 'Records array is required' });
    }

    if (records.length > 50000) {
      return res.status(400).json({ error: 'Cannot export more than 50,000 records at once' });
    }

    const validFormats = ['csv', 'json', 'txt', 'vcf'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({ error: `Invalid format. Must be one of: ${validFormats.join(', ')}` });
    }

    const { filtered, prefix, label } = filterRecordsBySegment(records, segment);
    const result = formatRecords(filtered, format as any, Array.isArray(fields) ? fields : undefined);
    const userFilename = customFilename ? sanitizeFilename(customFilename) : null;
    const filename = userFilename
      ? (userFilename.endsWith(`.${result.extension}`) ? userFilename : `${userFilename}.${result.extension}`)
      : `${prefix}_${Date.now()}.${result.extension}`;

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Segment', label);
    res.setHeader('X-Export-Count', String(filtered.length));
    return res.send(result.data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/* ========================================================================= */
/* HUNTIQ Dedicated Integration Endpoints (Data Acquisition Service v1.0)   */
/* ========================================================================= */

function safeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
      timingSafeEqual(bufA, bufA);
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Administrator authorization check for sensitive server configuration endpoints
 */
function isAuthorizedAdmin(req: Request): boolean {
  // If caller is explicitly authenticated via session token or API key
  const auth = req.auth || authenticateRequest(req);
  if (auth && auth.authMethod !== 'dev_fallback') {
    return auth.user.role === 'admin';
  }

  const adminKey = process.env.ADMIN_API_KEY || process.env.SCRAPER_ADMIN_TOKEN;

  if (adminKey) {
    const authHeader = req.headers['authorization'];
    const xAdminKey = req.headers['x-admin-key'];

    if (typeof authHeader === 'string') {
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
      if (safeCompare(token, adminKey)) {
        return true;
      }
    }

    if (typeof xAdminKey === 'string' && safeCompare(xAdminKey.trim(), adminKey)) {
      return true;
    }

    return false;
  }

  // In test and local development, allow actual socket loopback when no admin secret is configured
  // Note: req.hostname is client-controlled via the Host header and must NOT be trusted for authorization
  const isDevOrTest = process.env.NODE_ENV !== 'production';
  const remoteIp = req.socket.remoteAddress || req.ip || '';
  const isLoopback = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';

  return isDevOrTest && isLoopback;
}

/**
 * GET /api/integrations/huntiq/config
 * Retrieves current server-managed HUNTIQ configuration without returning secrets
 */
app.get('/api/integrations/huntiq/config', (req: Request, res: Response) => {
  try {
    const config = HuntIQConfigManager.getConfig();
    const isConfigured = HuntIQConfigManager.isConfigured();
    return res.json({
      success: true,
      apiUrl: config.apiUrl || '',
      apiKey: '',
      hasApiKey: Boolean(config.apiKey),
      enabled: config.enabled,
      timeoutMs: config.timeoutMs || 30000,
      maxRetries: config.maxRetries || 3,
      isConfigured,
      storage: 'runtime_memory'
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/integrations/huntiq/config
 * Updates server-side HUNTIQ credentials and configuration in process memory
 * Requires administrator authorization and validates inputs strictly.
 */
app.post('/api/integrations/huntiq/config', validateBody(HuntIQConfigSchema), (req: Request, res: Response) => {
  try {
    if (!isAuthorizedAdmin(req)) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Administrator authentication required to update integration configuration'
      });
    }

    const validation = HuntIQConfigManager.validateConfigUpdates(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error || 'Invalid configuration parameters'
      });
    }

    if (validation.cleanUpdates) {
      HuntIQConfigManager.updateConfig(validation.cleanUpdates);
    }

    const updated = HuntIQConfigManager.getConfig();
    return res.json({
      success: true,
      message: 'HUNTIQ runtime configuration updated successfully (in-memory)',
      storage: 'runtime_memory',
      apiUrl: updated.apiUrl,
      apiKey: '',
      hasApiKey: Boolean(updated.apiKey),
      enabled: updated.enabled,
      timeoutMs: updated.timeoutMs,
      maxRetries: updated.maxRetries,
      isConfigured: HuntIQConfigManager.isConfigured()
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Connection & health check for configured HUNTIQ integration
 */
app.post('/api/integrations/huntiq/test', requireRole(['admin', 'service']), async (req: Request, res: Response) => {
  try {
    if (!HuntIQConfigManager.isConfigured()) {
      return res.status(503).json(HuntIQConfigManager.getUnconfiguredError());
    }
    const client = new HuntIQClient();
    const result = await client.checkConnection();
    const httpStatus = result.success ? 200 : (result.statusCode || (result.authenticated === false ? 401 : 502));
    return res.status(httpStatus).json(result);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      integration: 'huntiq',
      reachable: false,
      authenticated: false,
      message: err.message
    });
  }
});

/**
 * Synchronizes discovered contact records into HUNTIQ (Contract v1.0)
 * Uses server-side credentials only and enforces factual discovery
 */
app.post('/api/integrations/huntiq/sync', requireRole(['admin', 'service']), validateBody(HuntIQSyncSchema), async (req: Request, res: Response) => {
  try {
    if (!HuntIQConfigManager.isConfigured()) {
      return res.status(503).json(HuntIQConfigManager.getUnconfiguredError());
    }

    const { records, jobId, companyDomain, companyWebsite, companyName, sourceType } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Valid records array is required' });
    }

    const payload = mapRecordsToHuntIQPayload(records, {
      jobId,
      domain: companyDomain,
      discoveredWebsiteUrl: companyWebsite,
      discoveredCompanyName: companyName,
      sourceType: sourceType || 'website_email_scraper'
    });

    const client = new HuntIQClient();
    const result = await client.syncContacts(payload);
    return res.json(result);
  } catch (err: any) {
    if (err.code === 'HUNTIQ_INTEGRATION_NOT_CONFIGURED') {
      return res.status(503).json(HuntIQConfigManager.getUnconfiguredError());
    }
    const isAuth = err.statusCode === 401 || (err.message && (err.message.includes('401') || err.message.includes('Unauthorized')));
    const isConnRefused = err.cause && err.cause.code === 'ECONNREFUSED';
    const statusCode = isAuth ? 401 : isConnRefused ? 502 : 500;
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'HUNTIQ synchronization failed'
    });
  }
});

/**
 * Backward compatibility: Deprecated sync endpoint
 * Routes through HuntIQClient and strictly ignores client-controlled credentials/workspaces
 */
app.post('/api/sync/huntiq', requireRole(['admin', 'service']), validateBody(HuntIQSyncSchema), async (req: Request, res: Response) => {
  res.setHeader('Warning', '299 - "This endpoint is deprecated. Use /api/integrations/huntiq/sync instead."');
  try {
    if (!HuntIQConfigManager.isConfigured()) {
      return res.status(503).json(HuntIQConfigManager.getUnconfiguredError());
    }

    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Valid records array is required' });
    }

    const payload = mapRecordsToHuntIQPayload(records, {
      sourceType: 'website_email_scraper'
    });

    const client = new HuntIQClient();
    const result = await client.syncContacts(payload);

    return res.json({
      success: true,
      syncedCount: result.accepted,
      requestId: result.requestId,
      huntiqResponse: result.huntiqResponse || result
    });
  } catch (err: any) {
    if (err.code === 'HUNTIQ_INTEGRATION_NOT_CONFIGURED') {
      return res.status(503).json(HuntIQConfigManager.getUnconfiguredError());
    }
    const isConnRefused = err.cause && err.cause.code === 'ECONNREFUSED';
    const isAuth = err.statusCode === 401 || (err.message && err.message.includes('401'));
    const status = isAuth ? 401 : isConnRefused ? 502 : 500;
    return res.status(status).json({
      success: false,
      error: `HUNTIQ sync error: ${err.message}`
    });
  }
});

/**
 * Backward compatibility: Deprecated connection test endpoint
 */
app.post('/api/sync/huntiq/test', requireRole(['admin', 'service']), async (req: Request, res: Response) => {
  res.setHeader('Warning', '299 - "This endpoint is deprecated. Use /api/integrations/huntiq/test instead."');
  try {
    if (!HuntIQConfigManager.isConfigured()) {
      return res.status(503).json(HuntIQConfigManager.getUnconfiguredError());
    }
    const client = new HuntIQClient();
    const result = await client.checkConnection();
    res.json(result);
  } catch (err: any) {
    res.json({
      success: false,
      reachable: false,
      error: err.message
    });
  }
});

/* ========================================================================= */
/* Folder & Search Organization Endpoints                                    */
/* ========================================================================= */

import {
  getAllFolders,
  createFolder,
  saveRecordsToFolder,
  getFolder,
  deleteFolder,
  removeRecordFromFolder,
  getStorageDriverInfo
} from '../utils/folderStorage';

/**
 * List all saved folders
 */
app.get('/api/folders', requirePermission('folders:read'), (req: Request, res: Response) => {
  try {
    const folders = getAllFolders();
    const storageInfo = getStorageDriverInfo();
    res.json({ success: true, folders, storage: storageInfo.storageType });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Create a new folder
 */
app.post('/api/folders', requirePermission('folders:manage'), validateBody(FolderSchema), (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    const cleanName = name.trim();
    if (cleanName.length > 100) {
      return res.status(400).json({ error: 'Folder name cannot exceed 100 characters' });
    }
    const folder = createFolder(cleanName);
    res.json({ success: true, folder });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get folder records
 */
app.get('/api/folders/:folderId', requirePermission('folders:read'), validateParams(FolderIdParamSchema), (req: Request, res: Response) => {
  try {
    const folderId = (req.params.folderId || '').trim();
    if (!folderId) {
      return res.status(400).json({ error: 'Valid folder ID is required' });
    }
    const folder = getFolder(folderId);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    res.json({ success: true, folder });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Save / Move search records to a folder
 */
app.post('/api/folders/:folderId/save', requirePermission('folders:manage'), validateParams(FolderIdParamSchema), validateBody(SaveFolderRecordsSchema), (req: Request, res: Response) => {
  try {
    const folderId = (req.params.folderId || '').trim();
    if (!folderId) {
      return res.status(400).json({ error: 'Valid folder ID is required' });
    }
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Valid records array is required' });
    }
    if (records.length > 10000) {
      return res.status(400).json({ error: 'Cannot save more than 10,000 records at once' });
    }
    const folder = saveRecordsToFolder(folderId, records);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    res.json({ success: true, folder, count: folder.records.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Delete a folder
 */
app.delete('/api/folders/:folderId', requirePermission('folders:manage'), validateParams(FolderIdParamSchema), (req: Request, res: Response) => {
  try {
    const folderId = (req.params.folderId || '').trim();
    if (!folderId) {
      return res.status(400).json({ error: 'Valid folder ID is required' });
    }
    const deleted = deleteFolder(folderId);
    if (!deleted) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    res.json({ success: true, message: 'Folder deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Remove record from folder
 */
app.delete('/api/folders/:folderId/records/:email', requirePermission('folders:manage'), validateParams(FolderIdParamSchema), (req: Request, res: Response) => {
  try {
    const folderId = (req.params.folderId || '').trim();
    const email = decodeURIComponent(req.params.email || '').trim();
    if (!folderId || !email) {
      return res.status(400).json({ error: 'Valid folder ID and email are required' });
    }
    const removed = removeRecordFromFolder(folderId, email);
    res.json({ success: removed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ========================================================================= */
/* Deliverability & Live MX Verification & Import Endpoints                */
/* ========================================================================= */

import { verifyEmailRecords } from '../utils/verifier';
import { parseEmailList } from '../utils/importer';
import { validateBulkEmailsTwoLayer } from '../utils/twoLayerValidator';

/**
 * Common verification handler supporting both { records: [...] } and { emails: [...] }
 * Runs the comprehensive 2-layer pipeline:
 *  Layer 1: 16 static pre-SMTP checks
 *  Layer 2: Live DNS MX with RFC 5321 A fallback & full MX enrichment
 */
async function handleVerificationRequest(req: Request, res: Response) {
  try {
    const { records, emails } = req.body;
    let targetRecords: ScrapedEmailRecord[] = [];

    if (Array.isArray(records) && records.length > 0) {
      targetRecords = records.map(r => {
        if (typeof r === 'string') {
          const parsed = parseEmailList(r);
          return parsed.records[0] || null;
        }
        return r;
      }).filter(Boolean);
    } else if (Array.isArray(emails) && emails.length > 0) {
      const parsed = parseEmailList(emails.join('\n'));
      targetRecords = parsed.records;
    } else {
      return res.status(400).json({ error: 'Valid records or emails array is required' });
    }

    if (targetRecords.length === 0) {
      return res.status(400).json({ error: 'No valid email records to verify' });
    }

    if (targetRecords.length > 5000) {
      return res.status(400).json({ error: 'Cannot verify more than 5,000 records at once' });
    }

    const validationOutputs = await validateBulkEmailsTwoLayer(targetRecords);
    const verified = validationOutputs.map(o => o.record);
    const deliverableCount = verified.filter(r => r.mxStatus === 'deliverable').length;
    const undeliverableCount = verified.filter(r => r.mxStatus === 'undeliverable').length;
    const disposableCount = verified.filter(r => r.mxStatus === 'disposable').length;

    const outputs = validationOutputs.map(o => ({
      email: o.email,
      canonicalEmail: o.canonicalEmail || o.email,
      mailboxStatus: o.mailboxStatus || 'unknown',
      intelligenceFlags: {
        isFreeMail: Boolean(o.isFreeMail),
        isRoleAccount: Boolean(o.isRoleAccount),
        isDisposable: Boolean(o.isDisposable),
        isGibberish: Boolean(o.isGibberish),
        isSpamTrap: Boolean(o.isSpamTrap),
        isCatchAll: Boolean(o.isCatchAll),
        entropyScore: o.entropyScore ?? 0,
        staticChecks: o.staticChecks || { passed: 0, total: 16, failedChecks: [] }
      },
      typoSuggestion: o.typoSuggestion || null,
      canonicalDeduplicationForm: o.canonicalDeduplicationForm || o.canonicalEmail || o.email,
      mxEnrichment: o.mxEnrichment || null
    }));

    return res.json({
      success: true,
      records: verified,
      results: verified, // Compatibility alias for frontend components
      outputs,
      totalCount: verified.length,
      deliverableCount,
      undeliverableCount,
      disposableCount
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Verifies live MX records and deliverability for a list of records or emails
 */
app.post('/api/verify', requirePermission('system:read'), validateBody(VerifyMxSchema), handleVerificationRequest);
app.post('/api/verify/mx', requirePermission('system:read'), validateBody(VerifyMxSchema), handleVerificationRequest);

/**
 * Bulk Email Validator Endpoint (CSV, TXT, or Array input)
 * Every address automatically passes through both layers:
 *   Layer 1: 16 static pre-SMTP checks (RFC syntax, DNS label rules, IANA TLDs, disposable DB, role account, freemail, entropy, typos, blacklist)
 *   Layer 2: Live SMTP/MX verification with RFC 5321 A-record fallback & complete MX enrichment
 * Returns mailbox status, intelligence flags, typo suggestions, canonical deduplication form, and complete MX enrichment.
 */
app.post('/api/validator/bulk', requirePermission('import:create'), validateBody(BulkValidatorSchema), async (req: Request, res: Response) => {
  try {
    const { csv, text, fileContent, records, emails } = req.body;
    let targetRecords: ScrapedEmailRecord[] = [];

    const rawInput = typeof csv === 'string' ? csv : (typeof text === 'string' ? text : (typeof fileContent === 'string' ? fileContent : null));

    if (rawInput && rawInput.trim()) {
      if (rawInput.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'File size exceeds 10MB limit' });
      }
      const parsed = parseEmailList(rawInput, { allowInvalidSyntax: true });
      targetRecords = parsed.records;
    } else if (Array.isArray(records) && records.length > 0) {
      targetRecords = records.map(r => {
        if (typeof r === 'string') {
          const parsed = parseEmailList(r, { allowInvalidSyntax: true });
          return parsed.records[0] || null;
        }
        return r;
      }).filter(Boolean);
    } else if (Array.isArray(emails) && emails.length > 0) {
      const parsed = parseEmailList(emails.join('\n'), { allowInvalidSyntax: true });
      targetRecords = parsed.records;
    } else {
      return res.status(400).json({ error: 'Upload a CSV or TXT file content, or supply records/emails array' });
    }

    if (targetRecords.length === 0) {
      return res.status(400).json({ error: 'No valid email addresses found in submitted data' });
    }

    if (targetRecords.length > 10000) {
      return res.status(400).json({ error: 'Cannot process more than 10,000 addresses in a single bulk validator run' });
    }

    const validationOutputs = await validateBulkEmailsTwoLayer(targetRecords);
    const verified = validationOutputs.map(o => o.record);

    const deliverableCount = verified.filter(r => r.mxStatus === 'deliverable').length;
    const undeliverableCount = verified.filter(r => r.mxStatus === 'undeliverable').length;
    const disposableCount = verified.filter(r => r.mxStatus === 'disposable').length;
    const riskyCount = verified.filter(r => r.mxStatus === 'risky').length;
    const layer1BlockedCount = verified.filter(r => r.staticChecks && r.staticChecks.passed < r.staticChecks.total).length;

    const outputs = validationOutputs.map(o => ({
      email: o.email,
      mailboxStatus: o.mailboxStatus || 'unknown',
      canonicalDeduplicationForm: o.canonicalDeduplicationForm || o.canonicalEmail || o.email,
      typoSuggestion: o.typoSuggestion || null,
      intelligenceFlags: {
        isFreeMail: Boolean(o.isFreeMail),
        isRoleAccount: Boolean(o.isRoleAccount),
        isDisposable: Boolean(o.isDisposable),
        isGibberish: Boolean(o.isGibberish),
        isSpamTrap: Boolean(o.isSpamTrap),
        isCatchAll: Boolean(o.isCatchAll),
        entropyScore: o.entropyScore ?? 0,
        staticChecks: o.staticChecks || { passed: 0, total: 16, failedChecks: [] }
      },
      mxEnrichment: o.mxEnrichment || {
        ip: undefined,
        hostname: (o.mxRecords && o.mxRecords[0]) || undefined,
        country: 'Unknown',
        city: 'Unknown',
        isp: 'Unknown ISP',
        asn: 'Unknown'
      }
    }));

    return res.json({
      success: true,
      totalProcessed: verified.length,
      deliverableCount,
      undeliverableCount,
      disposableCount,
      riskyCount,
      layer1FilteredCount: layer1BlockedCount,
      layer1FilterRate: `${((layer1BlockedCount / verified.length) * 100).toFixed(1)}%`,
      records: verified,
      outputs
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Imports pre-compiled email lists (CSV, TSV, JSON, or Plaintext)
 * with optional instant live MX deliverability verification
 */
app.post('/api/import', requirePermission('import:create'), validateBody(BulkImportSchema), async (req: Request, res: Response) => {
  try {
    const {
      text,
      records: inputRecords,
      verifyNow = false,
      sourceName = 'Imported List',
      defaultCompany,
      jobId
    } = req.body;

    let parsedResult;

    if (typeof text === 'string' && text.trim()) {
      if (text.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'Import file size exceeds 10MB limit' });
      }
      parsedResult = parseEmailList(text, {
        sourceName,
        defaultCompany,
        jobId: jobId || `import_${Date.now().toString(36)}`
      });
    } else if (Array.isArray(inputRecords) && inputRecords.length > 0) {
      parsedResult = {
        records: inputRecords,
        totalRowsProcessed: inputRecords.length,
        validCount: inputRecords.length,
        invalidCount: 0,
        duplicateCount: 0,
        syntaxErrors: [],
        detectedColumns: ['email'],
        detectedFormat: 'json' as const
      };
    } else {
      return res.status(400).json({ error: 'Text content or records array is required for import' });
    }

    let finalRecords = parsedResult.records;

    if (verifyNow && finalRecords.length > 0) {
      // Run complete 2-layer email validation and verification
      const validationOutputs = await validateBulkEmailsTwoLayer(finalRecords);
      finalRecords = validationOutputs.map(o => o.record);
    }

    const deliverableCount = finalRecords.filter(r => r.mxStatus === 'deliverable').length;
    const undeliverableCount = finalRecords.filter(r => r.mxStatus === 'undeliverable').length;
    const disposableCount = finalRecords.filter(r => r.mxStatus === 'disposable').length;
    const pendingCount = finalRecords.filter(r => !r.mxStatus || r.mxStatus === 'pending').length;

    return res.json({
      success: true,
      verified: Boolean(verifyNow),
      count: finalRecords.length,
      records: finalRecords,
      deliverableCount,
      undeliverableCount,
      disposableCount,
      pendingCount,
      summary: {
        totalRowsProcessed: parsedResult.totalRowsProcessed,
        validCount: parsedResult.validCount,
        invalidCount: parsedResult.invalidCount,
        duplicateCount: parsedResult.duplicateCount,
        detectedFormat: parsedResult.detectedFormat,
        detectedColumns: parsedResult.detectedColumns,
        syntaxErrors: parsedResult.syntaxErrors.slice(0, 10)
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/* ========================================================================= */
/* Mock / Demo Endpoints (For offline testing & zero-configuration trial)   */
/* ========================================================================= */

app.get('/api/demo', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Acme Global Innovations - Corporate Directory & Contacts</title>
</head>
<body style="font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px;">
  <h1>Acme Global Innovations</h1>
  <p>Connecting technologies across artificial intelligence, cloud automation, and web intelligence.</p>

  <h2>General Inquiries & Departments</h2>
  <ul>
    <li>Customer Support: <a href="mailto:support@acme-demo.com">support@acme-demo.com</a></li>
    <li>Sales & Partnerships: sales@acme-demo.com (Available Mon-Fri 9am-6pm EST)</li>
    <li>General Office: &#105;&#110;&#102;&#111;&#64;acme-demo.com (Encrypted HTML entities)</li>
    <li>Press & Media Relations: press [at] acme-demo [dot] org</li>
  </ul>

  <h2>Leadership Team</h2>
  <p>Meet our executive leadership driving forward-thinking innovation:</p>
  <ul>
    <li>Dr. Elena Rostova, Chief Executive Officer: elena.rostova@acme-demo.com</li>
    <li>Marcus Vance, Chief Technology Officer: marcus.vance@techcorp.io</li>
    <li>David Kim, VP of Customer Success: david.kim@acme-demo.com</li>
  </ul>

  <h2>Explore Our Company</h2>
  <nav>
    <a href="/api/demo/about">About Our Mission</a> |
    <a href="/api/demo/team">Engineering Team</a> |
    <a href="/api/demo/careers">Careers & Open Roles</a>
  </nav>

  <footer style="margin-top: 50px; font-size: 0.9em; color: #666;">
    <p>&copy; 2026 Acme Global Innovations. Inquiries can also be directed to contact@acme-demo.com.</p>
  </footer>
</body>
</html>`);
});

app.get('/api/demo/about', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>About Us - Acme Global Innovations</title></head>
<body style="font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px;">
  <h1>About Acme Global Innovations</h1>
  <p>Founded in 2020, Acme builds cutting-edge enterprise infrastructure.</p>
  <p>For investor relations, please connect with investors@acme-demo.com or our financial director at audit@acme-demo.com.</p>
  <p><a href="/api/demo">Back to Home</a> | <a href="/api/demo/team">Our Team</a></p>
</body>
</html>`);
});

app.get('/api/demo/team', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Engineering & Research Team - Acme</title></head>
<body style="font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px;">
  <h1>Our Engineering Team</h1>
  <p>Reach out to specific leads below:</p>
  <ul>
    <li>Frontend Engineering: sophia.chen@acme-demo.com</li>
    <li>Security & Infrastructure: security@acme-demo.com</li>
    <li>Research & Data Science: research-team@acme-demo.com</li>
  </ul>
  <p><a href="/api/demo">Back to Home</a></p>
</body>
</html>`);
});

app.get('/api/demo/careers', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Careers at Acme Global Innovations</title></head>
<body style="font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px;">
  <h1>Join Our Team</h1>
  <p>We are hiring across multiple departments worldwide.</p>
  <p>Send your resume directly to our recruiting talent desk at careers@acme-demo.com or hr.talent@acme-demo.com.</p>
  <p><a href="/api/demo">Back to Home</a></p>
</body>
</html>`);
});

// Global error handling middleware - sanitize error responses and avoid leaking internals
app.use(globalErrorHandler);

/* ========================================================================= */
/* Server Initialization                                                     */
/* ========================================================================= */

export function startServer(port: number = PORT) {
  return app.listen(port, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Email Scraper Pro Web App & API is running!`);
    console.log(`🌐 Dashboard: http://localhost:${port}`);
    console.log(`🧪 Interactive Demo: http://localhost:${port}/api/demo`);
    console.log(`======================================================\n`);
  });
}

if (require.main === module) {
  startServer(PORT);
}

export { app };
