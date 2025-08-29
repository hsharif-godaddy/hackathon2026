import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import { initializeSchema } from './schema.js';

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
    
    // Initialize the complete schema
    initializeSchema(db);
  }
  
  return db;
}


export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
