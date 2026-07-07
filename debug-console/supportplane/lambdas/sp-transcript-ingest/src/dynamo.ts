/**
 * dynamo.ts — DynamoDB access for the ingest Lambda.
 *
 * Mirrors the write paths of debug-console `supportplane/store/dynamo-store.ts`
 * (the in-process path this Lambda replaces): transcript upsert + run-report
 * (upload record) lifecycle. Table names come from the stack env
 * (SP_L1_TRANSCRIPTS_TABLE / SP_L1_UPLOADS_TABLE).
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import type { TranscriptRecord } from './parse.js';

const REGION: string = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2';
const TRANSCRIPTS_TABLE: string = process.env.SP_L1_TRANSCRIPTS_TABLE ?? '';
const UPLOADS_TABLE: string = process.env.SP_L1_UPLOADS_TABLE ?? '';

const client: DynamoDBDocumentClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

export interface UploadRecordInput {
  upload_id: string;
  uploaded_by: string;
  file_name: string;
  file_hash: string;
  s3_key: string;
  status: 'processing' | 'completed' | 'failed';
  source?: 'manual' | 'sharepoint' | 'sync';
}

export interface UploadUpdateInput {
  status?: string;
  processed_count?: number;
  duplicate_count?: number;
  error_count?: number;
  error_message?: string;
}

export type UpsertOutcome = 'inserted' | 'updated';

/**
 * Upsert a transcript row. Unlike the in-process `insertTranscript` (which
 * skips existing ids via `attribute_not_exists`), this preserves the original
 * `created_at` (the sort key) for an existing `interaction_id` and overwrites
 * the non-key fields — the plan's skip→UPSERT change (D3).
 */
export async function upsertTranscript(row: TranscriptRecord): Promise<UpsertOutcome> {
  const interaction_id: string = String(row.interaction_id);

  const existing = await client.send(
    new QueryCommand({
      TableName: TRANSCRIPTS_TABLE,
      KeyConditionExpression: 'interaction_id = :id',
      ExpressionAttributeValues: { ':id': interaction_id },
      ProjectionExpression: 'created_at',
      Limit: 1,
      ScanIndexForward: false,
    })
  );

  const existingCreatedAt: string | undefined = existing.Items?.[0]?.created_at as string | undefined;
  const created_at: string = existingCreatedAt || row.created_at || new Date().toISOString();

  await client.send(
    new PutCommand({
      TableName: TRANSCRIPTS_TABLE,
      Item: {
        ...row,
        browse_pk: 'GLOBAL',
        created_at,
        interaction_id,
        raw_data: row.raw_data || null,
        tags: row.tags || null,
      },
    })
  );

  return existingCreatedAt ? 'updated' : 'inserted';
}

export async function createUploadRecord(record: UploadRecordInput): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: UPLOADS_TABLE,
      ConditionExpression: 'attribute_not_exists(upload_id)',
      Item: {
        ...record,
        row_count: 0,
        source: record.source || 'manual',
        tagging_status: 'pending',
        status_tagging: 'pending',
        uploaded_at: new Date().toISOString(),
      },
    })
  );
}

export async function getUploadById(upload_id: string): Promise<Record<string, unknown> | null> {
  const query = await client.send(
    new QueryCommand({
      TableName: UPLOADS_TABLE,
      KeyConditionExpression: 'upload_id = :upload_id',
      ExpressionAttributeValues: { ':upload_id': upload_id },
      Limit: 1,
      ScanIndexForward: false,
    })
  );
  return query.Items?.[0] || null;
}

export async function checkDuplicateUpload(
  file_hash: string
): Promise<Record<string, unknown> | null> {
  const query = await client.send(
    new QueryCommand({
      TableName: UPLOADS_TABLE,
      IndexName: 'fileHashIndex',
      KeyConditionExpression: 'file_hash = :file_hash',
      ExpressionAttributeValues: { ':file_hash': file_hash },
      Limit: 1,
      ScanIndexForward: false,
    })
  );
  return query.Items?.[0] || null;
}

/**
 * Update a run report (upload record) by upload_id. Reads the row first to
 * recover the `uploaded_at` sort key, mirroring dynamo-store.updateUploadRecord.
 */
export async function updateUploadRecord(
  upload_id: string,
  updates: UploadUpdateInput
): Promise<void> {
  const upload = await getUploadById(upload_id);
  if (!upload || typeof upload.uploaded_at !== 'string') {
    return;
  }

  const expressions: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  let idx = 0;

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      continue;
    }
    const nameToken = `#f${idx}`;
    const valueToken = `:v${idx}`;
    expressions.push(`${nameToken} = ${valueToken}`);
    names[nameToken] = key;
    values[valueToken] = value;
    idx += 1;
  }

  if (!expressions.length) {
    return;
  }

  await client.send(
    new UpdateCommand({
      TableName: UPLOADS_TABLE,
      Key: { upload_id, uploaded_at: upload.uploaded_at },
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      UpdateExpression: `SET ${expressions.join(', ')}`,
    })
  );
}
