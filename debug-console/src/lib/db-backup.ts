import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { promises as fs } from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { logger } from './logger';

const BUCKET_NAME = process.env.L1_TRANSCRIPTS_S3_BUCKET || 'airo-builder-l1-transcripts-dev';
const BACKUP_PREFIX = 'backups'; // All databases go under backups/ folder

interface SyncOptions {
  dbPath: string;
  dbName: string;
  forceUpload?: boolean;
  forceDownload?: boolean;
}

function getS3Client(): S3Client {
  // Use default AWS SDK credential chain (env vars, IAM role, etc.)
  return new S3Client({
    region: process.env.AWS_REGION || 'us-west-2',
  });
}

function getS3Key(dbName: string): string {
  // All support-plane databases grouped under backups/support-plane/
  // Timestamped files: backups/support-plane/l1_transcripts/2026-06-17T04-33-25-764Z.db
  const folder = dbName.replace('.db', '');
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
  return `${BACKUP_PREFIX}/support-plane/${folder}/${timestamp}.db`;
}

/**
 * Find the latest timestamped backup in S3 for a given database
 */
async function findLatestBackup(dbName: string): Promise<{ key: string; lastModified: Date } | null> {
  const s3Client = getS3Client();
  const folder = dbName.replace('.db', '');
  const prefix = `${BACKUP_PREFIX}/support-plane/${folder}/`;

  try {
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      MaxKeys: 1000,
    });
    const response = await s3Client.send(listCommand);

    if (!response.Contents || response.Contents.length === 0) {
      return null;
    }

    // Sort by LastModified descending
    const sorted = response.Contents
      .filter(obj => obj.Key && obj.LastModified && obj.Key.endsWith('.db'))
      .sort((a, b) => b.LastModified!.getTime() - a.LastModified!.getTime());

    if (sorted.length === 0) {
      return null;
    }

    return {
      key: sorted[0].Key!,
      lastModified: sorted[0].LastModified!,
    };
  } catch (err) {
    logger.error('db.backup.find_latest.failed', {
      dbName,
      prefix,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Download database from S3 backup if it doesn't exist locally or is older than S3.
 */
export async function downloadDbFromS3(options: SyncOptions): Promise<boolean> {
  const { dbPath, dbName, forceDownload } = options;
  const s3Client = getS3Client();

  try {
    // Find latest timestamped backup
    const latestBackup = await findLatestBackup(dbName);

    if (!latestBackup) {
      logger.info('db.backup.download.not_found', {
        dbName,
        message: 'No S3 backup exists yet',
      });
      return false;
    }

    const { key: s3Key, lastModified: s3LastModified } = latestBackup;

    // Check local file
    let shouldDownload = forceDownload || false;
    try {
      const localStat = await fs.stat(dbPath);
      const localMtime = localStat.mtime;
      const localSize = localStat.size;

      // Download if local file is suspiciously small (empty or just SQLite header)
      // SQLite header is 100 bytes, real databases are typically >20KB
      if (localSize < 4096) {
        logger.info('db.backup.download.local_too_small', {
          dbName,
          s3Key,
          localSize,
          message: 'Local file is too small, downloading from S3',
        });
        shouldDownload = true;
      }
      // Download if S3 is newer
      else if (s3LastModified > localMtime) {
        logger.info('db.backup.download.s3_newer', {
          dbName,
          s3Key,
          s3LastModified: s3LastModified.toISOString(),
          localMtime: localMtime.toISOString(),
        });
        shouldDownload = true;
      } else {
        logger.info('db.backup.download.local_up_to_date', {
          dbName,
          s3Key,
        });
        return false;
      }
    } catch (err) {
      // Local file doesn't exist
      logger.info('db.backup.download.local_missing', {
        dbName,
        s3Key,
      });
      shouldDownload = true;
    }

    if (shouldDownload) {
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      });
      const response = await s3Client.send(getCommand);

      if (!response.Body) {
        logger.error('db.backup.download.empty_response', {
          dbName,
          s3Key,
        });
        return false;
      }

      // Ensure directory exists
      await fs.mkdir(path.dirname(dbPath), { recursive: true });

      // Stream S3 object to local file
      const writeStream = createWriteStream(dbPath);
      // @ts-expect-error - Body is a readable stream
      await pipeline(response.Body, writeStream);

      logger.info('db.backup.download.success', {
        dbName,
        s3Key,
        localPath: dbPath,
      });
      return true;
    }

    return false;
  } catch (err) {
    logger.error('db.backup.download.failed', {
      dbName,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Upload database to S3 backup.
 */
export async function uploadDbToS3(options: SyncOptions): Promise<boolean> {
  const { dbPath, dbName, forceUpload } = options;
  const s3Client = getS3Client();
  const s3Key = getS3Key(dbName);

  try {
    // Check if local file exists
    const localStat = await fs.stat(dbPath);
    if (!localStat.isFile()) {
      logger.error('db.backup.upload.not_a_file', {
        dbName,
        dbPath,
      });
      return false;
    }

    // Check if we should upload (skip if S3 is newer unless forced)
    if (!forceUpload) {
      try {
        const headCommand = new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: s3Key,
        });
        const headResponse = await s3Client.send(headCommand);
        const s3LastModified = headResponse.LastModified;

        if (s3LastModified && s3LastModified > localStat.mtime) {
          logger.warn('db.backup.upload.s3_newer', {
            dbName,
            s3LastModified: s3LastModified.toISOString(),
            localMtime: localStat.mtime.toISOString(),
            message: 'Skipping upload - S3 version is newer',
          });
          return false;
        }
      } catch (err) {
        // S3 object doesn't exist, proceed with upload
        if (err && typeof err === 'object' && 'name' in err && err.name !== 'NotFound') {
          logger.warn('db.backup.upload.s3_head_failed', {
            dbName,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Upload file to S3
    const fileStream = createReadStream(dbPath);
    const putCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileStream,
      ContentType: 'application/x-sqlite3',
      Metadata: {
        'db-name': dbName,
        'uploaded-at': new Date().toISOString(),
      },
    });

    await s3Client.send(putCommand);

    logger.info('db.backup.upload.success', {
      dbName,
      s3Key,
      localPath: dbPath,
      size: localStat.size,
    });
    return true;
  } catch (err) {
    logger.error('db.backup.upload.failed', {
      dbName,
      s3Key,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Sync database with S3: download if S3 is newer, upload after local changes.
 * Call this on app start and after writes.
 */
export async function syncDb(dbPath: string, dbName: string): Promise<void> {
  // Download on start (if S3 is newer or local missing)
  await downloadDbFromS3({ dbPath, dbName });
}

/**
 * Upload database after writes (debounced to avoid excessive S3 calls).
 */
const uploadTimers = new Map<string, NodeJS.Timeout>();
const UPLOAD_DEBOUNCE_MS = 30_000; // 30 seconds

export function scheduleUpload(dbPath: string, dbName: string): void {
  const existing = uploadTimers.get(dbName);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    uploadTimers.delete(dbName);
    uploadDbToS3({ dbPath, dbName }).catch((err) => {
      logger.error('db.backup.scheduled_upload.failed', {
        dbName,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, UPLOAD_DEBOUNCE_MS);

  uploadTimers.set(dbName, timer);
}
