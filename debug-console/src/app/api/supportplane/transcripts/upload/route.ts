/**
 * /api/supportplane/transcripts/upload
 * Upload .xlsx file and ingest L1 transcripts
 */

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { type AuthenticatedRequest, withAuth } from '@/lib/api-auth';
import { hashFile, validateXlsxFile, generateUploadS3Key } from '@/lib/l1-transcript-utils';
import { parseXlsxFile, processAllRows } from '@/lib/l1-transcript-ingestion';
import { uploadFileToS3 } from '@/lib/l1-transcript-backup';
import {
  initDatabase,
  bulkInsertTranscripts,
  createUploadRecord,
  updateUploadRecord,
  updateTranscriptTags,
  updateUploadTaggingStatus,
} from '@/lib/supportplane/db/l1-transcript-db';
import { tagTranscriptsBatch } from '@/lib/l1-transcript-ai-tagging';
import { logger } from '@/lib/logger';

async function handler(request: NextRequest, auth: AuthenticatedRequest) {
  try {
    // Only accept POST
    if (request.method !== 'POST') {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file
    const validation = validateXlsxFile(file, file.name);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Calculate file hash for tracking (not for blocking duplicates)
    const fileHash = hashFile(buffer);

    // Generate upload ID
    const uploadId = uuidv4();

    // Initialize database
    await initDatabase();

    // Check if this exact file was already uploaded successfully
    // Log it but don't block - allow reprocessing in case previous upload failed
    const { checkDuplicateUpload } = await import('@/lib/supportplane/db/l1-transcript-db');
    const existingUpload = await checkDuplicateUpload(fileHash);

    if (existingUpload && existingUpload.status === 'completed') {
      logger.warn('supportplane.transcripts.upload.duplicate_file', {
        fileHash,
        existingUploadId: existingUpload.upload_id,
        existingFileName: existingUpload.file_name,
        uploadedAt: existingUpload.uploaded_at,
        action: 'proceeding_anyway',
      });
      // Continue processing - duplicates will be handled at interaction_id level
    }

    // Upload xlsx to S3
    logger.info('supportplane.transcripts.upload.s3.start', {});
    const s3Key = generateUploadS3Key(uploadId, file.name);
    await uploadFileToS3(buffer, s3Key);

    // Create upload record
    const uploadedBy = auth.user?.email || 'system';
    await createUploadRecord({
      upload_id: uploadId,
      uploaded_by: uploadedBy,
      file_name: file.name,
      file_hash: fileHash,
      s3_key: s3Key,
      status: 'processing',
    });

    // Parse xlsx or csv
    logger.info('supportplane.transcripts.upload.parse.start', {});
    const rows = await parseXlsxFile(buffer, file.name);

    if (rows.length === 0) {
      await updateUploadRecord(uploadId, {
        status: 'failed',
        error_message: 'No rows found in xlsx file',
      });

      return NextResponse.json(
        {
          error: 'Empty file',
          message: 'No data rows found in xlsx file',
        },
        { status: 400 }
      );
    }

    // Validate CSV structure and data
    logger.info('supportplane.transcripts.upload.validate.start', {});
    const { validateCsvRows } = await import('@/lib/l1-transcript-utils');
    const csvValidation = validateCsvRows(rows);

    if (!csvValidation.valid) {
      const errorMessage = `Validation failed: ${csvValidation.errors.join('; ')}`;
      logger.error('supportplane.transcripts.upload.validation.failed', {
        uploadId,
        errors: csvValidation.errors,
      });

      await updateUploadRecord(uploadId, {
        status: 'failed',
        error_message: errorMessage,
      });

      return NextResponse.json(
        {
          error: 'Validation failed',
          message: errorMessage,
          errors: csvValidation.errors,
          warnings: csvValidation.warnings,
        },
        { status: 400 }
      );
    }

    // Log warnings but continue processing
    if (csvValidation.warnings.length > 0) {
      logger.warn('supportplane.transcripts.upload.validation.warnings', {
        warnings: csvValidation.warnings,
      });
    }

    // Process rows with parallel batching
    logger.info('supportplane.transcripts.upload.process.start', { rowCount: rows.length });

    const insertFn = async (records: any[]) => {
      return bulkInsertTranscripts(records as any);
    };

    const result = await processAllRows(rows, fileHash, s3Key, insertFn, file.name);

    // POST-UPLOAD BACKUP removed - using automatic timestamped backups instead

    // Update upload record with results
    await updateUploadRecord(uploadId, {
      status: result.errors === 0 ? 'completed' : 'failed',
      processed_count: result.inserted,
      duplicate_count: result.skipped,
      error_count: result.errors,
    });

    // Start AI tagging in background (non-blocking)
    const transcriptsForTagging = rows.map((row, idx) => ({
      interaction_id: row.interaction_id ? String(row.interaction_id).trim() : `generated-${idx}`,
      full_transcript: row.full_transcript || '',
      conversation_summary: row.conversation_summary,
    }));

    tagTranscriptsBatch(transcriptsForTagging, async function onTagged(interactionId, tags) {
      await updateTranscriptTags(interactionId, tags);
    })
      .then(async function onComplete(taggingResult) {
        logger.info('supportplane.transcripts.upload.ai_tagging.completed', {
          uploadId,
          tagged: taggingResult.tagged,
          failed: taggingResult.failed,
        });
        await updateUploadTaggingStatus(uploadId, 'completed');
      })
      .catch(async function onError(error) {
        logger.error('supportplane.transcripts.upload.ai_tagging.failed', { uploadId }, { error: error as Error });
        await updateUploadTaggingStatus(uploadId, 'failed');
      });

    return NextResponse.json({
      success: true,
      upload_id: uploadId,
      file_name: file.name,
      file_hash: fileHash,
      s3_key: s3Key,
      validation: {
        warnings: csvValidation.warnings,
      },
      rows: {
        total: result.total,
        processed: result.processed,
        inserted: result.inserted,
        skipped: result.skipped,
        errors: result.errors,
      },
      ai_tagging: {
        status: 'processing',
        message: 'AI tagging running in background',
      },
    });
  } catch (error) {
    logger.error('supportplane.transcripts.upload.error', {}, { error: error as Error });
    return NextResponse.json(
      {
        error: 'Upload failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Wrap with auth (require AD group membership)
// TODO: Add AD group check when group is created
export const POST = withAuth(handler);
