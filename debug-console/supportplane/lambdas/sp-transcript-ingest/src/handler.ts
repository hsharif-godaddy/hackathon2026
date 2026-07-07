import { basename } from 'node:path';

import type { EventBridgeEvent, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { getObjectBuffer } from './s3.js';
import { hashFile, validateCsvRows, type ValidationResult } from './utils.js';
import { mapCsvRowToTranscript, parseXlsxFile, type RawCsvRow, type TranscriptRecord } from './parse.js';
import {
  checkDuplicateUpload,
  createUploadRecord,
  updateUploadRecord,
  upsertTranscript,
  type UpsertOutcome,
} from './dynamo.js';
import { enqueueRecordJobs } from './sqs.js';
import { logger } from './log.js';

/**
 * S3 "Object Created" event detail (EventBridge envelope — manual replay only).
 * EventBridge delivers object.key literally; it is not URL-encoded (unlike classic
 * S3 notification Records).
 */
interface S3ObjectCreatedDetail {
  bucket?: { name?: string };
  object?: { key?: string; size?: number };
}

interface DirectInvokePayload {
  bucket?: string;
  key?: string;
  /** Present when debug-console invokes after an upload — the run report to update. */
  upload_id?: string;
}

type IngestEvent =
  | EventBridgeEvent<'Object Created', S3ObjectCreatedDetail>
  | DirectInvokePayload
  | SQSEvent;

type IngestResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'processed';
      bucket: string;
      key: string;
      upload_id: string;
      total: number;
      upserted: number;
      updated: number;
      unprocessable: number;
    };

const ENV_NAME: string = process.env.ENV_NAME ?? 'dev';
const TRANSCRIPTS_TABLE: string = process.env.SP_L1_TRANSCRIPTS_TABLE ?? '';
const UPLOADS_TABLE: string = process.env.SP_L1_UPLOADS_TABLE ?? '';

// Upsert fan-out: bounded concurrency so a large file (3k+ rows) drains within
// the 300s timeout without overwhelming DynamoDB. Each upsert is a Query + Put.
const UPSERT_CONCURRENCY = 25;

type NonSqsIngestEvent =
  | EventBridgeEvent<'Object Created', S3ObjectCreatedDetail>
  | DirectInvokePayload;

function isSqsEvent(event: IngestEvent): event is SQSEvent {
  return 'Records' in event && Array.isArray(event.Records);
}

function isEventBridgeEvent(
  event: NonSqsIngestEvent
): event is EventBridgeEvent<'Object Created', S3ObjectCreatedDetail> {
  return 'detail' in event && event.detail !== undefined;
}

function resolveJob(event: NonSqsIngestEvent): { bucket: string; key: string; uploadId?: string } {
  if (isEventBridgeEvent(event)) {
    return {
      bucket: event.detail.bucket?.name ?? '',
      key: event.detail.object?.key ?? '',
    };
  }

  return {
    bucket: event.bucket ?? '',
    key: event.key ?? '',
    uploadId: event.upload_id,
  };
}

interface UpsertTally {
  upsertedIds: string[];
  inserted: number;
  updated: number;
  unprocessable: number;
}

async function upsertAll(
  rows: RawCsvRow[],
  fileHash: string,
  s3Key: string,
  filename: string
): Promise<UpsertTally> {
  const tally: UpsertTally = { upsertedIds: [], inserted: 0, updated: 0, unprocessable: 0 };

  for (let start = 0; start < rows.length; start += UPSERT_CONCURRENCY) {
    const group: RawCsvRow[] = rows.slice(start, start + UPSERT_CONCURRENCY);
    const outcomes = await Promise.all(
      group.map(async (row, i): Promise<{ id: string; outcome: UpsertOutcome } | { error: string }> => {
        let record: TranscriptRecord;
        try {
          record = mapCsvRowToTranscript(row, start + i, fileHash, s3Key, filename);
        } catch (error: unknown) {
          // Mapping/validation error — row is malformed, retrying won't help.
          return { error: error instanceof Error ? error.message : String(error) };
        }
        // DynamoDB write — infra errors (throttle, permission, network) propagate
        // out of Promise.all so processFile throws and the message redrives.
        const outcome: UpsertOutcome = await upsertTranscript(record);
        return { id: record.interaction_id, outcome };
      })
    );

    for (const result of outcomes) {
      if ('error' in result) {
        tally.unprocessable += 1;
        continue;
      }
      tally.upsertedIds.push(result.id);
      if (result.outcome === 'inserted') {
        tally.inserted += 1;
      } else {
        tally.updated += 1;
      }
    }
  }

  return tally;
}

