/**
 * L1 Transcript Database - SQLite storage for support transcript analysis
 *
 * Phase 1: Core database infrastructure
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { scheduleUpload } from './db-backup';
import { logger } from './logger';

const DB_PATH =
  process.env.L1_TRANSCRIPTS_DB_PATH || path.join(process.cwd(), 'data', 'l1_transcripts.db');

let db: Database.Database | null = null;
let _syncPromise: Promise<void> | null = null;

/**
 * Get or create database connection (singleton)
 */
export function getDb(): Database.Database {
  return getL1TranscriptsDb();
}

export function getL1TranscriptsDb(): Database.Database {
  if (db) {
    return db;
  }

  // Ensure data directory exists
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Sync from S3 before opening (uses AWS SDK via helper script for synchronous blocking)
  if (!_syncPromise) {
    logger.info('db.restore.checking_s3', { dbName: 'l1_transcripts.db' });

    try {
      // Run restore script synchronously - blocks until S3 download completes
      // Always force download to ensure latest data from S3
      const scriptPath = path.join(process.cwd(), 'src', 'lib', 'restore-db-sync.ts');
      // Use npx tsx to avoid require.resolve at build time
      execFileSync('npx', ['tsx', scriptPath, DB_PATH, 'l1_transcripts.db', 'true'], {
        stdio: 'inherit',
        timeout: 180000, // 3 minute timeout
        encoding: 'utf8',
        shell: true,
      });
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ETIMEDOUT') {
        logger.error('db.restore.timeout', {
          dbName: 'l1_transcripts.db',
          timeout: 180000,
        });
      } else {
        logger.error('db.restore.subprocess_failed', {
          dbName: 'l1_transcripts.db',
          error: err instanceof Error ? err.message : String(err),
        });
      }
      logger.info('db.restore.continuing_local', { dbName: 'l1_transcripts.db' });
    }

    _syncPromise = Promise.resolve();
  }

  // Create database connection
  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Run migrations
  initializeSchema(db);

  return db;
}

/**
 * Initialize database schema (idempotent)
 */
