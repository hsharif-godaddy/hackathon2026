import { getStore } from '@/lib/supportplane/store';

const SQLITE_REMOVED_ERROR =
  'SQLite-backed transcript access has been removed. Use the DynamoDB-backed store APIs.';

export function getDb(): never {
  throw new Error(SQLITE_REMOVED_ERROR);
}

export function getL1TranscriptsDb(): never {
  throw new Error(SQLITE_REMOVED_ERROR);
}

export function closeL1TranscriptsDb(): void {}

/**
 * Insert a single transcript (idempotent on interaction_id)
 */
export interface TranscriptRow {
  interaction_id: string;
  shopper_id: string;
  customer_id?: string;
  app_id?: string;
  domain?: string;
  tags?: string[]; // Will be JSON stringified
  conversation_summary?: string;
  full_transcript: string;
  created_at?: string;
  source_s3_key?: string;
  source_file_hash?: string;
  xlsx_row_index?: number;
  interaction_type?: string;
  interaction_status?: string;
  resolution_time_seconds?: number;
  agent_name?: string;
  category?: string;
  subcategory?: string;
  sentiment_score?: number;
  language?: string;
  raw_data?: Record<string, any>; // Will be JSON stringified
}

export async function insertTranscript(row: TranscriptRow): Promise<boolean> {
  return getStore().insertTranscript(row);
}

/**
 * Bulk insert transcripts in a transaction
 */
export async function bulkInsertTranscripts(rows: TranscriptRow[]): Promise<{
  inserted: number;
  skipped: number;
}> {
  return getStore().bulkInsertTranscripts(rows);
}

/**
 * Query transcripts with filters
 */
export interface TranscriptFilter {
  app_id?: string;
  shopper_id?: string;
  customer_id?: string;
  domain?: string;
  interaction_id?: string;
  category?: string;
  interaction_status?: string;
  sub_intent?: string;
  friction_point?: string;
  tags?: string[]; // Any of these tags
  text_search?: string; // Search in summary or transcript
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

// Alias for compatibility
export type QueryFilters = TranscriptFilter;

// Keep legacy init API for callers; Dynamo does not require local DB bootstrap.
export async function initDatabase(): Promise<void> {
  await getStore().countTranscripts({ limit: 1 });
}

export async function queryTranscripts(filter: TranscriptFilter): Promise<TranscriptRow[]> {
  return getStore().queryTranscripts(filter);
}

/**
 * Get transcript by interaction_id
 */
export async function getTranscriptById(interaction_id: string): Promise<TranscriptRow | null> {
  return getStore().getTranscriptById(interaction_id);
}

/**
 * Count transcripts matching filter
 */
export async function countTranscripts(filter: TranscriptFilter): Promise<number> {
  return getStore().countTranscripts(filter);
}

/**
 * Upload tracking functions
 */
export interface UploadRecord {
  upload_id: string;
  uploaded_by: string;
  file_name: string;
  file_hash: string;
  s3_key: string;
  row_count?: number;
  status: 'processing' | 'completed' | 'failed';
  source?: 'manual' | 'sharepoint';
  pre_backup_s3_key?: string;
  post_backup_s3_key?: string;
}

/**
 * Check if a file with this hash was already uploaded
 * Returns the existing upload record if found
 */
export async function checkDuplicateUpload(fileHash: string): Promise<Record<string, unknown> | null> {
  return getStore().checkDuplicateUpload(fileHash);
}

export async function createUploadRecord(record: UploadRecord): Promise<void> {
  await getStore().createUploadRecord(record);
}

export async function updateUploadRecord(
  upload_id: string,
  updates: {
    status?: string;
    processed_count?: number;
    duplicate_count?: number;
    error_count?: number;
    error_message?: string;
    post_backup_s3_key?: string;
  }
): Promise<void> {
  await getStore().updateUploadRecord(upload_id, updates);
}

export async function getUploadByHash(file_hash: string): Promise<Record<string, unknown> | null> {
  return getStore().getUploadByHash(file_hash);
}

export async function getUploadById(upload_id: string): Promise<Record<string, unknown> | null> {
  return getStore().getUploadById(upload_id);
}

/**
 * Get all existing interaction IDs (for diff detection)
 */
export async function getExistingInteractionIds(): Promise<Set<string>> {
  return getStore().getExistingInteractionIds();
}

/**
 * Update tags for a transcript
 * - NULL = not yet analyzed by AI
 * - '[]' = analyzed by AI, no tags found (legitimate empty result)
 * - '[...]' = analyzed by AI, tags found
 */
export async function updateTranscriptTags(interaction_id: string, tags: string[]): Promise<void> {
  await getStore().updateTranscriptTags(interaction_id, tags);
}

/**
 * Mark an upload's AI tagging as completed or failed
 */
export async function updateUploadTaggingStatus(
  upload_id: string,
  status: 'completed' | 'failed'
): Promise<void> {
  await getStore().updateUploadTaggingStatus(upload_id, status);
}

/**
 * Return true if any COMPLETED upload still has tagging_status = 'pending'.
 * Uploads stuck in 'processing' (crashed/failed mid-upload) are excluded —
 * they will never reach the tagging step.
 */
export async function isTaggingActive(): Promise<boolean> {
  return getStore().isTaggingActive();
}

export async function getUntaggedTranscripts(limit: number): Promise<
  Array<{
    interaction_id: string;
    full_transcript: string;
    conversation_summary: string | null;
  }>
> {
  return getStore().getUntagged(limit);
}

export async function warmTranscriptCache(): Promise<void> {
  await getStore().queryTranscripts({});
}

export async function browsePage(limit: number, offset: number): Promise<TranscriptRow[]> {
  return getStore().browsePage(limit, offset);
}
