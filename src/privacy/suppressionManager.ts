import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import {
  SuppressionEntry,
  SuppressionType,
  SuppressionReason,
  SuppressionCheckResult
} from './types';

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
const LOCAL_DATA_DIR = path.resolve(__dirname, '../../data');
const DATA_DIR = isServerless ? path.join('/tmp', 'email-scraper-data') : LOCAL_DATA_DIR;
const SUPPRESSION_FILE = path.join(DATA_DIR, 'suppression.json');

/**
 * Computes SHA-256 hash of a normalized email
 */
export function hashSha256(val: string): string {
  return createHash('sha256').update(val.toLowerCase().trim()).digest('hex');
}

/**
 * Computes MD5 hash of a normalized email
 */
export function hashMd5(val: string): string {
  return createHash('md5').update(val.toLowerCase().trim()).digest('hex');
}

/**
 * High-performance Suppression List Manager
 */
export class SuppressionManager {
  private static instance: SuppressionManager;
  private entries: Map<string, SuppressionEntry> = new Map();
  // Fast lookup indexes
  private emailIndex: Map<string, SuppressionEntry> = new Map();
  private domainIndex: Map<string, SuppressionEntry> = new Map();
  private hashIndex: Map<string, SuppressionEntry> = new Map();
  private isLoaded = false;

  private constructor() {
    this.loadFromDisk();
  }

  public static getInstance(): SuppressionManager {
    if (!SuppressionManager.instance) {
      SuppressionManager.instance = new SuppressionManager();
    }
    return SuppressionManager.instance;
  }

  private ensureDir(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch {
      // Ephemeral fallback
    }
  }