function initializeSchema(db: Database.Database): void {
  db.exec(`
    -- Main transcripts table
    CREATE TABLE IF NOT EXISTS l1_transcripts (
      -- Identity & dedup
      interaction_id TEXT PRIMARY KEY NOT NULL,

      -- Extracted/inferred IDs
      app_id TEXT,
      domain TEXT,
      shopper_id TEXT NOT NULL,
      customer_id TEXT,

      -- Timestamps
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ingested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

      -- AI-generated fields
      tags TEXT, -- JSON array as string: ["billing", "domain_setup"]
      conversation_summary TEXT,

      -- Original transcript data
      full_transcript TEXT NOT NULL, -- Pipe-delimited: "User: ... | Agent: ... | User: ..."

      -- Provenance
      source_s3_key TEXT,
      source_file_hash TEXT,
      xlsx_row_index INTEGER,

      -- Additional metadata (from xlsx columns)
      interaction_type TEXT,
      interaction_status TEXT,
      resolution_time_seconds INTEGER,
      agent_name TEXT,
      category TEXT,
      subcategory TEXT,
      sentiment_score REAL,
      language TEXT,

      -- Additional raw data (other xlsx columns)
      raw_data TEXT -- JSON object
    );

    -- Indexes for fast queries
    CREATE INDEX IF NOT EXISTS idx_app_id ON l1_transcripts(app_id);
    CREATE INDEX IF NOT EXISTS idx_shopper_id ON l1_transcripts(shopper_id);
    CREATE INDEX IF NOT EXISTS idx_customer_id ON l1_transcripts(customer_id);
    CREATE INDEX IF NOT EXISTS idx_created_at ON l1_transcripts(created_at);
    CREATE INDEX IF NOT EXISTS idx_tags ON l1_transcripts(tags);
    CREATE INDEX IF NOT EXISTS idx_domain ON l1_transcripts(domain);
    CREATE INDEX IF NOT EXISTS idx_source_file_hash ON l1_transcripts(source_file_hash);

    -- Upload tracking table
    CREATE TABLE IF NOT EXISTS l1_transcript_uploads (
      upload_id TEXT PRIMARY KEY NOT NULL,
      uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      uploaded_by TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      s3_key TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL, -- processing, completed, failed
      tagging_status TEXT NOT NULL DEFAULT 'pending', -- pending, completed, failed
      error_message TEXT,
      pre_backup_s3_key TEXT,
      post_backup_s3_key TEXT,
      source TEXT DEFAULT 'manual' -- manual, sharepoint
    );

    CREATE INDEX IF NOT EXISTS idx_uploaded_at ON l1_transcript_uploads(uploaded_at);
    CREATE INDEX IF NOT EXISTS idx_file_hash ON l1_transcript_uploads(file_hash);
    CREATE INDEX IF NOT EXISTS idx_status ON l1_transcript_uploads(status);

    -- Derived Insights Tables (Phase 1: Basic Aggregation)

    -- Derived Bugs: Clustered product bugs/errors
    CREATE TABLE IF NOT EXISTS derived_bugs (
      bug_id TEXT PRIMARY KEY NOT NULL,
      bug_title TEXT NOT NULL,
      bug_description TEXT,
      product_line TEXT,
      category TEXT,
      occurrence_count INTEGER NOT NULL DEFAULT 0,
      first_seen TIMESTAMP NOT NULL,
      last_seen TIMESTAMP NOT NULL,
      resolution_rate REAL, -- % of transcripts where issue was resolved
      preventable_rate REAL, -- % marked as preventable
      sample_interaction_ids TEXT, -- JSON array of example interaction_ids
      cluster_keywords TEXT, -- JSON array of keywords used for clustering
      recommended_action TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_bugs_product_line ON derived_bugs(product_line);
    CREATE INDEX IF NOT EXISTS idx_bugs_category ON derived_bugs(category);
    CREATE INDEX IF NOT EXISTS idx_bugs_last_seen ON derived_bugs(last_seen);
    CREATE INDEX IF NOT EXISTS idx_bugs_occurrence ON derived_bugs(occurrence_count DESC);

    -- Derived Feature Requests: Clustered missing capabilities
    CREATE TABLE IF NOT EXISTS derived_feature_requests (
      feature_id TEXT PRIMARY KEY NOT NULL,
      feature_title TEXT NOT NULL,
      feature_description TEXT,
      product_line TEXT,
      request_count INTEGER NOT NULL DEFAULT 0,
      first_requested TIMESTAMP NOT NULL,
      last_requested TIMESTAMP NOT NULL,
      conversion_signal_rate REAL, -- % with conversion signals (sales opportunity)
      sample_interaction_ids TEXT, -- JSON array
      cluster_keywords TEXT, -- JSON array
      business_case TEXT, -- Potential business impact summary
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_features_product_line ON derived_feature_requests(product_line);
    CREATE INDEX IF NOT EXISTS idx_features_last_requested ON derived_feature_requests(last_requested);
    CREATE INDEX IF NOT EXISTS idx_features_request_count ON derived_feature_requests(request_count DESC);

    -- Derived Friction Patterns: Aggregated pain points
    CREATE TABLE IF NOT EXISTS derived_friction_patterns (
      pattern_id TEXT PRIMARY KEY NOT NULL,
      friction_category TEXT NOT NULL, -- billing, setup, domain, etc.
      pattern_title TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 0,
      trend_direction TEXT, -- increasing, stable, decreasing
      avg_resolution_time_seconds REAL,
      preventable_rate REAL,
      first_seen TIMESTAMP NOT NULL,
      last_seen TIMESTAMP NOT NULL,
      sample_quotes TEXT, -- JSON array of customer quotes
      recommended_fix TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_friction_category ON derived_friction_patterns(friction_category);
    CREATE INDEX IF NOT EXISTS idx_friction_last_seen ON derived_friction_patterns(last_seen);
    CREATE INDEX IF NOT EXISTS idx_friction_occurrence ON derived_friction_patterns(occurrence_count DESC);

    -- Derived Preventability Analysis: Aggregated preventable contact insights
    CREATE TABLE IF NOT EXISTS derived_preventability_analysis (
      analysis_id TEXT PRIMARY KEY NOT NULL,
      time_period_start TIMESTAMP NOT NULL,
      time_period_end TIMESTAMP NOT NULL,
      total_contacts INTEGER NOT NULL,
      preventable_contacts INTEGER NOT NULL,
      preventable_rate REAL NOT NULL, -- e.g., 0.987
      est_hours_wasted REAL, -- Estimated support hours on preventable contacts
      top_preventable_categories TEXT, -- JSON array of {category, count, rate}
      recommended_actions TEXT, -- JSON array of high-impact fixes
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_preventability_period ON derived_preventability_analysis(time_period_start, time_period_end);

    -- Derived Insights Cache: Track when insights were last generated
    CREATE TABLE IF NOT EXISTS derived_insights_cache (
      cache_key TEXT PRIMARY KEY NOT NULL, -- e.g., "bugs_last_30_days"
      last_generated TIMESTAMP NOT NULL,
      record_count INTEGER,
      metadata TEXT -- JSON object with generation stats
    );
  `);

  // Add tagging_status column if not present (migration for existing DBs)
  const uploadCols = db.prepare('PRAGMA table_info(l1_transcript_uploads)').all() as Array<{
    name: string;
  }>;
  if (!uploadCols.some((c) => c.name === 'tagging_status')) {
    db.exec(
      "ALTER TABLE l1_transcript_uploads ADD COLUMN tagging_status TEXT NOT NULL DEFAULT 'pending'"
    );
  }

  // Uploads stuck in 'processing' will never reach the tagging step — mark failed
  // so isTaggingActive() never returns true for them on subsequent restarts.
  db.exec(
    "UPDATE l1_transcript_uploads SET tagging_status = 'failed' WHERE status = 'processing' AND tagging_status = 'pending'"
  );

  logger.info('db.schema.initialized', { dbName: 'l1_transcripts.db' });
}

