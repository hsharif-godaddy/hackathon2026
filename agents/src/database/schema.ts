/**
 * Database Schema and Types
 *
 * This module contains TypeScript interface definitions AND database schema management.
 * It provides both type definitions for TypeScript and database creation functions.
 */

import type { Database } from 'better-sqlite3';
import { Logger } from '../logging/index.js';
import { SocialPlatform, PostState } from '../types/social.js';

const logger = Logger.create({ service: 'database-schema' });

// ==================================================================================
// TypeScript Interface Definitions
// ==================================================================================

export interface App {
  id: string;
  name: string;
  path: string;
  port: number;
  socketPath?: string; // Preview supervisor connection path (TCP URL or Unix socket path)
  publishSupervisorPath?: string; // Publish supervisor connection path (TCP URL) for V4 unified job
  previewUrl?: string; // Full URL for preview (e.g., https://site-id.preview.example.com)
  initialPrompt?: string;
  templateVersion?: string; // Template version (v8)
  subscriptionId?: string; // Subscription ID from main app
  customerId?: string; // Customer ID from main app
  status: 'creating' | 'created' | 'error';
  publishedUrl: string | null; // Published site URL (set after successful publish)
  initialBuildComplete?: boolean; // True when first git commit has been made
  createdAt: Date;
  updatedAt: Date;
  // Extended properties for AI name generation
  aiGeneratedName?: string;
  nameSuggested?: boolean;
  originalName?: string;
}

export interface CreateAppRequest {
  name: string;
  initialPrompt?: string;
  siteId?: string;
}

export interface UpdateAppRequest {
  name?: string;
}

