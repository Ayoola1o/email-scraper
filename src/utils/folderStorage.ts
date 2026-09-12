import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { ScrapedEmailRecord } from '../types/record';

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  records: ScrapedEmailRecord[];
}

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
const LOCAL_DATA_DIR = path.resolve(__dirname, '../../data');
const DATA_DIR = isServerless ? path.join('/tmp', 'email-scraper-data') : LOCAL_DATA_DIR;
const FOLDERS_FILE = path.join(DATA_DIR, 'folders.json');

// In-memory fallback in case of strict ephemeral storage constraints
let memoryFolders: Folder[] | null = null;

function ensureStorage(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(FOLDERS_FILE)) {
      // Check if we can seed from bundled local data
      const bundledFile = path.join(LOCAL_DATA_DIR, 'folders.json');
      if (fs.existsSync(bundledFile)) {
        const seedData = fs.readFileSync(bundledFile, 'utf-8');
        fs.writeFileSync(FOLDERS_FILE, seedData, 'utf-8');
        return;
      }

      // Initial sample folder
      const defaultFolders: Folder[] = [
        {
          id: 'default',
          name: 'General Leads',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          records: []
        }
      ];
      fs.writeFileSync(FOLDERS_FILE, JSON.stringify(defaultFolders, null, 2), 'utf-8');
    }
  } catch (err) {
    // If fs write fails on restricted environment, use memory storage
    if (!memoryFolders) {
      memoryFolders = [
        {
          id: 'default',
          name: 'General Leads',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          records: []
        }
      ];
    }
  }
}

function loadFolders(): Folder[] {
  ensureStorage();
  try {
    if (fs.existsSync(FOLDERS_FILE)) {
      const raw = fs.readFileSync(FOLDERS_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    // Fall through to memory
  }
  return memoryFolders || [];
}

function saveFolders(folders: Folder[]): void {
  ensureStorage();
  memoryFolders = folders;
  try {
    fs.writeFileSync(FOLDERS_FILE, JSON.stringify(folders, null, 2), 'utf-8');
  } catch {
    // Fallback to memory
  }
}

/**
 * Returns metadata about the folder storage driver (local file or ephemeral serverless)
 */
export function getStorageDriverInfo(): { storageType: 'local_json_file' | 'ephemeral_serverless'; filePath: string } {
  return {
    storageType: isServerless ? 'ephemeral_serverless' : 'local_json_file',
    filePath: FOLDERS_FILE
  };
}

/**
 * Returns all saved folders with record counts
 */
export function getAllFolders(): Array<Omit<Folder, 'records'> & { count: number }> {
  const folders = loadFolders();
  return folders.map(f => ({
    id: f.id,
    name: f.name,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    count: f.records ? f.records.length : 0
  }));
}

/**
 * Creates a new folder
 */
export function createFolder(name: string): Folder {
  const folders = loadFolders();
  const cleanName = (name || '').trim().slice(0, 100);
  if (!cleanName) {
    throw new Error('Folder name must be a non-empty string up to 100 characters');
  }
  const existing = folders.find(f => f.name.toLowerCase() === cleanName.toLowerCase());
  if (existing) {
    return existing;
  }

  const newFolder: Folder = {
    id: randomUUID(),
    name: cleanName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    records: []
  };

  folders.push(newFolder);
  saveFolders(folders);
  return newFolder;
}

/**
 * Saves/merges email records into a folder (capped at 10,000 records per folder)
 */
export function saveRecordsToFolder(folderId: string, newRecords: ScrapedEmailRecord[]): Folder | null {
  const folders = loadFolders();
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return null;

  const emailMap = new Map<string, ScrapedEmailRecord>();
  if (folder.records) {
    for (const r of folder.records) {
      emailMap.set(r.email.toLowerCase(), r);
    }
  }

  for (const r of newRecords) {
    if (r && r.email) {
      emailMap.set(r.email.toLowerCase(), r);
    }
  }

  const MAX_RECORDS_PER_FOLDER = 10000;
  folder.records = Array.from(emailMap.values()).slice(0, MAX_RECORDS_PER_FOLDER);
  folder.updatedAt = new Date().toISOString();
  saveFolders(folders);
  return folder;
}

/**
 * Retrieves records in a given folder
 */
export function getFolder(folderId: string): Folder | null {
  const folders = loadFolders();
  return folders.find(f => f.id === folderId) || null;
}

/**
 * Deletes a folder
 */
export function deleteFolder(folderId: string): boolean {
  const folders = loadFolders();
  const filtered = folders.filter(f => f.id !== folderId);
  if (filtered.length === folders.length) return false;
  saveFolders(filtered);
  return true;
}

/**
 * Removes a specific record from a folder
 */
export function removeRecordFromFolder(folderId: string, email: string): boolean {
  const folders = loadFolders();
  const folder = folders.find(f => f.id === folderId);
  if (!folder || !folder.records) return false;

  const prevLen = folder.records.length;
  folder.records = folder.records.filter(r => r.email.toLowerCase() !== email.toLowerCase());
  if (folder.records.length === prevLen) return false;

  folder.updatedAt = new Date().toISOString();
  saveFolders(folders);
  return true;
}
