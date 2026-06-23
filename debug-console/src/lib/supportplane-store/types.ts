import type { TranscriptFilter, TranscriptRow, UploadRecord } from '@/lib/supportplane/db/l1-transcript-db';

export interface QueryGroupResult {
  field_value?: string | null;
  tag?: string | null;
  count: number;
  avg_sentiment: number;
  avg_duration?: number;
  unresolved_count: number;
  occurrences?: number;
  avg_resolution_time?: number;
  unresolved_rate?: number;
  friction_point?: string;
}

export interface TranscriptStatsResult {
  total_transcripts: number;
  tagged_transcripts: number;
  untagged_transcripts: number;
  avg_sentiment: number;
  avg_resolution_time: number;
  unresolved_count: number;
  unresolved_rate: number;
}

export interface UploadUpdate {
  status?: string;
  processed_count?: number;
  duplicate_count?: number;
  error_count?: number;
  error_message?: string;
  post_backup_s3_key?: string;
  tagging_status?: 'completed' | 'failed';
  status_tagging?: string;
}

export interface SupportplaneStore {
  insertTranscript(row: TranscriptRow): Promise<boolean>;
  bulkInsertTranscripts(rows: TranscriptRow[]): Promise<{ inserted: number; skipped: number }>;
  queryTranscripts(filter: TranscriptFilter): Promise<TranscriptRow[]>;
  browsePage(limit: number, offset: number): Promise<TranscriptRow[]>;
  countTranscripts(filter: TranscriptFilter): Promise<number>;
  getTranscriptById(interaction_id: string): Promise<TranscriptRow | null>;
  updateTranscriptTags(interaction_id: string, tags: string[]): Promise<void>;
  getExistingInteractionIds(): Promise<Set<string>>;
  createUploadRecord(record: UploadRecord): Promise<void>;
  updateUploadRecord(upload_id: string, updates: UploadUpdate): Promise<void>;
  getUploadById(upload_id: string): Promise<Record<string, unknown> | null>;
  getUploadByHash(file_hash: string): Promise<Record<string, unknown> | null>;
  checkDuplicateUpload(file_hash: string): Promise<Record<string, unknown> | null>;
  updateUploadTaggingStatus(upload_id: string, status: 'completed' | 'failed'): Promise<void>;
  isTaggingActive(): Promise<boolean>;
  hasTranscripts(): Promise<boolean>;
  getUntagged(limit: number): Promise<Array<{
    interaction_id: string;
    full_transcript: string;
    conversation_summary: string | null;
  }>>;
  queryGrouped(days_back: number, group_by: string, limit: number): Promise<QueryGroupResult[]>;
  getFriction(days_back: number, limit: number): Promise<QueryGroupResult[]>;
  getStats(days_back: number): Promise<TranscriptStatsResult>;
}