export interface FileContext {
  id: string;
  appPath: string;
  filePath: string;
  lastModified: number;
  lastRead: number;
  modificationCount: number;
  readCount: number;
  fileSize: number;
  tokenCount: number;
  contentHash: string;
  actualFileModTime: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunningProcess {
  id: string;
  appId: string;
  pid: number;
  port: number;
  startedAt: Date;
  status: 'running' | 'stopped' | 'crashed';
}

export interface Conversation {
  id: string;
  appId: string;
  agentId: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  sender: 'user' | 'agent';
  content: string;
  messageType?: 'status' | 'tool_result' | 'error';
  toolCalls?: ToolCall[];
  segments?: MessageSegment[];
  metadata?: Record<string, any>;
  contextAttachments?: Array<{
    type: string;
    data: any;
    metadata?: Record<string, any>;
    persistence?: 'save' | 'ephemeral';
    renderStrategy?: 'before_prompt' | 'after_prompt' | 'replace_prompt' | 'hidden';
  }>;
  origin: 'support' | 'customer';
  createdAt: Date;
}

export interface ToolCall {
  id: string;
  toolName: string;
  toolArgs: unknown;
  toolResult?: unknown;
  error?: string;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
  status: 'running' | 'success' | 'error';
}

export interface MessageSegment {
  id: string;
  type: 'content' | 'tool_call';
  content?: string;
  tool_call?: ToolCall;
  timestamp: Date;
}


export interface Memory {
  id: string;
  appId: string;
  key: string;
  value: string; // JSON-serialized value
  valueType: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  searchText?: string | undefined; // Extracted searchable text for vector database
  createdAt: Date;
  updatedAt: Date;
}

/**
 * OAuth token storage with AES-256-GCM encryption
 * Stores encrypted access and refresh tokens for OAuth2 flows
 */
export interface OAuthToken {
  id: string;
  appId: string;
  provider: string;
  scopes: string;
  accessTokenEncrypted: string;
  accessTokenIv: string;
  accessTokenTag: string;
  refreshTokenEncrypted?: string;
  refreshTokenIv?: string;
  refreshTokenTag?: string;
  expiresAt: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Conversation summary for incremental summarization
 * Stores summaries that replace ranges of messages
 */
export interface ConversationSummary {
  id: string;
  appId: string;
  conversationId?: string; // nullable for multi-conversation summaries
  summaryText: string;
  messageRangeStart: string; // message ID
  messageRangeEnd: string; // message ID
  messageCount: number;
  originalTokenCount: number;
  summaryTokenCount: number;
  modelUsed: string;
  operationLog?: string; // cumulative log of operations that survives compression
  incrementalUpdateCount?: number; // track how many times summary has been incrementally updated
  lastFullSummarizationAt?: Date; // when summary was last regenerated from scratch
  createdAt: Date;
}

/**
 * Git remote configuration
 * Stores metadata for git remote sync (GitHub, GitLab, Bitbucket)
 * Tokens are NOT stored here - they're in secrets API
 */
export interface GitRemoteConfig {
  id: string;
  appId: string;
  remoteName: string;
  provider: string;
  repoUrl: string;
  defaultBranch: string;
  lastSyncAt: number | null;
  syncEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Share token for public preview access
 * Allows time-limited access to preview apps without authentication
 * Tokens are cryptographically secure and expire after 7 days
 */
/**
 * Share token purpose. Determines who can mint, with what TTL cap, and how the
 * one-active-token-per-app guard scopes itself.
 *
 * - 'user': UI-driven preview share (default). 1h–7d TTL, gated by replaceActive.
 * - 'archive_snapshot': pre-archive screenshot capture from hosting. Cert2s callers
 *   only, fixed 15-minute TTL, lives in its own one-active slot (so a UI-issued
 *   user link and an archive snapshot can coexist).
 */
export type ShareTokenPurpose = 'user' | 'archive_snapshot';

export interface ShareToken {
  token: string;
  appId: string;
  expiresAt: number; // Unix timestamp (milliseconds)
  purpose: ShareTokenPurpose;
  createdAt: Date;
  firstUsedAt: Date | null; // Track first access only
}

/**
 * Social platform association
 * Stores connections between apps and social media accounts
 */
export interface SocialAssociation {
  id: string;
  appId: string;
  socialId: string;
  platform: SocialPlatform;
  createdAt: Date;
}

/**
 * Social media post
 * Stores publish attempts and results for social media posts
 */
export interface SocialPost {
  id: string;
  appId: string;
  associationId: string | null;
  platform: string;
  state: PostState;
  payload: string; // JSON string
  externalResponse: string | null; // JSON string
  externalId: string | null;
  scheduledAt: Date | null;
  completedAt: Date | null;
  campaignId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ==================================================================================
// Database Schema Management Functions
// ==================================================================================

/**
 * Initialize the complete database schema
 */
export function initializeSchema(db: Database): void {
  // Configure database settings
  configureDatabaseSettings(db);

  // Create all tables
  // Note: Table creation happens before migrations for new installations
  // All table creation uses IF NOT EXISTS, ensuring idempotency
  // Migrations handle schema evolution for existing databases
  createAppsTable(db);
  createRunningProcessesTable(db);
  createConversationsTable(db);
  createConversationMessagesTable(db);

  createFileContextTable(db);
  createMemoryTable(db);
  createImportJobsTable(db);
  createDbImportJobsTable(db);
  createConversationSummariesTable(db);
  createGitRemoteConfigTable(db);
  createShareTokensTable(db);

  // Apply migrations BEFORE creating indexes (migrations may alter schema)
  // Note: oauth_tokens and social tables creation moved to migrations
  applyMigrations(db);

  // Create all indexes (after migrations complete)
  createIndexes(db);

  // Create all triggers
  createTriggers(db);

  // Create file context indexes after migrations (in case table was created during migration)
  createFileContextIndexes(db);
}

/**
 * Configure database settings and pragmas
 */
function configureDatabaseSettings(db: Database): void {
  // Enable WAL mode for better concurrency
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA cache_size = 1000');
  db.exec('PRAGMA foreign_keys = ON');
}

/**
 * Create the apps table
 */
function createAppsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 5000,
      socket_path TEXT,
      publish_supervisor_path TEXT,
      preview_url TEXT,
      initial_prompt TEXT,
      template_version TEXT,
      subscription_id TEXT,
      customer_id TEXT,
      status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating', 'created', 'error')),
      initial_build_complete BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Create the running_processes table for tracking dev servers
 */
function createRunningProcessesTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS running_processes (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      pid INTEGER NOT NULL,
      port INTEGER NOT NULL,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'running',
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the conversations table
 */
function createConversationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the conversation_messages table
 */
function createConversationMessagesTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender TEXT NOT NULL CHECK(sender IN ('user', 'agent')),
      content TEXT NOT NULL,
      message_type TEXT,
      tool_calls TEXT, -- JSON string
      segments TEXT,   -- JSON string
      metadata TEXT,   -- JSON string
      context_attachments TEXT, -- JSON string for generic context attachments
      origin TEXT NOT NULL DEFAULT 'customer' CHECK(origin IN ('support', 'customer')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);
}


/**
 * Create the file_context table for tracking hot files state
 */
function createFileContextTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_context (
      id TEXT PRIMARY KEY,
      app_path TEXT NOT NULL,
      file_path TEXT NOT NULL,
      last_modified INTEGER NOT NULL,
      last_read INTEGER NOT NULL,
      modification_count INTEGER NOT NULL DEFAULT 0,
      read_count INTEGER NOT NULL DEFAULT 0,
      file_size INTEGER NOT NULL DEFAULT 0,
      token_count INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT NOT NULL,
      actual_file_mod_time INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(app_path, file_path)
    )
  `);
}

/**
 * Create the memory table for hierarchical key-value storage
 */
function createMemoryTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      value_type TEXT NOT NULL CHECK(value_type IN ('string', 'number', 'boolean', 'object', 'array', 'null')),
      search_text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(app_id, key),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the import_jobs table for tracking zip import progress
 *
 * This table tracks the status of zip file imports, including validation errors,
 * build output, and progress through the import pipeline.
 *
 * FUTURE OPTIMIZATION: Create dedicated createEmptyAppContainer() method to skip
 * template installation, eliminating double npm install. Track in technical debt.
 */
function createImportJobsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
        'pending', 'creating_container', 'extracting', 'validating',
        'copying', 'installing', 'building', 'committing', 'pushing',
        'pulling', 'restarting', 'completed', 'failed'
      )),
      source_type TEXT NOT NULL DEFAULT 'zip' CHECK(source_type IN ('zip', 'git_pull', 'git_push')),
      zip_file_name TEXT,
      zip_file_size INTEGER,
      git_url TEXT,
      git_branch TEXT,
      git_commit_hash TEXT,
      extracted_path TEXT,
      detected_package_manager TEXT CHECK(detected_package_manager IN ('npm', 'yarn', 'pnpm')),
      has_build_script BOOLEAN,
      has_dev_script BOOLEAN,
      validation_errors TEXT,
      install_output TEXT,
      build_output TEXT,
      error_message TEXT,
      error_stage TEXT,
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);

  // Run table-specific migrations after creation
  // This handles existing databases that were created with old schema
  migrateImportJobsNullableColumns(db);
}

/**
 * Create the db_import_jobs table for tracking database import progress
 *
 * This table tracks the status of SQL file imports into app MySQL databases,
 * including progress metrics, error details, and timing information.
 * Separate from import_jobs (code import) to avoid schema bloat.
 */
function createDbImportJobsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS db_import_jobs (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
        'pending', 'validating', 'dropping_tables', 'importing', 'completed', 'failed'
      )),
      file_name TEXT,
      file_size INTEGER,
      tables_dropped INTEGER,
      tables_imported INTEGER,
      statements_executed INTEGER DEFAULT 0,
      statements_total INTEGER,
      bytes_processed INTEGER DEFAULT 0,
      progress_updated_at DATETIME,
      error_message TEXT,
      error_stage TEXT,
      error_code TEXT,
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the conversation_summaries table for incremental summarization
 */
function createConversationSummariesTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      conversation_id TEXT,
      summary_text TEXT NOT NULL,
      message_range_start TEXT NOT NULL,
      message_range_end TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      original_token_count INTEGER NOT NULL,
      summary_token_count INTEGER NOT NULL,
      model_used TEXT NOT NULL,
      operation_log TEXT,
      incremental_update_count INTEGER DEFAULT 0,
      -- last_full_summarization_at: Set to CURRENT_TIMESTAMP for initial summaries
      -- because they represent a complete "full" summarization of the conversation at that point.
      -- This is updated when summaries are regenerated from scratch after N incremental updates.
      last_full_summarization_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the git_remote_config table for git remote sync metadata
 * Tokens are NOT stored in this table - they're in secrets API
 */
function createGitRemoteConfigTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS git_remote_config (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      remote_name TEXT NOT NULL DEFAULT 'origin',
      provider TEXT NOT NULL DEFAULT 'github',
      repo_url TEXT NOT NULL,
      default_branch TEXT DEFAULT 'main',
      last_sync_at INTEGER,
      sync_enabled BOOLEAN DEFAULT TRUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(app_id, remote_name),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the share_tokens table for shareable preview links
 * Stores time-limited tokens for public preview access without authentication
 */
function createShareTokensTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS share_tokens (
      token TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      first_used_at DATETIME,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the social_associations table for social platform connections
 * Stores connections between apps and social media accounts
 */
function createSocialAssociationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_associations (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      social_id TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('FACEBOOK', 'INSTAGRAM', 'GOOGLE_BUSINESS_PROFILE', 'TIKTOK', 'YELP', 'WHATSAPP')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(app_id, social_id),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the social_posts table for social media publish records
 * Stores publish attempts and results for social media posts
 */
function createSocialPostsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_posts (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      association_id TEXT,
      platform TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('SCHEDULED', 'PUBLISHED', 'FAILED')),
      payload TEXT NOT NULL,
      external_response TEXT,
      external_id TEXT,
      scheduled_at DATETIME,
      completed_at DATETIME,
      campaign_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (association_id) REFERENCES social_associations(id) ON DELETE SET NULL
    )
  `);
}

/**
 * Create all database indexes for efficient queries
 */
function createIndexes(db: Database): void {
  // Apps table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_apps_created_at ON apps(created_at)
  `);

  // Running processes table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_running_processes_app_id ON running_processes(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_running_processes_pid ON running_processes(pid)
  `);