/**
 * Process one CSV/xlsx file: S3 GetObject → parse → upsert rows → run report →
 * enqueue one record-processing job per upserted row.
 */
async function processFile(bucket: string, key: string, uploadId?: string): Promise<IngestResult> {
  logger.info('sp-transcript-ingest.received', {
    env: ENV_NAME,
    bucket,
    key,
    uploadId,
    transcriptsTable: TRANSCRIPTS_TABLE,
    uploadsTable: UPLOADS_TABLE,
  });

  if (!bucket || !key) {
    return { status: 'skipped', reason: 'missing bucket or key' };
  }

  const buffer: Buffer = await getObjectBuffer(bucket, key);
  const fileHash: string = hashFile(buffer);
  const filename: string = basename(key);

  // Run report: reuse the debug-console-created record on a direct upload invoke;
  // otherwise (SQS sync/cron) open a fresh one keyed by a generated upload_id.
  const runReportId: string = uploadId ?? uuidv4();
  if (!uploadId) {
    await createUploadRecord({
      upload_id: runReportId,
      uploaded_by: 'system',
      file_name: filename,
      file_hash: fileHash,
      s3_key: key,
      status: 'processing',
      source: 'sync',
    });
  }

  // Non-blocking dup detection (matches today's in-process behavior).
  const duplicate = await checkDuplicateUpload(fileHash);
  if (duplicate && duplicate.status === 'completed') {
    logger.warn('sp-transcript-ingest.duplicate_file', {
      fileHash,
      existingUploadId: duplicate.upload_id,
      action: 'proceeding_anyway',
    });
  }

  try {
    const rows: RawCsvRow[] = await parseXlsxFile(buffer, filename);
    const validation: ValidationResult = validateCsvRows(rows as Array<Record<string, unknown>>);
    if (validation.warnings.length > 0 || validation.errors.length > 0) {
      logger.warn('sp-transcript-ingest.validation', {
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    const tally: UpsertTally = await upsertAll(rows, fileHash, key, filename);
    const enqueued: number = await enqueueRecordJobs(tally.upsertedIds, runReportId);

    await updateUploadRecord(runReportId, {
      status: tally.unprocessable > 0 && tally.upsertedIds.length === 0 ? 'failed' : 'completed',
      processed_count: tally.upsertedIds.length,
      duplicate_count: tally.updated,
      error_count: tally.unprocessable,
    });

    logger.info('sp-transcript-ingest.processed', {
      bucket,
      key,
      uploadId: runReportId,
      total: rows.length,
      inserted: tally.inserted,
      updated: tally.updated,
      unprocessable: tally.unprocessable,
      enqueued,
    });

    return {
      status: 'processed',
      bucket,
      key,
      upload_id: runReportId,
      total: rows.length,
      upserted: tally.upsertedIds.length,
      updated: tally.updated,
      unprocessable: tally.unprocessable,
    };
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error);
    await updateUploadRecord(runReportId, { status: 'failed', error_message: message });
    throw error;
  }
}

/**
 * `sp-transcript-ingest` handler.
 *
 * Invoked THREE ways (no S3 bucket notifications — GD boundary):
 *   - Direct `{ bucket, key, upload_id? }` — debug-console after an upload.
 *   - SQS `ingest-jobs` queue — the sp-transcript-sync Lambda (cron / UI Sync),
 *     one message per new key; returns partial-batch failures for redrive.
 *   - EventBridge "Object Created" envelope — manual replay only.
 */
export async function handler(event: IngestEvent): Promise<IngestResult | SQSBatchResponse> {
  if (isSqsEvent(event)) {
    const batchItemFailures: SQSBatchItemFailure[] = [];
    for (const record of event.Records) {
      try {
        const payload: DirectInvokePayload = JSON.parse(record.body) as DirectInvokePayload;
        const result: IngestResult = await processFile(
          payload.bucket ?? '',
          payload.key ?? '',
          payload.upload_id
        );
        if (result.status === 'skipped') {
          // Bad key — retrying never helps; log-drop rather than churn to DLQ.
          logger.warn('sp-transcript-ingest.skip', {
            reason: result.reason,
            messageId: record.messageId,
          });
        }
      } catch (error: unknown) {
        logger.error('sp-transcript-ingest.error', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  }

  const { bucket, key, uploadId } = resolveJob(event);
  return processFile(bucket, key, uploadId);
}
