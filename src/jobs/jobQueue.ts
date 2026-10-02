import { randomUUID } from 'crypto';
import { CrawlJobMetadata, CrawlJobParameters, IJobStore, IEventBus, JobQueueMetrics } from './types';
import { jobStore } from './jobStore';
import { eventBus } from './eventBus';
import { CrawlJobWorker, defaultWorker } from './worker';
import { ConcurrencyTracker } from '../auth';

const MAX_QUEUE_CAPACITY = parseInt(process.env.MAX_JOB_QUEUE_CAPACITY || '100', 10);
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_GLOBAL_CONCURRENT_JOBS || '5', 10);
const DEFAULT_RETENTION_MS = 24 * 3600 * 1000;

export interface QueueOptions {
  jobStore?: IJobStore;
  eventBus?: IEventBus;
  worker?: CrawlJobWorker;
  maxQueueCapacity?: number;
  maxConcurrentJobs?: number;
}

export class QueueCapacityExceededError extends Error {
  constructor(message = 'Job queue capacity exceeded. Please retry later.') {
    super(message);
    this.name = 'QueueCapacityExceededError';
  }
}

/**
 * Production-ready Durable Job Queue
 * Features FIFO queuing, backpressure, distributed concurrency bounds,
 * retry policies with backoff, cancellation propagation, and recovery.
 */
export class DurableJobQueue {
  private store: IJobStore;
  private bus: IEventBus;
  private worker: CrawlJobWorker;
  private maxCapacity: number;
  private maxConcurrent: number;

  private queue: string[] = []; // Array of Job IDs waiting to run
  private activeJobs: Set<string> = new Set(); // Set of currently executing Job IDs
  private processing = false;
  private totalProcessed = 0;

  constructor(options: QueueOptions = {}) {
    this.store = options.jobStore || jobStore;
    this.bus = options.eventBus || eventBus;
    this.worker = options.worker || defaultWorker;
    this.maxCapacity = options.maxQueueCapacity || MAX_QUEUE_CAPACITY;
    this.maxConcurrent = options.maxConcurrentJobs || MAX_CONCURRENT_JOBS;

    // Periodically prune expired jobs every 15 minutes
    const pruneTimer = setInterval(() => {
      this.store.pruneExpiredJobs(DEFAULT_RETENTION_MS).catch(() => {});
    }, 900000);
    pruneTimer.unref();
  }

  /**
   * Enqueues a new crawl job with backpressure and concurrency verification
   */
  async enqueue(url: string, params: CrawlJobParameters, ownerId: string): Promise<CrawlJobMetadata> {
    if (this.queue.length >= this.maxCapacity) {
      throw new QueueCapacityExceededError(
        `Job queue is currently full (${this.queue.length}/${this.maxCapacity}). Please try again later.`
      );
    }

    const jobId = randomUUID();
    const isBrowser = Boolean(params.useBrowser);
    const now = Date.now();

    const job: CrawlJobMetadata = {
      id: jobId,
      url: url.trim(),
      status: 'queued',
      ownerId,
      params,
      records: [],
      pagesVisited: 0,
      errors: 0,
      startedAt: now,
      cancelled: false,
      retryCount: 0,
      maxRetries: 2,
      isBrowser,
      expiresAt: now + DEFAULT_RETENTION_MS,
      updatedAt: now
    };

    await this.store.saveJob(job);
    this.queue.push(jobId);
    this.bus.publish(jobId, 'queued', { jobId, position: this.queue.length });

    // Trigger queue processor asynchronously
    setImmediate(() => this.processNext());

    return job;
  }

  /**
   * Main queue processing loop
   */
  private async processNext(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0 && this.activeJobs.size < this.maxConcurrent) {
        const jobId = this.queue[0];
        const job = await this.store.getJob(jobId);

        if (!job) {
          this.queue.shift();
          continue;
        }

        if (job.cancelled) {
          this.queue.shift();
          continue;
        }

        // Check user & browser concurrency slot availability
        const slot = ConcurrencyTracker.acquireCrawlSlot(job.ownerId, job.isBrowser);
        if (!slot.success) {
          // Concurrency limit reached for this specific user, pause processing this item for 500ms
          break;
        }

        // Shift from queue and add to activeJobs set
        this.queue.shift();
        this.activeJobs.add(jobId);

        // Dispatch execution asynchronously
        this.executeAndHandle(job);
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Dispatches job to worker, handles retries, and triggers next queue item on finish
   */
  private async executeAndHandle(job: CrawlJobMetadata): Promise<void> {
    const jobId = job.id;

    try {
      await this.worker.executeJob(job);
      this.totalProcessed++;
    } catch (err: any) {
      this.totalProcessed++;
      const isTransient = this.isTransientError(err);
      const isCancelled = job.cancelled;

      if (!isCancelled && isTransient && job.retryCount < job.maxRetries) {
        job.retryCount++;
        job.status = 'queued';
        const backoffMs = Math.pow(2, job.retryCount) * 1000;
        await this.store.saveJob(job);

        setTimeout(() => {
          this.queue.push(jobId);
          this.processNext();
        }, backoffMs);
      }
    } finally {
      this.activeJobs.delete(jobId);
      setImmediate(() => this.processNext());
    }
  }

  /**
   * Cancels a job whether it is currently queued or executing
   */
  async cancelJob(jobId: string, requestedByUserId?: string): Promise<{ success: boolean; message: string }> {
    const job = await this.store.getJob(jobId);
    if (!job) {
      return { success: false, message: 'Job not found' };
    }

    job.cancelled = true;

    // If waiting in queue, cancel immediately
    const queueIndex = this.queue.indexOf(jobId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
      job.status = 'cancelled';
      job.endedAt = Date.now();
      job.durationMs = job.endedAt - job.startedAt;
      await this.store.saveJob(job);
      this.bus.publish(jobId, 'cancelled', { jobId });
      return { success: true, message: 'Queued crawl job cancelled' };
    }

    // If currently running, update metadata and signal
    if (job.status === 'running') {
      job.status = 'cancelled';
      await this.store.saveJob(job);
      this.bus.publish(jobId, 'cancelled', { jobId });
      return { success: true, message: 'Running crawl job cancellation initiated' };
    }

    return { success: true, message: `Job is already in terminal state: ${job.status}` };
  }

  /**
   * Recovers jobs that were active when the process terminated
   */
  async recoverOnStartup(): Promise<void> {
    const recovered = await this.store.recoverStaleJobs();
    for (const job of recovered) {
      if (job.status === 'queued') {
        this.queue.push(job.id);
      }
    }
    if (this.queue.length > 0) {
      setImmediate(() => this.processNext());
    }
  }

  /**
   * Retrieves overall queue metrics
   */
  async getMetrics(): Promise<JobQueueMetrics> {
    const allJobs = await this.store.listJobs('all', 1000);
    return {
      queued: this.queue.length,
      running: this.activeJobs.size,
      completed: allJobs.filter(j => j.status === 'completed').length,
      cancelled: allJobs.filter(j => j.status === 'cancelled').length,
      failed: allJobs.filter(j => j.status === 'failed').length,
      totalProcessed: this.totalProcessed
    };
  }

  private isTransientError(err: any): boolean {
    const msg = (err?.message || '').toLowerCase();
    return (
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('econnrefused') ||
      msg.includes('network') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504')
    );
  }
}

export const jobQueue = new DurableJobQueue();
