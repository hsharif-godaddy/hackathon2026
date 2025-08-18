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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
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
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