  // Conversations table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_app_id ON conversations(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at)
  `);

  // Conversation messages table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON conversation_messages(conversation_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_created_at ON conversation_messages(created_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_origin ON conversation_messages(conversation_id, origin)
  `);

  // Memory table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_app_id ON memory(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_key ON memory(key)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory(created_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_updated_at ON memory(updated_at)
  `);

  // OAuth tokens table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_app ON oauth_tokens(app_id, provider)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expiry ON oauth_tokens(expires_at)
  `);

  // Import jobs table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_import_jobs_app_id ON import_jobs(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_import_jobs_created_at ON import_jobs(created_at)
  `);

  // DB import jobs table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_db_import_jobs_app_id ON db_import_jobs(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_db_import_jobs_status ON db_import_jobs(status)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_db_import_jobs_created_at ON db_import_jobs(created_at)
  `);

  // Conversation summaries table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_summaries_app_id ON conversation_summaries(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_summaries_conversation_id ON conversation_summaries(conversation_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_summaries_message_range ON conversation_summaries(message_range_start, message_range_end)
  `);

  // Git remote config table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_git_remote_config_app_id ON git_remote_config(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_git_remote_config_provider ON git_remote_config(provider)
  `);

  // Composite index for efficient findByAppAndRemote queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_git_remote_config_app_remote ON git_remote_config(app_id, remote_name)
  `);

  // Social associations table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_associations_app_id ON social_associations(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_associations_app_platform ON social_associations(app_id, platform)
  `);

  // Social posts table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_app_id ON social_posts(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_app_state ON social_posts(app_id, state)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_association_id ON social_posts(association_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_platform ON social_posts(platform)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled_at ON social_posts(scheduled_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_campaign_id ON social_posts(campaign_id)
  `);

  // Share tokens table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_share_tokens_app_id ON share_tokens(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_share_tokens_expires_at ON share_tokens(expires_at)
  `);
}

