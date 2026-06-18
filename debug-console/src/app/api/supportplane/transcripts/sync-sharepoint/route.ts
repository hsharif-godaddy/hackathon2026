/**
 * /api/supportplane/transcripts/sync-sharepoint
 * Sync L1 transcripts from SharePoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

import { withAuth } from '@/lib/api-auth';
import { uploadFileToS3 } from '@/lib/l1-transcript-backup';
import { getL1TranscriptsDb } from '@/lib/l1-transcript-db';
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

    const db = getL1TranscriptsDb();
    const dbPath = process.env.L1_TRANSCRIPTS_DB_PATH || './data/l1_transcripts.db';
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
        const existingUpload = db
          .prepare('SELECT upload_id, status FROM l1_transcript_uploads WHERE file_hash = ?')
          .get(fileHash) as { upload_id: string; status: string } | undefined;

        if (existingUpload && existingUpload.status === 'completed') {
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
        const existingIds = new Set(
          (
            db.prepare('SELECT interaction_id FROM l1_transcripts').all() as Array<{
              interaction_id: string;
            }>
          ).map((r) => r.interaction_id)
        );

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
        db.prepare(
          `INSERT INTO l1_transcript_uploads (
            upload_id, uploaded_at, uploaded_by, file_name, file_hash,
            s3_key, row_count, processed_count, duplicate_count, error_count, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          uploadId,
          new Date().toISOString(),
          'sharepoint-sync',
          file.name,
          fileHash,
          s3Key,
          rows.length,
          0,
          rows.length - newRows.length,
          0,
          'processing'
        );

        // Process rows (maps CSV to transcript records and inserts)
        const insertFn = async (records: any[]) => {
          const stmt = db.prepare(`
            INSERT OR IGNORE INTO l1_transcripts (
              interaction_id, app_id, domain, shopper_id, customer_id,
              tags, conversation_summary, full_transcript,
              created_at, updated_at, ingested_at,
              source_s3_key, source_file_hash, xlsx_row_index,
              interaction_type, interaction_status, resolution_time_seconds,
              agent_name, category, subcategory, sentiment_score, language, raw_data
            ) VALUES (
              @interaction_id, @app_id, @domain, @shopper_id, @customer_id,
              @tags, @conversation_summary, @full_transcript,
              @created_at, @updated_at, @ingested_at,
              @source_s3_key, @source_file_hash, @xlsx_row_index,
              @interaction_type, @interaction_status, @resolution_time_seconds,
              @agent_name, @category, @subcategory, @sentiment_score, @language, @raw_data
            )
          `);

          let inserted = 0;
          db.transaction(() => {
            for (const record of records) {
              inserted += stmt.run(record).changes;
            }
          })();

          return {
            inserted,
            skipped: records.length - inserted,
          };
        };

        const result = await processAllRows(newRows, fileHash, s3Key, insertFn, file.name);

        // Update upload record
        db.prepare(
          'UPDATE l1_transcript_uploads SET status = ?, processed_count = ?, duplicate_count = ? WHERE upload_id = ?'
        ).run('completed', result.inserted, rows.length - result.inserted, uploadId);

        // Trigger backup after sharepoint sync completes
        const { scheduleUpload } = await import('@/lib/db-backup');
        scheduleUpload(dbPath, 'l1_transcripts.db');

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
