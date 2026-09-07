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

const DATA_DIR = path.resolve(__dirname, '../../data');
const FOLDERS_FILE = path.join(DATA_DIR, 'folders.json');

function ensureStorage(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(FOLDERS_FILE)) {
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
}

function loadFolders(): Folder[] {
  ensureStorage();
  try {
    const raw = fs.readFileSync(FOLDERS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveFolders(folders: Folder[]): void {
  ensureStorage();
  fs.writeFileSync(FOLDERS_FILE, JSON.stringify(folders, null, 2), 'utf-8');
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
  const cleanName = name.trim();
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
 * Saves/merges email records into a folder
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
    emailMap.set(r.email.toLowerCase(), r);
  }

  folder.records = Array.from(emailMap.values());
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