/**
 * Create indexes specifically for file_context table
 * Called after migrations to ensure table exists
 */
function createFileContextIndexes(db: Database): void {
  try {
    // Check if file_context table exists before creating indexes
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='file_context'
    `).get();

    if (tableExists) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_file_context_app_path ON file_context(app_path)
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_file_context_last_read ON file_context(last_read)
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_file_context_modification_count ON file_context(modification_count)
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_file_context_read_count ON file_context(read_count)
      `);
    }
  } catch (err) {
    // Indexes might fail to create, that's okay for now
    logger.warn('database.schema.index-creation-failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Create all database triggers
 */
function createTriggers(db: Database): void {
  // Trigger to automatically update updated_at on apps
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_apps_updated_at
    AFTER UPDATE ON apps
    FOR EACH ROW
    BEGIN
      UPDATE apps SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);

  // Trigger to automatically update conversations updated_at when messages are added
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_conversations_updated_at
    AFTER INSERT ON conversation_messages
    FOR EACH ROW
    BEGIN
      UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.conversation_id;
    END
  `);

  // Trigger to automatically update updated_at on memory
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_memory_updated_at
    AFTER UPDATE ON memory
    FOR EACH ROW
    BEGIN
      UPDATE memory SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);

  // Trigger to automatically update updated_at on import_jobs
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_import_jobs_updated_at
    AFTER UPDATE ON import_jobs
    FOR EACH ROW
    BEGIN
      UPDATE import_jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);

  // Trigger to automatically update updated_at on db_import_jobs
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_db_import_jobs_updated_at
    AFTER UPDATE ON db_import_jobs
    FOR EACH ROW
    BEGIN
      UPDATE db_import_jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);

  // Trigger to automatically update updated_at on git_remote_config
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_git_remote_config_updated_at
    AFTER UPDATE ON git_remote_config
    FOR EACH ROW
    BEGIN
      UPDATE git_remote_config SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);

  // Trigger to automatically update updated_at on social_posts
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_social_posts_updated_at
    AFTER UPDATE ON social_posts
    FOR EACH ROW
    BEGIN
      UPDATE social_posts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);
}

/**
 * Migration: Update source_type CHECK constraint to replace 'git' with 'git_pull' and 'git_push'
 *
 * SQLite doesn't support ALTER COLUMN, so we need to recreate the table.
 * This is safe because we copy all data and use a transaction.
 * Note: We intentionally do NOT migrate existing git data - it will be discarded.
 *
 * @param db - Database instance
 */
function migrateSourceTypeConstraint(db: Database): void {
  try {
    // Check current constraint by trying to insert a git_pull value
    const testStmt = db.prepare(`
      INSERT INTO import_jobs (id, app_id, status, source_type)
      VALUES ('__test_constraint__', '__test__', 'pending', 'git_pull')
    `);

    try {
      testStmt.run();
      // If we get here, constraint already allows git_pull - clean up and return
      db.prepare(`DELETE FROM import_jobs WHERE id = '__test_constraint__'`).run();
      logger.info('database.migration.source-type-constraint.skipped', {
        reason: 'Constraint already allows git_pull/git_push',
      });
      return;
    } catch {
      // Constraint violation expected - need to migrate
      logger.info('database.migration.source-type-constraint.start', {
        reason: 'Updating CHECK constraint to replace git with git_pull and git_push',
      });
    }

    // SQLite requires table recreation to modify CHECK constraint
    // Note: existing git data is NOT preserved - only zip import data is migrated
    db.exec(`
      BEGIN TRANSACTION;

      -- Create new table with updated constraint (no 'git', only 'zip', 'git_pull', 'git_push')
      CREATE TABLE import_jobs_new (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
          'pending', 'creating_container', 'extracting', 'validating',
          'copying', 'installing', 'building', 'committing', 'pushing',
          'pulling', 'restarting', 'completed', 'failed'
        )),
        source_type TEXT NOT NULL DEFAULT 'zip' CHECK(source_type IN ('zip', 'git_pull', 'git_push')),
        zip_file_name TEXT,
        zip_file_size INTEGER,
        git_url TEXT,
        git_branch TEXT,
        git_commit_hash TEXT,
        extracted_path TEXT,
        detected_package_manager TEXT CHECK(detected_package_manager IN ('npm', 'yarn', 'pnpm')),
        has_build_script BOOLEAN,
        has_dev_script BOOLEAN,
        validation_errors TEXT,
        install_output TEXT,
        build_output TEXT,
        error_message TEXT,
        error_stage TEXT,
        started_at DATETIME,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
      );

      -- Copy only zip import data (discard all git data as requested)
      INSERT INTO import_jobs_new SELECT * FROM import_jobs WHERE source_type = 'zip';

      -- Drop old table and rename new one
      DROP TABLE import_jobs;
      ALTER TABLE import_jobs_new RENAME TO import_jobs;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_import_jobs_app_id ON import_jobs(app_id);
      CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_import_jobs_created_at ON import_jobs(created_at);

      COMMIT;
    `);

    logger.info('database.migration.source-type-constraint.success', {
      message: 'Successfully updated source_type CHECK constraint (git data discarded)',
    });
  } catch (err) {
    logger.error('database.migration.source-type-constraint.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Don't throw - migration failures shouldn't break app startup
  }
}

/**
 * Migration: Update status CHECK constraint to add 'pushing' and 'pulling' statuses
 *
 * SQLite doesn't support ALTER COLUMN, so we need to recreate the table.
 * This is safe because we copy all data and use a transaction.
 *
 * 1. Transaction rollback: SQLite automatically rolls back failed transactions when
 *    an error occurs within BEGIN/COMMIT. We rely on this built-in behavior rather
 *    than explicit ROLLBACK handling. If db.exec() throws, SQLite guarantees the
 *    database remains in its pre-transaction state.
 *
 * 2. Concurrent migration safety: The test-insert-delete check is not atomic, but
 *    SQLite's file-level locking prevents concurrent writes to the same database.
 *    If multiple instances attempt migration simultaneously, one will succeed and
 *    others will either skip (constraint already updated) or fail safely (caught).
 *
 * 3. Error handling: Errors are caught and logged but not re-thrown, matching the
 *    pattern used by all other migrations in this file. This ensures migration
 *    failures don't prevent app startup. The trade-off is that failed migrations
 *    require manual investigation via logs.
 *
 * @param db - Database instance
 */
function migrateImportJobsStatusConstraint(db: Database): void {
  try {
    // Check if import_jobs table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='import_jobs'
    `).get() as { name: string } | undefined;

    if (!tableExists) {
      logger.info('database.migration.status-constraint.skipped', {
        reason: 'import_jobs table does not exist yet',
      });
      return;
    }

    // Check current constraint by trying to insert a 'pushing' status value.
    // Note: This test-insert-delete approach is not atomic, but SQLite's file-level
    // locking prevents concurrent writes. See function JSDoc for details.
    const testStmt = db.prepare(`
      INSERT INTO import_jobs (id, app_id, status, source_type)
      VALUES ('__test_status_constraint__', '__test__', 'pushing', 'zip')
    `);

    try {
      testStmt.run();
      // If we get here, constraint already allows 'pushing' - clean up and return
      db.prepare(`DELETE FROM import_jobs WHERE id = '__test_status_constraint__'`).run();
      logger.info('database.migration.status-constraint.skipped', {
        reason: 'Constraint already allows pushing/pulling statuses',
      });
      return;
    } catch {
      // Constraint violation expected - need to migrate
      logger.info('database.migration.status-constraint.start', {
        reason: 'Updating CHECK constraint to add pushing and pulling statuses',
      });
    }

    // SQLite requires table recreation to modify CHECK constraint
    db.exec(`
      BEGIN TRANSACTION;

      -- Create new table with updated status constraint (includes pushing and pulling)
      CREATE TABLE import_jobs_new (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
          'pending', 'creating_container', 'extracting', 'validating',
          'copying', 'installing', 'building', 'committing', 'pushing',
          'pulling', 'restarting', 'completed', 'failed'
        )),
        source_type TEXT NOT NULL DEFAULT 'zip' CHECK(source_type IN ('zip', 'git_pull', 'git_push')),
        zip_file_name TEXT,
        zip_file_size INTEGER,
        git_url TEXT,
        git_branch TEXT,
        git_commit_hash TEXT,
        extracted_path TEXT,
        detected_package_manager TEXT CHECK(detected_package_manager IN ('npm', 'yarn', 'pnpm')),
        has_build_script BOOLEAN,
        has_dev_script BOOLEAN,
        validation_errors TEXT,
        install_output TEXT,
        build_output TEXT,
        error_message TEXT,
        error_stage TEXT,
        started_at DATETIME,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
      );

      -- Copy all existing data (preserves everything unlike migrateSourceTypeConstraint
      -- which filters by source_type='zip'). All data is preserved here because this
      -- migration only relaxes the CHECK constraint to add new status values - it doesn't
      -- change data semantics or invalidate existing records.
      INSERT INTO import_jobs_new SELECT * FROM import_jobs;

      -- Drop old table and rename new one
      DROP TABLE import_jobs;
      ALTER TABLE import_jobs_new RENAME TO import_jobs;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_import_jobs_app_id ON import_jobs(app_id);
      CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_import_jobs_created_at ON import_jobs(created_at);

      COMMIT;
    `);

    logger.info('database.migration.status-constraint.success', {
      message: 'Successfully updated status CHECK constraint to include pushing and pulling',
    });
  } catch (err) {
    // Error handling: Log and continue (don't throw). This matches the pattern used
    // by all other migrations in this file. SQLite's automatic transaction rollback
    // ensures the database remains consistent. Check logs for 'database.migration.
    // status-constraint.failed' to detect and manually resolve migration failures.
    logger.error('database.migration.status-constraint.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Apply migrations for existing databases
 * This handles adding new columns to existing tables without breaking existing data
 */
function applyMigrations(db: Database): void {

  // Add path column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN path TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add template_version column if it doesn't exist
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN template_version TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Ensure file_context table exists and has all required columns
  // This migration ensures compatibility with existing databases
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS file_context (
        id TEXT PRIMARY KEY,
        app_path TEXT NOT NULL,
        file_path TEXT NOT NULL,
        last_modified INTEGER NOT NULL,
        last_read INTEGER NOT NULL,
        modification_count INTEGER NOT NULL DEFAULT 0,
        read_count INTEGER NOT NULL DEFAULT 0,
        file_size INTEGER NOT NULL DEFAULT 0,
        token_count INTEGER NOT NULL DEFAULT 0,
        content_hash TEXT NOT NULL,
        actual_file_mod_time INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(app_path, file_path)
      )
    `);
  } catch (err) {
    // Table might already exist, that's fine
  }

  // Add missing columns to existing file_context table if they don't exist
  const fileContextColumns = [
    'ALTER TABLE file_context ADD COLUMN last_modified INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE file_context ADD COLUMN last_read INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE file_context ADD COLUMN modification_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE file_context ADD COLUMN read_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE file_context ADD COLUMN file_size INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE file_context ADD COLUMN token_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE file_context ADD COLUMN content_hash TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE file_context ADD COLUMN actual_file_mod_time INTEGER',
    'ALTER TABLE file_context ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP',
    'ALTER TABLE file_context ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP'
  ];

  for (const columnSql of fileContextColumns) {
    try {
      db.exec(columnSql);
    } catch (err) {
      // Column might already exist, that's fine
    }
  }

  // Add port column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN port INTEGER NOT NULL DEFAULT 5000`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add initial_prompt column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN initial_prompt TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add status column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating', 'created', 'error'))`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add initial_build_complete column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN initial_build_complete BOOLEAN DEFAULT FALSE`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add socket_path column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN socket_path TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add publish_supervisor_path column if it doesn't exist (for V4 unified job architecture)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN publish_supervisor_path TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add preview_url column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN preview_url TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add published_url column if it doesn't exist (for V4 unified job architecture)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN published_url TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Create oauth_tokens table if it doesn't exist (added in PR #646)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'godaddy',
        scopes TEXT NOT NULL,
        access_token_encrypted TEXT NOT NULL,
        access_token_iv TEXT NOT NULL,
        access_token_tag TEXT NOT NULL,
        refresh_token_encrypted TEXT,
        refresh_token_iv TEXT,
        refresh_token_tag TEXT,
        expires_at INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(app_id, provider)
      )
    `);
  } catch (err) {
    // Table might already exist, that's fine
  }

  // Create social_associations table if it doesn't exist
  createSocialAssociationsTable(db);

  // Create social_posts table if it doesn't exist
  createSocialPostsTable(db);

  // Add subscription_id column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN subscription_id TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add customer_id column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN customer_id TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add context_attachments column if it doesn't exist (for generic context attachments)
  try {
    db.exec(`ALTER TABLE conversation_messages ADD COLUMN context_attachments TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add origin column to track support vs customer message visibility
  try {
    db.exec(`ALTER TABLE conversation_messages ADD COLUMN origin TEXT NOT NULL DEFAULT 'customer' CHECK(origin IN ('support', 'customer'))`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add git import columns to import_jobs table if they don't exist
  try {
    db.exec(`ALTER TABLE import_jobs ADD COLUMN source_type TEXT NOT NULL DEFAULT 'zip' CHECK(source_type IN ('zip', 'git'))`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  try {
    db.exec(`ALTER TABLE import_jobs ADD COLUMN git_url TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  try {
    db.exec(`ALTER TABLE import_jobs ADD COLUMN git_branch TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  try {
    db.exec(`ALTER TABLE import_jobs ADD COLUMN git_commit_hash TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add operation_log column to conversation_summaries if it doesn't exist
  migrateSummariesOperationLog(db);

  // Add quality tracking columns to conversation_summaries if they don't exist
  migrateSummariesQualityTracking(db);

  // Migrate source_type CHECK constraint to include git_pull and git_push (remove unused 'git')
  migrateSourceTypeConstraint(db);

  // Migrate status CHECK constraint to include pushing and pulling statuses
  migrateImportJobsStatusConstraint(db);

  // Add purpose column to share_tokens for archive-snapshot share tokens
  migrateShareTokensPurpose(db);
}

/**
 * Migration: Add purpose column to share_tokens.
 *
 * Distinguishes UI-issued share links ('user') from system-issued archive
 * snapshot tokens ('archive_snapshot'). The one-active-token-per-app guard is
 * scoped per (app_id, purpose) at the route layer so the two can coexist.
 *
 * Existing rows backfill to 'user' via the column DEFAULT — preserves UI
 * behavior on upgrade.
 */
function migrateShareTokensPurpose(db: Database): void {
  try {
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='share_tokens'
    `).get() as { name: string } | undefined;

    if (!tableExists) {
      logger.info('database.migration.share-tokens-purpose.skipped', {
        reason: 'share_tokens table does not exist yet',
      });
      return;
    }

    const columnInfo = db.prepare(`
      SELECT name FROM pragma_table_info('share_tokens') WHERE name = 'purpose'
    `).get() as { name: string } | undefined;

    if (columnInfo) {
      logger.info('database.migration.share-tokens-purpose.skipped', {
        reason: 'purpose column already exists',
      });
      return;
    }

    logger.info('database.migration.share-tokens-purpose.start', {
      reason: 'Adding purpose column for archive snapshot share tokens',
    });

    db.exec(`ALTER TABLE share_tokens ADD COLUMN purpose TEXT NOT NULL DEFAULT 'user'`);

    logger.info('database.migration.share-tokens-purpose.complete', {
      success: true,
    });
  } catch (err) {
    logger.error('database.migration.share-tokens-purpose.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Migration: Remove NOT NULL constraints from zip_file_name and zip_file_size
 *
 * These columns must be nullable because git imports don't populate them.
 * This migration handles existing databases that were created with NOT NULL constraints.
 *
 * @param db - Database instance
 */
function migrateImportJobsNullableColumns(db: Database): void {
  try {
    // Check if import_jobs table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='import_jobs'
    `).get() as { name: string } | undefined;

    if (!tableExists) {
      logger.info('database.migration.import-jobs-nullable-zip-columns.skipped', {
        reason: 'import_jobs table does not exist yet',
      });
      return;
    }

    // Check if columns exist with NOT NULL constraints using PRAGMA table_info
    const columnInfo = db.prepare(`
      SELECT name, "notnull" FROM pragma_table_info('import_jobs')
      WHERE name IN ('zip_file_name', 'zip_file_size')
    `).all() as Array<{ name: string; notnull: number }>;

    logger.info('database.migration.import-jobs-nullable-zip-columns.check', {
      columnsFound: columnInfo.length,
      columns: columnInfo,
    });

    // Check if any columns have NOT NULL constraint (notnull = 1)
    const hasNotNullConstraint = columnInfo.some(col => col.notnull === 1);

    if (!hasNotNullConstraint) {
      logger.info('database.migration.import-jobs-nullable-zip-columns.skipped', {
        reason: 'Columns are already nullable',
        columnsFound: columnInfo.length,
      });
      return;
    }

    if (columnInfo.length !== 2) {
      logger.warn('database.migration.import-jobs-nullable-zip-columns.skipped', {
        reason: 'Expected 2 columns but found different count',
        columnsFound: columnInfo.length,
        columns: columnInfo,
      });
      return;
    }

    logger.info('database.migration.import-jobs-nullable-zip-columns.start', {
      reason: 'Removing NOT NULL constraints from zip_file_name and zip_file_size for git import compatibility',
      columnsToMigrate: columnInfo,
    });

    // Step 1: Rename old columns with NOT NULL constraints
    db.exec(`ALTER TABLE import_jobs RENAME COLUMN zip_file_name TO zip_file_name_old`);
    db.exec(`ALTER TABLE import_jobs RENAME COLUMN zip_file_size TO zip_file_size_old`);

    // Step 2: Add new nullable columns
    db.exec(`ALTER TABLE import_jobs ADD COLUMN zip_file_name TEXT`);
    db.exec(`ALTER TABLE import_jobs ADD COLUMN zip_file_size INTEGER`);

    // Step 3: Copy data from old to new columns for all existing rows
    db.exec(`UPDATE import_jobs SET zip_file_name = zip_file_name_old, zip_file_size = zip_file_size_old`);

    // Step 4: Drop old columns (requires SQLite 3.35.0+)
    db.exec(`ALTER TABLE import_jobs DROP COLUMN zip_file_name_old`);
    db.exec(`ALTER TABLE import_jobs DROP COLUMN zip_file_size_old`);

    logger.info('database.migration.import-jobs-nullable-zip-columns.complete', {
      success: true,
      migrated: true,
    });
  } catch (err) {
    logger.error('database.migration.import-jobs-nullable-zip-columns.failed', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Don't throw - migration failures shouldn't break app startup
  }
}

/**
 * Migrate conversation_summaries table to add operation_log column
 * This column stores a cumulative log of operations that survives compression
 *
 * NOTE: This migration is more robust than the standard try/catch pattern used
 * elsewhere in applyMigrations(). It explicitly checks for column existence
 * using pragma_table_info before attempting the ALTER TABLE, providing better
 * error isolation and clearer logging. The try/catch at the end handles
 * unexpected errors without breaking app startup.
 */
function migrateSummariesOperationLog(db: Database): void {
  try {
    // Check if conversation_summaries table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'
    `).get() as { name: string } | undefined;

    if (!tableExists) {
      logger.info('database.migration.summaries-operation-log.skipped', {
        reason: 'conversation_summaries table does not exist yet',
      });
      return;
    }

    // Check if operation_log column already exists
    const columnInfo = db.prepare(`
      SELECT name FROM pragma_table_info('conversation_summaries')
      WHERE name = 'operation_log'
    `).get() as { name: string } | undefined;

    if (columnInfo) {
      logger.info('database.migration.summaries-operation-log.skipped', {
        reason: 'operation_log column already exists',
      });
      return;
    }

    logger.info('database.migration.summaries-operation-log.start', {
      reason: 'Adding operation_log column for cumulative operation tracking',
    });

    // Add operation_log column
    db.exec(`ALTER TABLE conversation_summaries ADD COLUMN operation_log TEXT`);

    logger.info('database.migration.summaries-operation-log.complete', {
      success: true,
      migrated: true,
    });
  } catch (err) {
    logger.error('database.migration.summaries-operation-log.failed', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Don't throw - migration failures shouldn't break app startup
  }
}

/**
 * Migration: Add quality tracking fields to conversation_summaries
 *
 * Adds incremental_update_count and last_full_summarization_at columns
 * to track summary quality and trigger re-summarization when needed.
 *
 * Quality tracking prevents summary degradation by:
 * - Counting incremental updates (re-summarization after 10 updates)
 * - Recording when summary was last fully regenerated from scratch
 *
 * @param db - Database instance
 */
function migrateSummariesQualityTracking(db: Database): void {
  try {
    // Check if conversation_summaries table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'
    `).get() as { name: string } | undefined;

    if (!tableExists) {
      logger.info('database.migration.summaries-quality-tracking.skipped', {
        reason: 'conversation_summaries table does not exist yet',
      });
      return;
    }

    // Check if columns already exist
    const columns = db.prepare(`
      SELECT name FROM pragma_table_info('conversation_summaries')
    `).all() as Array<{ name: string }>;

    const columnNames = columns.map(c => c.name);
    const needsUpdateCount = !columnNames.includes('incremental_update_count');
    const needsFullSummarizationAt = !columnNames.includes('last_full_summarization_at');

    if (!needsUpdateCount && !needsFullSummarizationAt) {
      logger.info('database.migration.summaries-quality-tracking.skipped', {
        reason: 'quality tracking columns already exist',
      });
      return;
    }

    logger.info('database.migration.summaries-quality-tracking.start', {
      addingUpdateCount: needsUpdateCount,
      addingFullSummarizationAt: needsFullSummarizationAt,
    });

    if (needsUpdateCount) {
      db.exec(`ALTER TABLE conversation_summaries ADD COLUMN incremental_update_count INTEGER DEFAULT 0`);
    }

    if (needsFullSummarizationAt) {
      // SQLite doesn't allow non-constant defaults in ALTER TABLE, so we add the column
      // without a default and update existing rows to set the timestamp to created_at
      db.exec(`ALTER TABLE conversation_summaries ADD COLUMN last_full_summarization_at DATETIME`);

      // For existing summaries, set last_full_summarization_at to created_at
      // (treating existing summaries as if they were "fully" summarized at creation time)
      db.exec(`
        UPDATE conversation_summaries
        SET last_full_summarization_at = created_at
        WHERE last_full_summarization_at IS NULL
      `);
    }

    logger.info('database.migration.summaries-quality-tracking.complete', {
      success: true,
      columnsAdded: {
        updateCount: needsUpdateCount,
        fullSummarizationAt: needsFullSummarizationAt,
      },
    });
  } catch (err) {
    logger.error('database.migration.summaries-quality-tracking.failed', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Don't throw - migration failures shouldn't break app startup
  }
}

/**
 * Initialize a test database with the complete schema
 * This is a convenience function for tests that need a clean database
 */
export function initializeTestDatabase(db: Database): void {
  initializeSchema(db);
}

/**
 * Get the schema version for migration tracking
 */
export function getSchemaVersion(): string {
  return '1.0.0';
}
