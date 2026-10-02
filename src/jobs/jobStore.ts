import fs from 'fs';
import path from 'path';
import { CrawlJobMetadata, IJobStore, JobStatus } from './types';

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
const LOCAL_DATA_DIR = path.resolve(__dirname, '../../data/jobs');
const DATA_DIR = isServerless ? path.join('/tmp', 'email-scraper-jobs') : LOCAL_DATA_DIR;

// Configurable retention period (default 24 hours)
const DEFAULT_RETENTION_MS = parseInt(process.env.JOB_RETENTION_HOURS || '24', 10) * 3600 * 1000;

/**
 * Production-ready Durable File-Backed Job Store
 * Implements atomic writes, memory-cache acceleration, crash recovery, and automated retention pruning.
 * Provides a clean IJobStore abstraction ready for PostgreSQL/Redis storage engines.
 */
export class FileJobStore implements IJobStore {
  private baseDir: string;
  private memoryCache: Map<string, CrawlJobMetadata> = new Map();
  private initialized = false;

  constructor(customDir?: string) {
    this.baseDir = customDir || DATA_DIR;
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (this.initialized) return;
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
      this.loadIndexIntoCache();
      this.initialized = true;
    } catch {
      // In restricted environments, fallback to in-memory caching
      this.initialized = true;
    }
  }

  private getJobFilePath(jobId: string): string {
    const safeId = jobId.replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(this.baseDir, `${safeId}.json`);
  }

  private loadIndexIntoCache(): void {
    try {
      if (!fs.existsSync(this.baseDir)) return;
      const files = fs.readdirSync(this.baseDir).filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.baseDir, file), 'utf8');
          const job: CrawlJobMetadata = JSON.parse(raw);
          if (job && job.id) {
            this.memoryCache.set(job.id, job);
          }
        } catch {
          // Skip corrupted individual files
        }
      }
    } catch {
      // Cache initialization fallback
    }
  }

  /**
   * Saves or overwrites job metadata atomically to disk and cache
   */
  async saveJob(job: CrawlJobMetadata): Promise<void> {
    this.ensureDirectory();
    job.updatedAt = Date.now();
    this.memoryCache.set(job.id, job);

    const filePath = this.getJobFilePath(job.id);
    const tmpPath = `${filePath}.tmp_${Date.now()}`;

    try {
      const data = JSON.stringify(job, null, 2);
      fs.writeFileSync(tmpPath, data, 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch {
      // Persist in memoryCache if filesystem write fails
    }
  }

  /**
   * Retrieves a job by ID from memory cache or persistent disk
   */
  async getJob(id: string): Promise<CrawlJobMetadata | null> {
    this.ensureDirectory();
    if (this.memoryCache.has(id)) {
      return this.memoryCache.get(id)!;
    }

    const filePath = this.getJobFilePath(id);
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const job: CrawlJobMetadata = JSON.parse(raw);
        this.memoryCache.set(job.id, job);
        return job;
      }
    } catch {
      // Return null on read/parse error
    }

    return null;
  }

  /**
   * Lists jobs filtered by ownerId and bounded by limit, sorted newest first
   */
  async listJobs(ownerId?: string, limit = 50): Promise<CrawlJobMetadata[]> {
    this.ensureDirectory();
    let jobs = Array.from(this.memoryCache.values());

    if (ownerId && ownerId !== 'all') {
      jobs = jobs.filter(j => j.ownerId === ownerId);
    }

    jobs.sort((a, b) => b.startedAt - a.startedAt);
    return jobs.slice(0, Math.min(100, limit));
  }

  /**
   * Updates an existing job with partial metadata and persists the update
   */
  async updateJob(id: string, updates: Partial<CrawlJobMetadata>): Promise<CrawlJobMetadata | null> {
    const existing = await this.getJob(id);
    if (!existing) return null;

    const updated: CrawlJobMetadata = {
      ...existing,
      ...updates,
      updatedAt: Date.now()
    };

    if (updates.status === 'completed' || updates.status === 'cancelled' || updates.status === 'failed') {
      if (!updated.endedAt) {
        updated.endedAt = Date.now();
      }
      updated.durationMs = updated.endedAt - updated.startedAt;
    }

    await this.saveJob(updated);
    return updated;
  }

  /**
   * Deletes a job from cache and disk
   */
  async deleteJob(id: string): Promise<boolean> {
    this.ensureDirectory();
    this.memoryCache.delete(id);
    const filePath = this.getJobFilePath(id);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
    } catch {
      // Return true if memory was deleted
    }

    return true;
  }

  /**
   * Prunes jobs older than the retention threshold
   */
  async pruneExpiredJobs(retentionMs = DEFAULT_RETENTION_MS): Promise<number> {
    this.ensureDirectory();
    const now = Date.now();
    let prunedCount = 0;

    for (const [id, job] of this.memoryCache.entries()) {
      const isTerminal = job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed';
      const age = now - (job.endedAt || job.startedAt);

      if (isTerminal && age > retentionMs) {
        await this.deleteJob(id);
        prunedCount++;
      }
    }

    return prunedCount;
  }

  /**
   * Recovers jobs left in 'running' or 'queued' state across process/server restarts
   */
  async recoverStaleJobs(): Promise<CrawlJobMetadata[]> {
    this.ensureDirectory();
    const recovered: CrawlJobMetadata[] = [];

    for (const job of this.memoryCache.values()) {
      if (job.status === 'running' || job.status === 'queued') {
        const canRetry = job.retryCount < job.maxRetries;
        const newStatus: JobStatus = canRetry ? 'queued' : 'failed';
        const errorMsg = canRetry
          ? 'Recovered after server restart; scheduled for retry'
          : 'Server restarted while job was in-flight; maximum retries exceeded';

        const updated = await this.updateJob(job.id, {
          status: newStatus,
          errorMessage: errorMsg,
          retryCount: canRetry ? job.retryCount + 1 : job.retryCount,
          endedAt: canRetry ? undefined : Date.now()
        });

        if (updated) {
          recovered.push(updated);
        }
      }
    }

    return recovered;
  }
}

// Singleton persistent job store instance
export const jobStore: IJobStore = new FileJobStore();