/**
 * Close database connection
 */
export function closeL1TranscriptsDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

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

export function insertTranscript(row: TranscriptRow): boolean {
  const db = getL1TranscriptsDb();

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO l1_transcripts (
      interaction_id, shopper_id, customer_id, app_id, domain,
      tags, conversation_summary, full_transcript, created_at,
      source_s3_key, source_file_hash, xlsx_row_index,
      interaction_type, interaction_status, resolution_time_seconds,
      agent_name, category, subcategory, sentiment_score, language,
      raw_data
    ) VALUES (
      @interaction_id, @shopper_id, @customer_id, @app_id, @domain,
      @tags, @conversation_summary, @full_transcript, @created_at,
      @source_s3_key, @source_file_hash, @xlsx_row_index,
      @interaction_type, @interaction_status, @resolution_time_seconds,
      @agent_name, @category, @subcategory, @sentiment_score, @language,
      @raw_data
    )
  `);

  const result = stmt.run({
    ...row,
    tags: row.tags || null,
    raw_data: row.raw_data || null,
    created_at: row.created_at || new Date().toISOString(),
  });

  // Schedule S3 backup after write
  if (result.changes > 0) {
    scheduleUpload(DB_PATH, 'l1_transcripts.db');
  }

  return result.changes > 0;
}

/**
 * Bulk insert transcripts in a transaction
 */
export function bulkInsertTranscripts(rows: TranscriptRow[]): {
  inserted: number;
  skipped: number;
} {
  const db = getL1TranscriptsDb();

  let inserted = 0;
  let skipped = 0;

  const insertMany = db.transaction((rows: TranscriptRow[]) => {
    for (const row of rows) {
      const wasInserted = insertTranscript(row);
      if (wasInserted) {
        inserted++;
      } else {
        skipped++;
      }
    }
  });

  insertMany(rows);

  // Schedule S3 backup after bulk insert completes
  if (inserted > 0) {
    scheduleUpload(DB_PATH, 'l1_transcripts.db');
  }

  return { inserted, skipped };
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

// Init database helper (auto-restore now handled by syncDb in getL1TranscriptsDb)
export async function initDatabase(): Promise<void> {
  getL1TranscriptsDb(); // This calls initializeSchema internally and syncs from S3
}

export function queryTranscripts(filter: TranscriptFilter) {
  const db = getL1TranscriptsDb();

  let query = 'SELECT * FROM l1_transcripts WHERE 1=1';
  const params: any = {};

  if (filter.interaction_id) {
    query += ' AND interaction_id = @interaction_id';
    params.interaction_id = filter.interaction_id;
  }

  if (filter.app_id) {
    query += ' AND app_id = @app_id';
    params.app_id = filter.app_id;
  }

  if (filter.shopper_id) {
    query += ' AND shopper_id = @shopper_id';
    params.shopper_id = filter.shopper_id;
  }

  if (filter.customer_id) {
    query += ' AND customer_id = @customer_id';
    params.customer_id = filter.customer_id;
  }

  if (filter.domain) {
    query += ' AND domain = @domain';
    params.domain = filter.domain;
  }

  if (filter.category) {
    query += ' AND category = @category';
    params.category = filter.category;
  }

  if (filter.interaction_status) {
    query += ' AND interaction_status = @interaction_status';
    params.interaction_status = filter.interaction_status;
  }

  if (filter.sub_intent) {
    query += ' AND raw_data LIKE @sub_intent';
    params.sub_intent = `%"sub_intent":"${filter.sub_intent}"%`;
  }

  if (filter.friction_point) {
    query += ' AND raw_data LIKE @friction_point';
    params.friction_point = `%"friction_point":"${filter.friction_point}"%`;
  }

  if (filter.tags && filter.tags.length > 0) {
    // Match any tag (JSON array search)
    const tagConditions = filter.tags.map((_, idx) => `tags LIKE @tag${idx}`).join(' OR ');
    query += ` AND (${tagConditions})`;
    filter.tags.forEach((tag, idx) => {
      params[`tag${idx}`] = `%"${tag}"%`;
    });
  }

  if (filter.text_search) {
    query += ` AND (
      conversation_summary LIKE @text OR
      full_transcript LIKE @text OR
      tags LIKE @text OR
      category LIKE @text OR
      subcategory LIKE @text OR
      agent_name LIKE @text OR
      interaction_type LIKE @text OR
      interaction_status LIKE @text OR
      raw_data LIKE @text
    )`;
    params.text = `%${filter.text_search}%`;
  }

  if (filter.start_date) {
    query += ' AND created_at >= @start_date';
    params.start_date = filter.start_date;
  }

  if (filter.end_date) {
    query += ' AND created_at <= @end_date';
    params.end_date = filter.end_date;
  }

  query += ' ORDER BY created_at DESC';

  if (filter.limit) {
    query += ' LIMIT @limit';
    params.limit = filter.limit;
  }

  if (filter.offset) {
    query += ' OFFSET @offset';
    params.offset = filter.offset;
  }

  const stmt = db.prepare(query);
  return stmt.all(params);
}

/**
 * Get transcript by interaction_id
 */
export function getTranscriptById(interaction_id: string) {
  const db = getL1TranscriptsDb();
  const stmt = db.prepare('SELECT * FROM l1_transcripts WHERE interaction_id = ?');
  return stmt.get(interaction_id);
}

/**
 * Count transcripts matching filter
 */
export function countTranscripts(filter: TranscriptFilter): number {
  const db = getL1TranscriptsDb();

  let query = 'SELECT COUNT(*) as count FROM l1_transcripts WHERE 1=1';
  const params: any = {};

  // Same filter logic as queryTranscripts
  if (filter.interaction_id) {
    query += ' AND interaction_id = @interaction_id';
    params.interaction_id = filter.interaction_id;
  }

  if (filter.app_id) {
    query += ' AND app_id = @app_id';
    params.app_id = filter.app_id;
  }

  if (filter.shopper_id) {
    query += ' AND shopper_id = @shopper_id';
    params.shopper_id = filter.shopper_id;
  }

  if (filter.customer_id) {
    query += ' AND customer_id = @customer_id';
    params.customer_id = filter.customer_id;
  }

  if (filter.domain) {
    query += ' AND domain = @domain';
    params.domain = filter.domain;
  }

  if (filter.category) {
    query += ' AND category = @category';
    params.category = filter.category;
  }

  if (filter.interaction_status) {
    query += ' AND interaction_status = @interaction_status';
    params.interaction_status = filter.interaction_status;
  }

  if (filter.sub_intent) {
    query += ' AND raw_data LIKE @sub_intent';
    params.sub_intent = `%"sub_intent":"${filter.sub_intent}"%`;
  }

  if (filter.friction_point) {
    query += ' AND raw_data LIKE @friction_point';
    params.friction_point = `%"friction_point":"${filter.friction_point}"%`;
  }

  if (filter.tags && filter.tags.length > 0) {
    const tagConditions = filter.tags.map((_, idx) => `tags LIKE @tag${idx}`).join(' OR ');
    query += ` AND (${tagConditions})`;
    filter.tags.forEach((tag, idx) => {
      params[`tag${idx}`] = `%"${tag}"%`;
    });
  }

  if (filter.text_search) {
    query += ` AND (
      conversation_summary LIKE @text OR
      full_transcript LIKE @text OR
      tags LIKE @text OR
      category LIKE @text OR
      subcategory LIKE @text OR
      agent_name LIKE @text OR
      interaction_type LIKE @text OR
      interaction_status LIKE @text OR
      raw_data LIKE @text
    )`;
    params.text = `%${filter.text_search}%`;
  }

  if (filter.start_date) {
    query += ' AND created_at >= @start_date';
    params.start_date = filter.start_date;
  }

  if (filter.end_date) {
    query += ' AND created_at <= @end_date';
    params.end_date = filter.end_date;
  }

  const stmt = db.prepare(query);
  const result = stmt.get(params) as { count: number };
  return result.count;
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
export function checkDuplicateUpload(fileHash: string): any | null {
  const db = getL1TranscriptsDb();
  const stmt = db.prepare(`
    SELECT upload_id, file_name, uploaded_at, s3_key, processed_count, status
    FROM l1_transcript_uploads
    WHERE file_hash = ?
    ORDER BY uploaded_at DESC
    LIMIT 1
  `);
  return stmt.get(fileHash) || null;
}

export function createUploadRecord(record: UploadRecord): void {
  const db = getL1TranscriptsDb();

  const stmt = db.prepare(`
    INSERT INTO l1_transcript_uploads (
      upload_id, uploaded_by, file_name, file_hash, s3_key,
      row_count, status, source
    ) VALUES (
      @upload_id, @uploaded_by, @file_name, @file_hash, @s3_key,
      @row_count, @status, @source
    )
  `);

  stmt.run({
    ...record,
    row_count: record.row_count || 0,
    source: record.source || 'manual',
  });

  // Schedule S3 backup after write
  scheduleUpload(DB_PATH, 'l1_transcripts.db');
}

export function updateUploadRecord(
  upload_id: string,
  updates: {
    status?: string;
    processed_count?: number;
    duplicate_count?: number;
    error_count?: number;
    error_message?: string;
    post_backup_s3_key?: string;
  }
): void {
  const db = getL1TranscriptsDb();

  const setClauses = [];
  const params: any = { upload_id };

  if (updates.status !== undefined) {
    setClauses.push('status = @status');
    params.status = updates.status;
  }
  if (updates.processed_count !== undefined) {
    setClauses.push('processed_count = @processed_count');
    params.processed_count = updates.processed_count;
  }
  if (updates.duplicate_count !== undefined) {
    setClauses.push('duplicate_count = @duplicate_count');
    params.duplicate_count = updates.duplicate_count;
  }
  if (updates.error_count !== undefined) {
    setClauses.push('error_count = @error_count');
    params.error_count = updates.error_count;
  }
  if (updates.error_message !== undefined) {
    setClauses.push('error_message = @error_message');
    params.error_message = updates.error_message;
  }
  if (updates.post_backup_s3_key !== undefined) {
    setClauses.push('post_backup_s3_key = @post_backup_s3_key');
    params.post_backup_s3_key = updates.post_backup_s3_key;
  }

  const query = `UPDATE l1_transcript_uploads SET ${setClauses.join(', ')} WHERE upload_id = @upload_id`;
  const stmt = db.prepare(query);
  stmt.run(params);

  // Schedule S3 backup after write
  scheduleUpload(DB_PATH, 'l1_transcripts.db');
}

export function getUploadByHash(file_hash: string) {
  const db = getL1TranscriptsDb();
  const stmt = db.prepare(
    'SELECT * FROM l1_transcript_uploads WHERE file_hash = ? ORDER BY uploaded_at DESC LIMIT 1'
  );
  return stmt.get(file_hash);
}

export function getUploadById(upload_id: string) {
  const db = getL1TranscriptsDb();
  const stmt = db.prepare('SELECT * FROM l1_transcript_uploads WHERE upload_id = ?');
  return stmt.get(upload_id);
}

/**
 * Get all existing interaction IDs (for diff detection)
 */
export function getExistingInteractionIds(): Set<string> {
  const db = getL1TranscriptsDb();
  const stmt = db.prepare('SELECT interaction_id FROM l1_transcripts');
  const rows = stmt.all() as Array<{ interaction_id: string }>;
  return new Set(rows.map((r) => r.interaction_id));
}

/**
 * Update tags for a transcript
 * - NULL = not yet analyzed by AI
 * - '[]' = analyzed by AI, no tags found (legitimate empty result)
 * - '[...]' = analyzed by AI, tags found
 */
export function updateTranscriptTags(interaction_id: string, tags: string[]): void {
  const db = getL1TranscriptsDb();

  // Always store the result - even if empty array
  // Empty array means "AI analyzed it and found no tags"
  // NULL means "not yet analyzed"
  const tagsJson = JSON.stringify(tags);
  db.prepare('UPDATE l1_transcripts SET tags = ? WHERE interaction_id = ?').run(
    tagsJson,
    interaction_id
  );

  // Note: S3 backup NOT triggered here to avoid overwhelming S3 during bulk tagging.
  // Bulk tagging operations call scheduleUploadAfterTagging() once when complete.
}

/**
 * Mark an upload's AI tagging as completed or failed
 */
export function updateUploadTaggingStatus(upload_id: string, status: 'completed' | 'failed'): void {
  getL1TranscriptsDb()
    .prepare('UPDATE l1_transcript_uploads SET tagging_status = ? WHERE upload_id = ?')
    .run(status, upload_id);

  // Schedule S3 backup after tagging status update
  scheduleUpload(DB_PATH, 'l1_transcripts.db');
}

/**
 * Return true if any COMPLETED upload still has tagging_status = 'pending'.
 * Uploads stuck in 'processing' (crashed/failed mid-upload) are excluded —
 * they will never reach the tagging step.
 */
export function isTaggingActive(): boolean {
  const row = getL1TranscriptsDb()
    .prepare(
      "SELECT COUNT(*) as n FROM l1_transcript_uploads WHERE status = 'completed' AND tagging_status = 'pending'"
    )
    .get() as { n: number };
  return row.n > 0;
}
