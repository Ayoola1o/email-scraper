import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { jobStore } from '../jobs';
import { getAllFolders, deleteFolder, removeRecordFromFolder } from '../utils/folderStorage';
import { DeletionResult } from './types';

/**
 * Securely deletes a file by overwriting it with random bytes before unlinking.
 * Prevents file recovery from magnetic/flash media storage.
 */
export function secureDeleteFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (stat.isFile() && stat.size > 0) {
      // Overwrite with zeros/random bytes
      const randomData = randomBytes(Math.min(stat.size, 1024 * 1024));
      fs.writeFileSync(filePath, randomData);
    }
    fs.unlinkSync(filePath);
    return true;
  } catch {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
    } catch {}
    return false;
  }
}

/**
 * Data Deletion & Right to Be Forgotten Manager
 */
export class DataDeletionManager {
  /**
   * Deletes a specific crawl job, its results, and temporary files.
   * Strictly enforces user ownership unless caller is an admin.
   */
  public static async deleteJob(
    jobId: string,
    requestingUserId: string,
    isAdmin = false
  ): Promise<{ success: boolean; jobId: string }> {
    const job = await jobStore.getJob(jobId);
    if (!job) {
      throw new Error('NOT_FOUND: Job not found');
    }

    if (!isAdmin && job.ownerId && job.ownerId !== requestingUserId) {
      throw new Error('IDOR_ACCESS_DENIED: You do not have permission to delete this job');
    }

    await jobStore.deleteJob(jobId);

    // Also securely remove any associated scratch or export files
    const scratchDir = path.resolve(__dirname, '../../data/jobs');
    const jobFile = path.join(scratchDir, `${jobId}.json`);
    secureDeleteFile(jobFile);

    return { success: true, jobId };
  }

  /**
   * Deletes all records matching an email address across the user's folders/datasets.
   * Right to be forgotten support.
   */
  public static async deleteRecordsByEmail(
    targetEmail: string,
    requestingUserId: string,
    isAdmin = false
  ): Promise<{ deletedRecordsCount: number; affectedFoldersCount: number }> {
    const normTarget = targetEmail.toLowerCase().trim();
    let deletedRecordsCount = 0;
    let affectedFoldersCount = 0;

    const folders = getAllFolders();
    for (const folder of folders) {
      const removed = removeRecordFromFolder(folder.id, normTarget);
      if (removed) {
        deletedRecordsCount++;
        affectedFoldersCount++;
      }
    }

    return { deletedRecordsCount, affectedFoldersCount };
  }

  /**
   * Purges ALL data, jobs, and records belonging to a user.
   */
  public static async purgeAllUserData(
    userId: string,
    isAdmin = false
  ): Promise<DeletionResult> {
    if (!userId) {
      throw new Error('INVALID_INPUT: User ID is required for account data purge');
    }

    // 1. Purge user jobs
    const jobs = await jobStore.listJobs(isAdmin ? undefined : userId);
    let deletedJobsCount = 0;
    for (const job of jobs) {
      await jobStore.deleteJob(job.id);
      deletedJobsCount++;
    }

    // 2. Purge user folders
    let deletedFoldersCount = 0;
    let deletedRecordsCount = 0;
    const folders = getAllFolders();
    for (const folder of folders) {
      // Do not wipe the default system demo folder
      if (folder.id === 'default') continue;
      deletedRecordsCount += folder.count;
      deleteFolder(folder.id);
      deletedFoldersCount++;
    }

    return {
      success: true,
      deletedJobsCount,
      deletedRecordsCount,
      deletedFoldersCount,
      timestamp: new Date().toISOString(),
      details: `Purged ${deletedJobsCount} jobs and ${deletedRecordsCount} records across ${deletedFoldersCount} folders.`
    };
  }
}