  private loadFromDisk(): void {
    if (this.isLoaded) return;
    this.ensureDir();

    try {
      if (fs.existsSync(SUPPRESSION_FILE)) {
        const raw = fs.readFileSync(SUPPRESSION_FILE, 'utf-8');
        const list: SuppressionEntry[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const entry of list) {
            this.indexEntry(entry);
          }
        }
      }
    } catch (err: any) {
      // In-memory fallback
    }
    this.isLoaded = true;
  }

  private saveToDisk(): void {
    this.ensureDir();
    try {
      const list = Array.from(this.entries.values());
      const tempFile = `${SUPPRESSION_FILE}.${randomUUID()}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(list, null, 2), 'utf-8');
      fs.renameSync(tempFile, SUPPRESSION_FILE);
    } catch (err: any) {
      // Continue in memory
    }
  }

  private indexEntry(entry: SuppressionEntry): void {
    this.entries.set(entry.id, entry);
    const normVal = entry.value.toLowerCase().trim();

    if (entry.type === 'email') {
      this.emailIndex.set(normVal, entry);
    } else if (entry.type === 'domain') {
      const cleanDomain = normVal.startsWith('@') ? normVal.slice(1) : normVal;
      this.domainIndex.set(cleanDomain, entry);
    } else if (entry.type === 'sha256' || entry.type === 'md5') {
      this.hashIndex.set(normVal, entry);
    }
  }

  /**
   * Adds an entry to the suppression list
   */
  public addEntry(
    type: SuppressionType,
    rawVal: string,
    reason: SuppressionReason = 'UNSUBSCRIBE',
    addedByUserId?: string,
    note?: string
  ): SuppressionEntry {
    let cleanVal = rawVal.toLowerCase().trim();
    if (type === 'domain' && cleanVal.startsWith('@')) {
      cleanVal = cleanVal.slice(1);
    }

    // Check if an identical entry already exists
    for (const existing of this.entries.values()) {
      if (existing.type === type && existing.value.toLowerCase().trim() === cleanVal) {
        return existing;
      }
    }

    const entry: SuppressionEntry = {
      id: randomUUID(),
      type,
      value: cleanVal,
      reason,
      addedByUserId,
      createdAt: new Date().toISOString(),
      note
    };

    this.indexEntry(entry);
    this.saveToDisk();
    return entry;
  }

  /**
   * Adds multiple entries in batch (e.g. from an opt-out CSV or hashed list)
   */
  public addBulkEntries(
    items: Array<{ type: SuppressionType; value: string; reason?: SuppressionReason; note?: string }>,
    addedByUserId?: string
  ): { added: number; existing: number } {
    let added = 0;
    let existing = 0;

    for (const item of items) {
      const reason = item.reason || 'UNSUBSCRIBE';
      const cleanVal = item.value.toLowerCase().trim();
      let alreadyExists = false;

      if (item.type === 'email' && this.emailIndex.has(cleanVal)) {
        alreadyExists = true;
      } else if (item.type === 'domain') {
        const d = cleanVal.startsWith('@') ? cleanVal.slice(1) : cleanVal;
        if (this.domainIndex.has(d)) alreadyExists = true;
      } else if ((item.type === 'sha256' || item.type === 'md5') && this.hashIndex.has(cleanVal)) {
        alreadyExists = true;
      }

      if (alreadyExists) {
        existing++;
      } else {
        this.addEntry(item.type, item.value, reason, addedByUserId, item.note);
        added++;
      }
    }

    return { added, existing };
  }

  /**
   * Checks whether a specific email is suppressed across email, domain, and hash rules
   */
  public checkEmail(email: string): SuppressionCheckResult {
    if (!email || typeof email !== 'string') {
      return { isSuppressed: false };
    }

    const normEmail = email.toLowerCase().trim();
    const parts = normEmail.split('@');
    const domain = parts[1] || '';

    // 1. Direct Email Match
    const emailMatch = this.emailIndex.get(normEmail);
    if (emailMatch) {
      return {
        isSuppressed: true,
        reason: emailMatch.reason,
        matchedType: 'email',
        matchedValue: emailMatch.value
      };
    }

    // 2. Domain Match (e.g., competitor.com)
    if (domain) {
      const domainMatch = this.domainIndex.get(domain);
      if (domainMatch) {
        return {
          isSuppressed: true,
          reason: domainMatch.reason,
          matchedType: 'domain',
          matchedValue: domainMatch.value
        };
      }
    }

    // 3. SHA-256 Hash Match
    const sha = hashSha256(normEmail);
    const shaMatch = this.hashIndex.get(sha);
    if (shaMatch) {
      return {
        isSuppressed: true,
        reason: shaMatch.reason,
        matchedType: 'sha256',
        matchedValue: sha
      };
    }

    // 4. MD5 Hash Match
    const md5 = hashMd5(normEmail);
    const md5Match = this.hashIndex.get(md5);
    if (md5Match) {
      return {
        isSuppressed: true,
        reason: md5Match.reason,
        matchedType: 'md5',
        matchedValue: md5
      };
    }

    return { isSuppressed: false };
  }

  /**
   * Removes an entry from the suppression list by ID
   */
  public removeEntry(id: string, userId?: string, isAdmin = false): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    // Enforce user-scoped access control
    if (!isAdmin && userId && entry.addedByUserId && entry.addedByUserId !== userId) {
      throw new Error('IDOR_ACCESS_DENIED: You do not have permission to remove this suppression entry');
    }

    this.entries.delete(id);
    const normVal = entry.value.toLowerCase().trim();

    if (entry.type === 'email') {
      this.emailIndex.delete(normVal);
    } else if (entry.type === 'domain') {
      const cleanDomain = normVal.startsWith('@') ? normVal.slice(1) : normVal;
      this.domainIndex.delete(cleanDomain);
    } else if (entry.type === 'sha256' || entry.type === 'md5') {
      this.hashIndex.delete(normVal);
    }

    this.saveToDisk();
    return true;
  }

  /**
   * Lists suppression entries, optionally filtered by user
   */
  public listEntries(userId?: string, isAdmin = false): SuppressionEntry[] {
    const all = Array.from(this.entries.values());
    if (isAdmin || !userId) {
      return all;
    }
    // Return user-owned entries + global (system) entries
    return all.filter(e => !e.addedByUserId || e.addedByUserId === userId);
  }

  /**
   * Resets / clears all entries (primarily for testing)
   */
  public clear(): void {
    this.entries.clear();
    this.emailIndex.clear();
    this.domainIndex.clear();
    this.hashIndex.clear();
    try {
      if (fs.existsSync(SUPPRESSION_FILE)) {
        fs.unlinkSync(SUPPRESSION_FILE);
      }
    } catch {}
  }
}

export const suppressionManager = SuppressionManager.getInstance();
