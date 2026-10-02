import { ScrapedEmailRecord } from '../types/record';
import { CrawlProgress } from '../scrapers/websiteCrawler';

export type JobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface CrawlJobParameters {
  url?: string;
  maxDepth?: number;
  maxPages?: number;
  sameDomainOnly?: boolean;
  timeout?: number;
  delayMs?: number;
  useBrowser?: boolean;
  userAgent?: string;
  headers?: Record<string, string>;
  respectRobotsTxt?: boolean;
  contactEmail?: string;
}

export interface CrawlJobMetadata {
  id: string;
  url: string;
  status: JobStatus;
  ownerId: string;
  params: CrawlJobParameters;
  records: ScrapedEmailRecord[];
  pagesVisited: number;
  pagesSkipped?: number;
  pagesFailed?: number;
  errors: number;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  cancelled: boolean;
  progress?: CrawlProgress;
  retryCount: number;
  maxRetries: number;
  errorMessage?: string;
  accessRestrictedReason?: string;
  isBrowser: boolean;
  expiresAt: number;
  updatedAt: number;
}

export interface StreamEvent {
  id: string;
  seq: number;
  event: string;
  data: any;
  timestamp: number;
}

export interface JobQueueMetrics {
  queued: number;
  running: number;
  completed: number;
  cancelled: number;
  failed: number;
  totalProcessed: number;
}

export interface IJobStore {
  saveJob(job: CrawlJobMetadata): Promise<void>;
  getJob(id: string): Promise<CrawlJobMetadata | null>;
  listJobs(ownerId?: string, limit?: number): Promise<CrawlJobMetadata[]>;
  updateJob(id: string, updates: Partial<CrawlJobMetadata>): Promise<CrawlJobMetadata | null>;
  deleteJob(id: string): Promise<boolean>;
  pruneExpiredJobs(retentionMs?: number): Promise<number>;
  recoverStaleJobs(): Promise<CrawlJobMetadata[]>;
}

export interface IEventBus {
  publish(jobId: string, event: string, data: any): StreamEvent;
  subscribe(jobId: string, listener: (event: StreamEvent) => void): () => void;
  getHistory(jobId: string, sinceSeq?: number): StreamEvent[];
  getLatestSeq(jobId: string): number;
  clearHistory(jobId: string): void;
}
