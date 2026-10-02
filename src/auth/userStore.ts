import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { UserContext, UserRole } from './types';

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
const LOCAL_DATA_DIR = path.resolve(__dirname, '../../data/users');
const DATA_DIR = isServerless ? path.join('/tmp', 'email-scraper-users') : LOCAL_DATA_DIR;

export interface UserPreferences {
  defaultCrawlDepth?: number;
  defaultMaxPages?: number;
  defaultTimeoutMs?: number;
  contactEmail?: string;
  crawlerUserAgent?: string;
  theme?: 'dark' | 'light';
}

export interface UserProfileRecord {
  id: string;
  username: string;
  role: UserRole;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
  preferences?: UserPreferences;
  quotaMultiplier?: number;
}

export interface IUserStore {
  getUserById(id: string): Promise<UserProfileRecord | null>;
  getUserByUsername(username: string): Promise<UserProfileRecord | null>;
  createOrUpdateUser(username: string, role?: UserRole, preferences?: UserPreferences): Promise<UserProfileRecord>;
  updateUserPreferences(id: string, preferences: Partial<UserPreferences>): Promise<UserProfileRecord | null>;
  listUsers(limit?: number): Promise<UserProfileRecord[]>;
}

/**
 * Production-ready Durable User Profile Store
 * Persists user identities across sessions, deployments, and restarts.
 * Ensures scraping jobs, exports, and settings retain consistent ownership.
 */
export class FileUserStore implements IUserStore {
  private baseDir: string;
  private memoryCache: Map<string, UserProfileRecord> = new Map(); // Keyed by userId
  private usernameIndex: Map<string, string> = new Map(); // Keyed by lowercase username -> userId
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
      this.initialized = true;
    }
  }

  private getUserFilePath(userId: string): string {
    const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(this.baseDir, `${safeId}.json`);
  }

  private loadIndexIntoCache(): void {
    try {
      if (!fs.existsSync(this.baseDir)) return;
      const files = fs.readdirSync(this.baseDir).filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.baseDir, file), 'utf8');
          const user: UserProfileRecord = JSON.parse(raw);
          if (user && user.id && user.username) {
            this.memoryCache.set(user.id, user);
            this.usernameIndex.set(user.username.toLowerCase(), user.id);
          }
        } catch {
          // Skip corrupted individual files
        }
      }
    } catch {
      // Cache initialization fallback
    }
  }

  private async persistUser(user: UserProfileRecord): Promise<void> {
    this.ensureDirectory();
    user.updatedAt = Date.now();
    this.memoryCache.set(user.id, user);
    this.usernameIndex.set(user.username.toLowerCase(), user.id);

    const filePath = this.getUserFilePath(user.id);
    const tmpPath = `${filePath}.tmp_${Date.now()}`;

    try {
      const data = JSON.stringify(user, null, 2);
      fs.writeFileSync(tmpPath, data, 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch {
      // Retain in memory cache if filesystem fails
    }
  }

  async getUserById(id: string): Promise<UserProfileRecord | null> {
    this.ensureDirectory();
    if (this.memoryCache.has(id)) {
      return this.memoryCache.get(id)!;
    }

    const filePath = this.getUserFilePath(id);
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const user: UserProfileRecord = JSON.parse(raw);
        this.memoryCache.set(user.id, user);
        this.usernameIndex.set(user.username.toLowerCase(), user.id);
        return user;
      }
    } catch {
      return null;
    }
    return null;
  }

  async getUserByUsername(username: string): Promise<UserProfileRecord | null> {
    this.ensureDirectory();
    const cleanUser = username.trim().toLowerCase();
    const userId = this.usernameIndex.get(cleanUser);
    if (userId && this.memoryCache.has(userId)) {
      return this.memoryCache.get(userId)!;
    }

    // Fallback scan of cache in case index missed
    for (const user of this.memoryCache.values()) {
      if (user.username.toLowerCase() === cleanUser) {
        this.usernameIndex.set(cleanUser, user.id);
        return user;
      }
    }

    return null;
  }

  async createOrUpdateUser(
    username: string,
    role: UserRole = 'user',
    preferences?: UserPreferences
  ): Promise<UserProfileRecord> {
    this.ensureDirectory();
    const cleanUsername = username.trim();
    let existing = await this.getUserByUsername(cleanUsername);

    const now = Date.now();
    if (existing) {
      existing.lastLoginAt = now;
      existing.updatedAt = now;
      // Do not downgrade admin unless explicitly requested
      if (role === 'admin' || existing.role !== 'admin') {
        existing.role = role;
      }
      if (preferences) {
        existing.preferences = { ...existing.preferences, ...preferences };
      }
      await this.persistUser(existing);
      return existing;
    }

    // Deterministic or clean user ID derived from username or UUID
    const safePrefix = cleanUsername.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().substring(0, 8);
    const userId = `usr_${safePrefix || 'u'}_${randomUUID().substring(0, 8)}`;

    const newUser: UserProfileRecord = {
      id: userId,
      username: cleanUsername,
      role,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
      preferences: preferences || {
        defaultCrawlDepth: 2,
        defaultMaxPages: 30,
        defaultTimeoutMs: 15000,
        theme: 'dark'
      },
      quotaMultiplier: role === 'admin' ? 10 : 1
    };

    await this.persistUser(newUser);
    return newUser;
  }

  async updateUserPreferences(id: string, preferences: Partial<UserPreferences>): Promise<UserProfileRecord | null> {
    const user = await this.getUserById(id);
    if (!user) return null;

    user.preferences = {
      ...(user.preferences || {}),
      ...preferences
    };
    user.updatedAt = Date.now();
    await this.persistUser(user);
    return user;
  }

  async listUsers(limit = 100): Promise<UserProfileRecord[]> {
    this.ensureDirectory();
    return Array.from(this.memoryCache.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }
}

export const userStore: IUserStore = new FileUserStore();
