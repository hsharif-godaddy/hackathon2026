/**
 * l1-transcript-backup.ts
 * S3 backup and restore for L1 transcripts database
 */

import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { generateBackupS3Key } from './l1-transcript-utils';
import { logger } from './logger';

const L1_TRANSCRIPTS_S3_REGION = process.env.L1_TRANSCRIPTS_S3_REGION || 'us-west-2';

const s3Client = new S3Client({ region: L1_TRANSCRIPTS_S3_REGION });

const BUCKET_NAME = process.env.L1_TRANSCRIPTS_S3_BUCKET || 'airo-builder-l1-transcripts-dev';

/**
 * Backup database to S3
 */
export async function backupToS3(
  dbPath: string,
  type: 'pre' | 'post' | 'daily' | 'manual',
  uploadId?: string
): Promise<{ key: string; size: number }> {
  try {
    // Read database file
    const dbBuffer = readFileSync(dbPath);

    // Generate S3 key
    const s3Key = generateBackupS3Key(type, uploadId);

    // Upload to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: dbBuffer,
        ContentType: 'application/x-sqlite3',
        Metadata: {
          backup_type: type,
          upload_id: uploadId || '',
          timestamp: new Date().toISOString(),
        },
      })
    );

    logger.info('supportplane.l1_transcript.backup.done', {
      bucket: BUCKET_NAME,
      s3Key,
      size: dbBuffer.length,
    });

    return {
      key: s3Key,
      size: dbBuffer.length,
    };
  } catch (error) {
    logger.error('supportplane.l1_transcript.backup.failed', { type, uploadId }, { error: error as Error });
    throw new Error(`Failed to backup database to S3: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

/**
 * Restore database from S3
 */
export async function restoreFromS3(s3Key: string, dbPath: string): Promise<void> {
  try {
    // Download from S3
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      })
    );

    if (!response.Body) {
      throw new Error('Empty response body from S3');
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Write to local file
    writeFileSync(dbPath, buffer);

    logger.info('supportplane.l1_transcript.restore.done', {
      dbPath,
      bucket: BUCKET_NAME,
      s3Key,
    });
  } catch (error) {
    logger.error('supportplane.l1_transcript.restore.failed', { s3Key }, { error: error as Error });
    throw new Error(`Failed to restore database from S3: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

/**
 * Check if backup exists in S3
 */
export async function backupExists(s3Key: string): Promise<boolean> {
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      })
    );
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Upload file to S3
 */
export async function uploadFileToS3(
  buffer: Buffer,
  s3Key: string,
  contentType: string = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
): Promise<{ key: string; size: number }> {
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: buffer,
        ContentType: contentType,
        Metadata: {
          uploaded_at: new Date().toISOString(),
        },
      })
    );

    logger.info('supportplane.l1_transcript.upload.done', {
      bucket: BUCKET_NAME,
      s3Key,
      size: buffer.length,
    });

    return {
      key: s3Key,
      size: buffer.length,
    };
  } catch (error) {
    logger.error('supportplane.l1_transcript.upload.failed', { s3Key }, { error: error as Error });
    throw new Error(`Failed to upload file to S3: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

/**
 * Find latest backup in S3
 */
export async function findLatestBackup(): Promise<string | null> {
  try {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: 'backups/',
        MaxKeys: 1000,
      })
    );

    if (!response.Contents || response.Contents.length === 0) {
      logger.info('supportplane.l1_transcript.backup.none_found', {});
      return null;
    }

    // Sort by LastModified descending, prefer post-upload backups
    const sortedBackups = response.Contents
      .filter(obj => obj.Key && obj.LastModified)
      .sort((a, b) => {
        const timeA = a.LastModified!.getTime();
        const timeB = b.LastModified!.getTime();
        if (timeB !== timeA) return timeB - timeA;
        // If same time, prefer 'post' over 'pre'
        const isPostA = a.Key!.includes('-post-');
        const isPostB = b.Key!.includes('-post-');
        if (isPostA && !isPostB) return -1;
        if (!isPostA && isPostB) return 1;
        return 0;
      });

    const latestKey = sortedBackups[0].Key!;
    logger.info('supportplane.l1_transcript.backup.latest_found', {
      s3Key: latestKey,
      lastModified: sortedBackups[0].LastModified!.toISOString(),
    });
    return latestKey;
  } catch (error) {
    logger.error('supportplane.l1_transcript.backup.list_failed', {}, { error: error as Error });
    return null;
  }
}

/**
 * Auto-restore from S3 if local DB doesn't exist
 */
export async function autoRestoreIfNeeded(dbPath: string): Promise<boolean> {
  try {
    // Check if local DB exists
    if (existsSync(dbPath)) {
      logger.info('supportplane.l1_transcript.auto_restore.skip', { dbPath });
      return false;
    }

    logger.info('supportplane.l1_transcript.auto_restore.search', { dbPath });

    // Find latest backup
    const latestBackupKey = await findLatestBackup();
    if (!latestBackupKey) {
      logger.info('supportplane.l1_transcript.auto_restore.none_found', {});
      return false;
    }

    logger.info('supportplane.l1_transcript.auto_restore.start', {
      bucket: BUCKET_NAME,
      s3Key: latestBackupKey,
    });

    // Restore from S3
    await restoreFromS3(latestBackupKey, dbPath);

    logger.info('supportplane.l1_transcript.auto_restore.done', { dbPath });
    return true;
  } catch (error) {
    logger.error('supportplane.l1_transcript.auto_restore.failed', {}, { error: error as Error });
    logger.info('supportplane.l1_transcript.auto_restore.fallback_new_db', {});
    return false;
  }
}
