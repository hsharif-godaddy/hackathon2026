/**
 * Database Schema and Types
 * 
 * This module contains TypeScript interface definitions AND database schema management.
 * It provides both type definitions for TypeScript and database creation functions.
 */

import type { Database } from 'better-sqlite3';
import { Logger } from '../logging/index.js';

const logger = Logger.create({ service: 'database-schema' });

// ==================================================================================
// TypeScript Interface Definitions
// ==================================================================================

export interface App {
  id: string;
  name: string;
  path: string;
  port: number;
  socketPath?: string; // Path to dev-supervisor socket for this app
  previewUrl?: string; // Full URL for preview (e.g., https://site-id.preview.example.com)
  initialPrompt?: string;
  templateVersion?: string; // Template version (v8)
  subscriptionId?: string; // Subscription ID from main app
  customerId?: string; // Customer ID from main app
  status: 'creating' | 'created' | 'error';
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
  createdAt: Date;
}

export interface ToolCall {
  id: string;
  tool_name: string;
  tool_args: any;
  tool_result?: any;
  error?: string;
  start_time?: number;
  end_time?: number;
  duration_ms?: number;
  status: 'running' | 'success' | 'error';
}

export interface MessageSegment {
  id: string;
  type: 'content' | 'tool_call';
  content?: string;
  tool_call?: ToolCall;
  timestamp: Date;
}

export interface TokenUsage {
  id: string;
  appId: string;
  operation: 'llm_request' | 'file_edit' | 'tool_execution';
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model?: string | undefined;
  cost?: number | undefined; // Optional cost calculation
  conversationId?: string | undefined;
  description?: string | undefined;
  createdAt: Date;
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
  createTokenUsageTable(db);
  createFileContextTable(db);
  createMemoryTable(db);
  
  // Apply migrations BEFORE creating indexes (migrations may alter schema)
  // Note: oauth_tokens table creation moved to migrations (added in PR #646)
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
  db.exec('PRAGMA synchronous = NORMAL');
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the token_usage table for tracking LLM and operation costs
 */
function createTokenUsageTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('llm_request', 'file_edit', 'tool_execution')),
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      cost REAL DEFAULT 0,
      conversation_id TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
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

  // Token usage table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_token_usage_app_id ON token_usage(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage(created_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_token_usage_operation ON token_usage(operation)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_token_usage_conversation_id ON token_usage(conversation_id)
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
}

/**
 * Apply migrations for existing databases
 * This handles adding new columns to existing tables without breaking existing data
 */
function applyMigrations(db: Database): void {
  // Add cache token fields to token_usage table if they don't exist
  try {
    db.exec(`ALTER TABLE token_usage ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0`);
    db.exec(`ALTER TABLE token_usage ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0`);
  } catch (err) {
    // Columns might already exist, that's fine
  }

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
  
  // Add preview_url column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN preview_url TEXT`);
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