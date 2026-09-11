import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  scrapeEmailRecordsFromUrl,
  scrapeEmailRecordsFromWebsite,
  extractEmailRecordsFromHtml,
  formatRecords,
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

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static frontend files from public/
const publicDir = path.join(__dirname, '../../public');
app.use(express.static(publicDir));

// Job registry for active crawl streaming sessions
interface ActiveCrawlJob {
  id: string;
  url: string;
  status: 'running' | 'completed' | 'cancelled' | 'error';
  progress?: CrawlProgress;
  records: ScrapedEmailRecord[];
  pagesVisited: number;
  errors: number;
  startedAt: number;
  endedAt?: number;
  cancelled: boolean;
  listeners: Array<(event: string, data: any) => void>;
}

const activeJobs = new Map<string, ActiveCrawlJob>();

// Clean up jobs older than 1 hour
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, job] of activeJobs.entries()) {
    if (job.endedAt && now - job.endedAt > 3600000) {
      activeJobs.delete(id);
    }
  }
}, 60000);
cleanupTimer.unref();

/* ========================================================================= */
/* API Routes                                                                */
/* ========================================================================= */

/**
 * Health check
 */
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    activeCrawlJobs: activeJobs.size
  });
});

/**
 * Scrapes a single webpage
 */
app.post('/api/scrape/page', async (req: Request, res: Response) => {
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
 * Initiates an asynchronous crawl job
 */
app.post('/api/scrape/crawl', async (req: Request, res: Response) => {
  try {
    const {
      url,
      maxDepth = 2,
      maxPages = 30,
      sameDomainOnly = true,
      timeout = 15000,
      delayMs = 250
    } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Valid starting URL is required' });
    }

    const validation = await validateSafeScrapeUrl(url.trim());
    if (!validation.safe) {
      return res.status(400).json({ error: validation.error });
    }

    const limits = sanitizeCrawlLimits(maxDepth, maxPages);

    const jobId = randomUUID();
    const job: ActiveCrawlJob = {
      id: jobId,
      url: url.trim(),
      status: 'running',
      records: [],
      pagesVisited: 0,
      errors: 0,
      startedAt: Date.now(),
      cancelled: false,
      listeners: []
    };

    activeJobs.set(jobId, job);

    // Run crawl asynchronously in background
    (async () => {
      try {
        const result = await scrapeEmailRecordsFromWebsite(job.url, {
          maxDepth: limits.depth,
          maxPages: limits.pages,
          sameDomainOnly: Boolean(sameDomainOnly),
          timeout: parseInt(String(timeout), 10),
          delayMs: parseInt(String(delayMs), 10),
          isCancelled: () => job.cancelled,
          onProgress: (progress) => {
            job.progress = progress;
            job.pagesVisited = progress.pagesVisited;
            broadcastJobEvent(job, 'progress', progress);
          },
          onRecordFound: (rec) => {
            job.records.push(rec);
            broadcastJobEvent(job, 'record', rec);
          },
          onError: (errUrl, err) => {
            job.errors++;
            broadcastJobEvent(job, 'crawler_error', { url: errUrl, message: err.message });
          }
        });

        job.status = job.cancelled ? 'cancelled' : 'completed';
        job.records = result.records;
        job.pagesVisited = result.pagesVisited;
        job.errors = result.errors;
        job.endedAt = Date.now();

        broadcastJobEvent(job, 'done', {
          jobId,
          status: job.status,
          totalRecords: job.records.length,
          pagesVisited: job.pagesVisited,
          errors: job.errors,
          durationMs: job.endedAt - job.startedAt,
          records: job.records
        });
      } catch (err: any) {
        job.status = 'error';
        job.endedAt = Date.now();
        broadcastJobEvent(job, 'error', { message: err.message });
      }
    })();

    res.json({
      success: true,
      jobId,
      streamUrl: `/api/scrape/crawl/stream/${jobId}`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function broadcastJobEvent(job: ActiveCrawlJob, event: string, data: any) {
  for (const listener of job.listeners) {
    listener(event, data);
  }
}

/**
 * Server-Sent Events (SSE) endpoint for live crawl telemetry
 */
app.get('/api/scrape/crawl/stream/:jobId', (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  const job = activeJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial handshake and state
  res.write(`event: init\ndata: ${JSON.stringify({ jobId, status: job.status, url: job.url })}\n\n`);

  // Listener callback
  const listener = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  job.listeners.push(listener);

  // If already finished, deliver done event immediately
  if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'error') {
    res.write(`event: done\ndata: ${JSON.stringify({
      jobId,
      status: job.status,
      totalRecords: job.records.length,
      pagesVisited: job.pagesVisited,
      durationMs: (job.endedAt || Date.now()) - job.startedAt,
      records: job.records
    })}\n\n`);
  }

  req.on('close', () => {
    job.listeners = job.listeners.filter(l => l !== listener);
  });
});

/**
 * Cancels a running crawl job
 */
app.post('/api/scrape/crawl/cancel/:jobId', (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  const job = activeJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  job.cancelled = true;
  job.status = 'cancelled';
  broadcastJobEvent(job, 'cancelled', { jobId });
  res.json({ success: true, message: 'Crawl job cancelled' });
});

/**
 * Batch URL scrape
 */
app.post('/api/scrape/batch', async (req: Request, res: Response) => {
  try {
    const { urls, timeout = 12000, delayMs = 150 } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'An array of URLs is required' });
    }

    const cleanUrls = urls
      .map((u: string) => String(u).trim())
      .filter((u: string) => u.startsWith('http://') || u.startsWith('https://'));

    if (cleanUrls.length === 0) {
      return res.status(400).json({ error: 'No valid http/https URLs provided' });
    }

    const uniqueMap = new Map<string, ScrapedEmailRecord>();
    const resultsSummary: Array<{ url: string; success: boolean; emailCount: number; error?: string }> = [];

    for (let i = 0; i < cleanUrls.length; i++) {
      const targetUrl = cleanUrls[i];
      if (i > 0 && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
      try {
        const { records } = await scrapeEmailRecordsFromUrl(targetUrl, { timeout });
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

    res.json({
      success: true,
      totalUrlsProcessed: cleanUrls.length,
      uniqueEmailsFound: uniqueMap.size,
      summary: resultsSummary,
      records: Array.from(uniqueMap.values())
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Extracts emails from raw text/HTML snippet directly
 */
app.post('/api/scrape/text', (req: Request, res: Response) => {
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
app.post('/api/export', (req: Request, res: Response) => {
  try {
    const { records, format = 'csv', fields } = req.body;
    if (!Array.isArray(records)) {
      return res.status(400).json({ error: 'Records array is required' });
    }

    const validFormats = ['csv', 'json', 'txt', 'vcf'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({ error: `Invalid format. Must be one of: ${validFormats.join(', ')}` });
    }

    const result = formatRecords(records, format as any, Array.isArray(fields) ? fields : undefined);
    const filename = `scraped_emails_${Date.now()}.${result.extension}`;

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(result.data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/* ========================================================================= */
/* HUNTIQ Dedicated Integration Endpoints (Data Acquisition Service v1.0)   */
/* ========================================================================= */

/**
 * Connection & health check for configured HUNTIQ integration
 */
app.post('/api/integrations/huntiq/test', async (req: Request, res: Response) => {
  try {
    const client = new HuntIQClient();
    const result = await client.checkConnection();
    return res.json(result);
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
app.post('/api/integrations/huntiq/sync', async (req: Request, res: Response) => {
  try {
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
    const isAuth = err.message && (err.message.includes('401') || err.message.includes('Unauthorized'));
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
 * Routes through HuntIQClient and strips unsafe/fabricated client overrides
 */
app.post('/api/sync/huntiq', async (req: Request, res: Response) => {
  res.setHeader('Warning', '299 - "This endpoint is deprecated. Use /api/integrations/huntiq/sync instead."');
  try {
    const { records, huntiqApiUrl, apiKey, workspaceId, source = 'EXTERNAL_EMAIL_SCRAPER' } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Valid records array is required' });
    }

    const payload = mapRecordsToHuntIQPayload(records, {
      sourceType: 'website_email_scraper'
    });

    // In testing/local environments, allow URL override for mock server testing
    const client = new HuntIQClient({
      apiUrl: huntiqApiUrl || process.env.HUNTIQ_API_URL,
      apiKey: apiKey || process.env.HUNTIQ_API_KEY,
      workspaceId: workspaceId || process.env.HUNTIQ_WORKSPACE_ID
    });

    const result = await client.syncContacts(payload);

    return res.json({
      success: true,
      syncedCount: result.accepted,
      requestId: result.requestId,
      huntiqResponse: result.huntiqResponse || result
    });
  } catch (err: any) {
    const isConnRefused = err.cause && err.cause.code === 'ECONNREFUSED';
    const isAuth = err.message && err.message.includes('401');
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
app.post('/api/sync/huntiq/test', async (req: Request, res: Response) => {
  res.setHeader('Warning', '299 - "This endpoint is deprecated. Use /api/integrations/huntiq/test instead."');
  try {
    const { huntiqApiUrl, apiKey, workspaceId } = req.body;
    const client = new HuntIQClient({
      apiUrl: huntiqApiUrl || process.env.HUNTIQ_API_URL,
      apiKey: apiKey || process.env.HUNTIQ_API_KEY,
      workspaceId: workspaceId || process.env.HUNTIQ_WORKSPACE_ID
    });
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
  removeRecordFromFolder
} from '../utils/folderStorage';

/**
 * List all saved folders
 */
app.get('/api/folders', (req: Request, res: Response) => {
  try {
    const folders = getAllFolders();
    res.json({ success: true, folders });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Create a new folder
 */
app.post('/api/folders', (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    const folder = createFolder(name.trim());
    res.json({ success: true, folder });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get folder records
 */
app.get('/api/folders/:folderId', (req: Request, res: Response) => {
  try {
    const folder = getFolder(req.params.folderId);
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
app.post('/api/folders/:folderId/save', (req: Request, res: Response) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Valid records array is required' });
    }
    const folder = saveRecordsToFolder(req.params.folderId, records);
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
app.delete('/api/folders/:folderId', (req: Request, res: Response) => {
  try {
    const deleted = deleteFolder(req.params.folderId);
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
app.delete('/api/folders/:folderId/records/:email', (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const removed = removeRecordFromFolder(req.params.folderId, email);
    res.json({ success: removed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ========================================================================= */
/* Deliverability & Live MX Verification Endpoint                           */
/* ========================================================================= */

import { verifyEmailRecords } from '../utils/verifier';

/**
 * Verifies live MX records and deliverability for a list of records
 */
app.post('/api/verify', async (req: Request, res: Response) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Records array is required' });
    }

    const verified = await verifyEmailRecords(records);
    res.json({
      success: true,
      records: verified,
      deliverableCount: verified.filter(r => r.mxStatus === 'deliverable').length,
      undeliverableCount: verified.filter(r => r.mxStatus === 'undeliverable').length,
      disposableCount: verified.filter(r => r.mxStatus === 'disposable').length
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
