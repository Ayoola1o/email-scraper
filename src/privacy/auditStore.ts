import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { ExportAuditLog } from './types';

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
const LOCAL_DATA_DIR = path.resolve(__dirname, '../../data');
const DATA_DIR = isServerless ? path.join('/tmp', 'email-scraper-data') : LOCAL_DATA_DIR;
const AUDIT_FILE = path.join(DATA_DIR, 'export_audit_logs.json');

/**
 * Manages immutable audit trails for data export operations
 */
export class AuditStore {
  private static instance: AuditStore;
  private logs: ExportAuditLog[] = [];
  private isLoaded = false;

  private constructor() {
    this.loadFromDisk();
  }

  public static getInstance(): AuditStore {
    if (!AuditStore.instance) {
      AuditStore.instance = new AuditStore();
    }
    return AuditStore.instance;
  }

  private ensureDir(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch {}
  }

  private loadFromDisk(): void {
    if (this.isLoaded) return;
    this.ensureDir();
    try {
      if (fs.existsSync(AUDIT_FILE)) {
        const raw = fs.readFileSync(AUDIT_FILE, 'utf-8');
        const list: ExportAuditLog[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          this.logs = list;
        }
      }
    } catch {}
    this.isLoaded = true;
  }

  private saveToDisk(): void {
    this.ensureDir();
    try {
      const tempFile = `${AUDIT_FILE}.${randomUUID()}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(this.logs, null, 2), 'utf-8');
      fs.renameSync(tempFile, AUDIT_FILE);
    } catch {}
  }

  /**
   * Records an immutable export event in the audit trail
   */
  public logExport(params: {
    userId: string;
    userRole: string;
    format: 'csv' | 'json' | 'txt' | 'vcf';
    recordCount: number;
    clientIp: string;
    exportedFields?: string[];
    exportSegment?: string;
    filename?: string;
    filterSuppressed?: boolean;
  }): ExportAuditLog {
    const entry: ExportAuditLog = {
      id: `exp_${randomUUID()}`,
      userId: params.userId || 'anonymous',
      userRole: params.userRole || 'unknown',
      timestamp: new Date().toISOString(),
      format: params.format,
      recordCount: params.recordCount,
      clientIp: params.clientIp,
      exportedFields: params.exportedFields,
      exportSegment: params.exportSegment,
      filename: params.filename,
      filterSuppressed: params.filterSuppressed
    };

    this.logs.unshift(entry); // newest first
    // Cap in-memory audit log to last 5,000 events
    if (this.logs.length > 5000) {
      this.logs = this.logs.slice(0, 5000);
    }

    this.saveToDisk();
    return entry;
  }

  /**
   * Retrieves audit logs scoped to the requesting user (or all if admin)
   */
  public listLogs(userId?: string, isAdmin = false, limit = 100): ExportAuditLog[] {
    let result = this.logs;
    if (!isAdmin && userId) {
      result = result.filter(l => l.userId === userId);
    }
    return result.slice(0, limit);
  }

  /**
   * Clears audit logs (for testing)
   */
  public clear(): void {
    this.logs = [];
    try {
      if (fs.existsSync(AUDIT_FILE)) {
        fs.unlinkSync(AUDIT_FILE);
      }
    } catch {}
  }
}

export const auditStore = AuditStore.getInstance();
