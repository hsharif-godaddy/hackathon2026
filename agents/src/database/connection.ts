import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/apps.db');
    
    // Ensure the data directory exists
    const dataDir = path.dirname(dbPath);
    try {
      mkdirSync(dataDir, { recursive: true });
    } catch (err) {
      // Directory might already exist, that's fine
    }
    
    db = new Database(dbPath);
    
    // Enable WAL mode for better concurrency
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA cache_size = 1000');
    db.exec('PRAGMA foreign_keys = ON');
    
    initializeSchema();
  }
  
  return db;
}

function initializeSchema() {
  if (!db) return;
  
  // Create apps table
  db.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 5000,
      initial_prompt TEXT,
      status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating', 'created', 'error')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Add path column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN path TEXT`);
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
  
  // Create index on created_at for efficient sorting
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_apps_created_at ON apps(created_at)
  `);
  
  // Create trigger to automatically update updated_at
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_apps_updated_at 
    AFTER UPDATE ON apps
    FOR EACH ROW
    BEGIN
      UPDATE apps SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);
  
  // Create running_processes table for tracking dev servers
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
  
  // Create index on app_id for efficient lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_running_processes_app_id ON running_processes(app_id)
  `);
  
  // Create index on pid for efficient process lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_running_processes_pid ON running_processes(pid)
  `);
  
  // Create conversations table
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
  
  // Create conversation_messages table
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
  
  // Create indexes for efficient queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_app_id ON conversations(app_id)
  `);
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at)
  `);
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON conversation_messages(conversation_id)
  `);
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_created_at ON conversation_messages(created_at)
  `);
  
  // Create trigger to automatically update conversations updated_at when messages are added
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_conversations_updated_at 
    AFTER INSERT ON conversation_messages
    FOR EACH ROW
    BEGIN
      UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.conversation_id;
    END
  `);

  // Create token_usage table for tracking LLM and operation costs
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

  // Create indexes for efficient token usage queries
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

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
