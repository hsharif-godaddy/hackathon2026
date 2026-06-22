/**
 * /api/supportplane/transcripts/sync-sharepoint
 * Sync L1 transcripts from SharePoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

import { withAuth } from '@/lib/api-auth';
import { uploadFileToS3 } from '@/lib/l1-transcript-backup';
import {
  bulkInsertTranscripts,
  checkDuplicateUpload,
  createUploadRecord,
  getExistingInteractionIds,
  updateUploadRecord,
} from '@/lib/l1-transcript-db';
import { parseXlsxFile, processAllRows } from '@/lib/l1-transcript-ingestion';
import {
  downloadFile,
  getDriveId,
  getSharePointAccessToken,
  getSharePointConfig,
  getSiteId,
  listFilesInFolder,
} from '@/lib/l1-transcript-sharepoint';
import { generateUploadS3Key } from '@/lib/l1-transcript-utils';
import { logger } from '@/lib/logger';

async function handler(request: NextRequest) {
  try {
    if (request.method !== 'POST') {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const config = getSharePointConfig();
    if (!config) {
      return NextResponse.json(
        {
          error: 'SharePoint not configured',
          message: 'Set SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, and SHAREPOINT_CLIENT_SECRET.',
        },
        { status: 503 }
      );
    }

    logger.info('sharepoint.sync.started');

    // Get SharePoint access
    const accessToken = await getSharePointAccessToken(config);
    const siteId = await getSiteId(accessToken, config.siteHostname, config.sitePath);
    const driveId = await getDriveId(accessToken, siteId);

    // List files
    const files = await listFilesInFolder(accessToken, siteId, driveId, config.folderPath);

    if (files.length === 0) {
      logger.info('sharepoint.sync.no_files');
      return NextResponse.json({
        success: true,
        message: 'No xlsx files found in SharePoint folder',
        files_processed: 0,
        files_skipped: 0,
      });
    }

    // Sort by last modified (newest first)
    files.sort(
      (a, b) =>
        new Date(b.lastModifiedDateTime).getTime() - new Date(a.lastModifiedDateTime).getTime()
    );

    let filesProcessed = 0;
    let filesSkipped = 0;
    let totalNewRows = 0;
    const errors: Array<{ file: string; error: string }> = [];

    // Process each file
    for (const file of files) {
      try {
        logger.info('sharepoint.sync.processing_file', {
          file_name: file.name,
          file_size: file.size,
          last_modified: file.lastModifiedDateTime,
        });

        // Download file
        const fileBuffer = await downloadFile(file.downloadUrl);

        // Calculate file hash
        const fileHash = createHash('sha256').update(fileBuffer).digest('hex');

        // Check if already processed
        const existingUpload = (await checkDuplicateUpload(fileHash)) as
          | { upload_id?: string; status?: string }
          | null;

        if (existingUpload?.status === 'completed') {
          logger.info('sharepoint.sync.file_already_processed', {
            file_name: file.name,
            file_hash: fileHash,
            upload_id: existingUpload.upload_id,
          });
          filesSkipped++;
          continue;
        }

        const uploadId = `sharepoint-${file.id}-${Date.now()}`;

        // PRE-UPLOAD BACKUP removed - using automatic timestamped backups instead

        const s3Key = generateUploadS3Key(uploadId, file.name);
        await uploadFileToS3(fileBuffer, s3Key);

        // Parse xlsx - will automatically handle encryption
        let rows;
        try {
          rows = await parseXlsxFile(fileBuffer, file.name);
        } catch (parseError) {
          logger.error(
            'sharepoint.sync.parse_error',
            { file_name: file.name },
            { error: parseError as Error }
          );
          errors.push({
            file: file.name,
            error: `Failed to parse: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          });
          filesSkipped++;
          continue;
        }

        if (rows.length === 0) {
          logger.warn('sharepoint.sync.empty_file', { file_name: file.name });
          filesSkipped++;
          continue;
        }

        // Get existing interaction_ids to detect new rows
        const existingIds = await getExistingInteractionIds();

        // Filter to only new rows
        const newRows = rows.filter(
          (row) => row.interaction_id && !existingIds.has(row.interaction_id)
        );

        if (newRows.length === 0) {
          logger.info('sharepoint.sync.no_new_rows', {
            file_name: file.name,
            total_rows: rows.length,
          });
          filesSkipped++;
          continue;
        }

        logger.info('sharepoint.sync.new_rows_found', {
          file_name: file.name,
          total_rows: rows.length,
          new_rows: newRows.length,
        });

        // Insert upload record
        await createUploadRecord({
          file_hash: fileHash,
          file_name: file.name,
          row_count: rows.length,
          s3_key: s3Key,
          source: 'sharepoint',
          status: 'processing',
          upload_id: uploadId,
          uploaded_by: 'sharepoint-sync',
        });

        // Process rows (maps CSV to transcript records and inserts)
        const insertFn = async (records: any[]) => bulkInsertTranscripts(records as any);

        const result = await processAllRows(newRows, fileHash, s3Key, insertFn, file.name);

        // Update upload record
        await updateUploadRecord(uploadId, {
          duplicate_count: rows.length - result.inserted,
          error_count: result.errors,
          processed_count: result.inserted,
          status: 'completed',
        });

        logger.info('sharepoint.sync.file_processed', {
          file_name: file.name,
          upload_id: uploadId,
          new_rows: newRows.length,
          processed: result.processed,
          inserted: result.inserted,
          skipped: result.skipped,
        });

        filesProcessed++;
        totalNewRows += result.inserted;
      } catch (error) {
        logger.error(
          'sharepoint.sync.file_error',
          { file_name: file.name },
          { error: error as Error }
        );
        errors.push({
          file: file.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('sharepoint.sync.completed', {
      files_found: files.length,
      files_processed: filesProcessed,
      files_skipped: filesSkipped,
      total_new_rows: totalNewRows,
      errors: errors.length,
    });

    return NextResponse.json({
      success: true,
      files_found: files.length,
      files_processed: filesProcessed,
      files_skipped: filesSkipped,
      total_new_rows: totalNewRows,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error('sharepoint.sync.error', {}, { error: error as Error });
    return NextResponse.json(
      {
        error: 'SharePoint sync failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export const POST = withAuth(handler);
