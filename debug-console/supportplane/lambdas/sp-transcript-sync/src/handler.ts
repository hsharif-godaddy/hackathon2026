import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  type _Object,
} from '@aws-sdk/client-s3';
import {
  SQSClient,
  SendMessageBatchCommand,
  type SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';
import { Readable } from 'node:stream';

import { logger } from './log.js';

const s3 = new S3Client({});
const sqs = new SQSClient({});

const EXTERNAL_BUCKET = process.env.EXTERNAL_BUCKET!;
const EXTERNAL_PREFIX = process.env.EXTERNAL_PREFIX!;
const INTERNAL_BUCKET = process.env.INTERNAL_BUCKET!;
const INTERNAL_PREFIX = process.env.INTERNAL_PREFIX!;
const INGEST_JOBS_QUEUE_URL = process.env.INGEST_JOBS_QUEUE_URL!;
const ENV_NAME = process.env.ENV_NAME!;

// Stored at the root of the internal bucket — not under uploads/ so it doesn't
// accidentally get picked up as a transcript by the ingest Lambda.
const HASH_MAP_KEY = 'sync-state.json';

interface HashMapEntry {
  lastSyncDate: string;
  internalS3FileName: string;
}

type HashMap = Record<string, HashMapEntry>;

async function listAll(bucket: string, prefix?: string): Promise<_Object[]> {
  const objects: _Object[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    );
    objects.push(...(res.Contents ?? []));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

async function loadHashMap(): Promise<HashMap> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: INTERNAL_BUCKET, Key: HASH_MAP_KEY }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as HashMap;
  } catch (err: unknown) {
    // First run — no state file yet.
    if ((err as { name?: string }).name === 'NoSuchKey') {
      return {};
    }
    throw err;
  }
}

async function saveHashMap(hashMap: HashMap): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: INTERNAL_BUCKET,
      Key: HASH_MAP_KEY,
      Body: JSON.stringify(hashMap, null, 2),
      ContentType: 'application/json',
    })
  );
}

// Copies from external CKP bucket → internal bucket under INTERNAL_PREFIX.
// Returns the internal S3 key so the caller can record it in the hash map.
// Prerequisite: CKP team must grant the Lambda execution role on their bucket policy.
//
// Internal key = INTERNAL_PREFIX + everything after EXTERNAL_PREFIX.
// Example: "lighthouse_export/2026-07-01.csv" → "uploads/2026-07-01.csv"
// Stripping only the prefix (not just the basename) preserves any sub-path
// structure CKP might add later, preventing silent overwrites if two distinct
// external keys share a basename.
async function copyToInternal(ckpKey: string): Promise<string> {
  const relativePath = ckpKey.startsWith(EXTERNAL_PREFIX)
    ? ckpKey.slice(EXTERNAL_PREFIX.length)
    : ckpKey;
  const internalKey = `${INTERNAL_PREFIX}${relativePath}`;
  const get = await s3.send(new GetObjectCommand({ Bucket: EXTERNAL_BUCKET, Key: ckpKey }));
  const chunks: Buffer[] = [];
  for await (const chunk of get.Body as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: INTERNAL_BUCKET,
      Key: internalKey,
      Body: Buffer.concat(chunks),
      ContentType: get.ContentType ?? 'text/csv',
    })
  );
  return internalKey;
}

