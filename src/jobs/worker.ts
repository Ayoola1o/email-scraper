import { scrapeEmailRecordsFromWebsite } from '../scrapers/websiteCrawler';
import { sanitizeCrawlLimits } from '../utils/security';
import { ConcurrencyTracker } from '../auth';
import { CrawlJobMetadata, IJobStore, IEventBus } from './types';
import { jobStore } from './jobStore';
import { eventBus } from './eventBus';

const MAX_RECORDS_PER_JOB = 5000;
const DEFAULT_JOB_TIMEOUT_MS = 600000; // 10 minutes max execution time

export interface WorkerOptions {
  jobStore?: IJobStore;
  eventBus?: IEventBus;
  maxJobDurationMs?: number;
}

/**
 * Robust Worker Executor for Crawl Jobs
 * Enforces execution lifecycle, memory bounds, timeouts, cancellation propagation,
 * and live telemetry publishing.
 */
export class CrawlJobWorker {
  private store: IJobStore;
  private bus: IEventBus;
  private maxDurationMs: number;
  private activeTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(options: WorkerOptions = {}) {
    this.store = options.jobStore || jobStore;
    this.bus = options.eventBus || eventBus;
    this.maxDurationMs = options.maxJobDurationMs || DEFAULT_JOB_TIMEOUT_MS;
  }

  /**
   * Executes a single crawl job through the complete scraping pipeline
   */
  async executeJob(job: CrawlJobMetadata): Promise<CrawlJobMetadata> {
    const jobId = job.id;
    const userId = job.ownerId;
    const isBrowser = Boolean(job.isBrowser);

    // 1. Mark job as running
    job.status = 'running';
    job.startedAt = Date.now();
    await this.store.updateJob(jobId, { status: 'running', startedAt: job.startedAt });
    this.bus.publish(jobId, 'started', { jobId, status: 'running', url: job.url });

    // 2. Set worker-level timeout protection
    const timeoutHandle = setTimeout(() => {
      this.handleJobTimeout(jobId);
    }, this.maxDurationMs);
    this.activeTimeouts.set(jobId, timeoutHandle);

    try {
      const limits = sanitizeCrawlLimits(job.params.maxDepth, job.params.maxPages);
      const safeTimeout = Math.min(60000, Math.max(1000, job.params.timeout || 15000));
      const safeDelay = Math.min(10000, Math.max(0, job.params.delayMs ?? 250));

      const result = await scrapeEmailRecordsFromWebsite(job.url, {
        maxDepth: limits.depth,
        maxPages: limits.pages,
        sameDomainOnly: job.params.sameDomainOnly ?? true,
        timeout: safeTimeout,
        delayMs: safeDelay,
        useBrowser: isBrowser,
        userAgent: job.params.userAgent,
        contactEmail: job.params.contactEmail,
        respectRobotsTxt: job.params.respectRobotsTxt ?? true,
        isCancelled: () => {
          return Boolean(job.cancelled);
        },
        onProgress: async (progress) => {
          job.progress = progress;
          job.pagesVisited = progress.pagesVisited;
          this.bus.publish(jobId, 'progress', progress);
          // Persist periodic progress snapshot every 5 pages
          if (progress.pagesVisited % 5 === 0) {
            await this.store.updateJob(jobId, { progress, pagesVisited: progress.pagesVisited });
          }
        },
        onRecordFound: (rec) => {
          if (job.records.length < MAX_RECORDS_PER_JOB) {
            job.records.push(rec);
          }
          this.bus.publish(jobId, 'record', rec);
        },
        onError: (errUrl, err) => {
          job.errors++;
          this.bus.publish(jobId, 'crawler_error', { url: errUrl, message: err.message });
        }
      });

      // 3. Finalize outcome
      const isCancelled = job.cancelled;
      job.status = isCancelled ? 'cancelled' : 'completed';
      job.records = result.records.slice(0, MAX_RECORDS_PER_JOB);
      job.pagesVisited = result.pagesVisited;
      job.pagesSkipped = result.pagesSkipped;
      job.pagesFailed = result.pagesFailed;
      job.accessRestrictedReason = result.accessRestrictedReason;
      job.errors = result.errors;
      job.endedAt = Date.now();
      job.durationMs = job.endedAt - job.startedAt;

      await this.store.saveJob(job);

      if (isCancelled) {
        this.bus.publish(jobId, 'cancelled', { jobId, status: 'cancelled' });
      } else {
        this.bus.publish(jobId, 'done', {
          jobId,
          status: job.status,
          totalRecords: job.records.length,
          pagesVisited: job.pagesVisited,
          pagesSkipped: job.pagesSkipped,
          pagesFailed: job.pagesFailed,
          accessRestrictedReason: job.accessRestrictedReason,
          errors: job.errors,
          durationMs: job.durationMs,
          records: job.records
        });
      }

      return job;
    } catch (err: any) {
      job.status = job.cancelled ? 'cancelled' : 'failed';
      job.endedAt = Date.now();
      job.durationMs = job.endedAt - job.startedAt;
      job.errorMessage = err.message || 'Crawl execution error';

      await this.store.saveJob(job);
      this.bus.publish(jobId, 'error', { jobId, status: job.status, message: job.errorMessage });
      throw err;
    } finally {
      const handle = this.activeTimeouts.get(jobId);
      if (handle) {
        clearTimeout(handle);
        this.activeTimeouts.delete(jobId);
      }
      ConcurrencyTracker.releaseCrawlSlot(userId, isBrowser);
    }
  }

  /**
   * Automatically handles worker execution timeout
   */
  private async handleJobTimeout(jobId: string): Promise<void> {
    const job = await this.store.getJob(jobId);
    if (job && job.status === 'running') {
      job.cancelled = true;
      job.status = 'failed';
      job.errorMessage = `Job timed out after exceeding ${this.maxDurationMs / 1000}s limit`;
      job.endedAt = Date.now();
      job.durationMs = job.endedAt - job.startedAt;
      await this.store.saveJob(job);
      this.bus.publish(jobId, 'timeout', { jobId, message: job.errorMessage });
    }
  }
}

export const defaultWorker = new CrawlJobWorker();
