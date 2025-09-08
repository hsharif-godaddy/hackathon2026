/**
 * Database Schema and Types
 * 
 * This module contains TypeScript interface definitions AND database schema management.
 * It provides both type definitions for TypeScript and database creation functions.
 */

import type { Database } from 'better-sqlite3';

// ==================================================================================
// TypeScript Interface Definitions
// ==================================================================================

export interface App {
  id: string;
  name: string;
  path: string;
  port: number;
  initialPrompt?: string;
  templateVersion?: string; // v1, v2, v3, etc.
  status: 'creating' | 'created' | 'error';
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
  model?: string | undefined;
  cost?: number | undefined; // Optional cost calculation
  conversationId?: string | undefined;
  description?: string | undefined;
  createdAt: Date;
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
  createAppsTable(db);
  createRunningProcessesTable(db);
  createConversationsTable(db);
  createConversationMessagesTable(db);
  createTokenUsageTable(db);
  
  // Create all indexes
  createIndexes(db);
  
  // Create all triggers
  createTriggers(db);
  
  // Apply migrations for existing databases
  applyMigrations(db);
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
      initial_prompt TEXT,
      template_version TEXT,
      status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating', 'created', 'error')),
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