async function enqueueIngestJobs(keys: string[]): Promise<void> {
  // SQS SendMessageBatch accepts at most 10 entries per call.
  // Critically: the command resolves even on partial failures — failures are
  // reported in result.Failed, not thrown. We must inspect and throw so the
  // hash map save is skipped and the next daily run retries the same files.
  for (let i = 0; i < keys.length; i += 10) {
    const batch = keys.slice(i, i + 10);
    const entries: SendMessageBatchRequestEntry[] = batch.map((key, idx) => ({
      Id: String(idx),
      MessageBody: JSON.stringify({ bucket: INTERNAL_BUCKET, key }),
    }));
    const result = await sqs.send(
      new SendMessageBatchCommand({ QueueUrl: INGEST_JOBS_QUEUE_URL, Entries: entries })
    );
    const failed = result.Failed ?? [];
    if (failed.length > 0) {
      for (const entry of failed) {
        logger.error('sp-transcript-sync.enqueue.failed', {
          id: entry.Id,
          code: entry.Code,
          message: entry.Message,
          senderFault: entry.SenderFault,
        });
      }
      throw new Error(
        `SQS SendMessageBatch partial failure: ${failed.length}/${entries.length} entries failed`
      );
    }
    logger.debug('sp-transcript-sync.enqueue.batch', {
      sent: result.Successful?.length ?? 0,
      batchStart: i,
    });
  }
}

export interface SyncResult extends Record<string, unknown> {
  synced: number;
  skipped: number;
}

export async function handler(): Promise<SyncResult> {
  logger.info('sp-transcript-sync.run.start', {
    env: ENV_NAME,
    externalBucket: EXTERNAL_BUCKET,
    externalPrefix: EXTERNAL_PREFIX,
    internalBucket: INTERNAL_BUCKET,
    internalPrefix: INTERNAL_PREFIX,
  });

  // Step 1 + 2: fetch CKP listing and current hash map in parallel.
  const [externalObjects, hashMap] = await Promise.all([
    listAll(EXTERNAL_BUCKET, EXTERNAL_PREFIX),
    loadHashMap(),
  ]);

  logger.info('sp-transcript-sync.state.loaded', {
    externalCount: externalObjects.length,
    hashMapEntries: Object.keys(hashMap).length,
  });

  // Step 3: diff — new files and files modified since last sync.
  const syncedInternalKeys: string[] = [];

  for (const obj of externalObjects) {
    if (!obj.Key || !obj.LastModified) continue;

    const entry = hashMap[obj.Key];
    // 3b: not in hash map → new file. 3c: present but CKP file was updated.
    const needsSync = !entry || new Date(entry.lastSyncDate) < obj.LastModified;

    if (!needsSync) {
      logger.debug('sp-transcript-sync.file.skipped', { key: obj.Key });
      continue;
    }

    try {
      const internalKey = await copyToInternal(obj.Key);
      // Update in-memory map (new entry or overwrite existing).
      hashMap[obj.Key] = {
        lastSyncDate: new Date().toISOString(),
        internalS3FileName: internalKey,
      };
      syncedInternalKeys.push(internalKey);
      logger.info('sp-transcript-sync.file.copied', { ckpKey: obj.Key, internalKey });
    } catch (err) {
      logger.error('sp-transcript-sync.file.copy.failed', { key: obj.Key }, { error: err as Error });
      throw err;
    }
  }

  logger.info('sp-transcript-sync.diff.complete', {
    externalCount: externalObjects.length,
    syncedCount: syncedInternalKeys.length,
    skippedCount: externalObjects.length - syncedInternalKeys.length,
  });

  // Step 4: enqueue ingest jobs first, then persist the hash map.
  // SQS goes first: if the hash map save fails, the next daily run re-copies
  // and re-enqueues (ingest Lambda deduplicates by fileHash — no duplicates
  // in DynamoDB). If SQS fails instead, the hash map is never written so
  // the next run retries the same files — no data leak either way.
  if (syncedInternalKeys.length > 0) {
    await enqueueIngestJobs(syncedInternalKeys);
    logger.info('sp-transcript-sync.ingest-jobs.sent', { count: syncedInternalKeys.length });

    await saveHashMap(hashMap);
    logger.info('sp-transcript-sync.hashmap.saved', { entries: Object.keys(hashMap).length });
  }

  const result: SyncResult = {
    synced: syncedInternalKeys.length,
    skipped: externalObjects.length - syncedInternalKeys.length,
  };
  logger.info('sp-transcript-sync.run.complete', result);
  return result;
}
