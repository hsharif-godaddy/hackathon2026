import Database from 'better-sqlite3';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { ensureDatabaseHealth } from './db-recovery.js';
import { initializeSchema } from './schema.js';
import { Logger } from '../logging/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = Logger.create({ service: 'database-connection' });

let db: Database.Database | null = null;
let checkpointInterval: NodeJS.Timeout | null = null;
const WAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;

function errorMeta(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { error: String(err) };
  return {
    error: err.message,
    stack: err.stack,
    ...(('errno' in err) && { errno: (err as NodeJS.ErrnoException).errno }),
    ...(('code' in err) && { code: (err as NodeJS.ErrnoException).code }),
  };
}

// SHM is a memory-mapped WAL index tied to the process that created it.
// After a container restart the stale SHM can cause the new process to
// misinterpret the WAL, leading to SQLITE_CORRUPT / SQLITE_NOTADB.
// Failure to unlink (EACCES, EBUSY) is fatal — proceeding with a stale
// SHM will likely corrupt the database on first read.
function removeStaleShmFile(dbPath: string): void {
  const shmPath = `${dbPath}-shm`;
  if (!existsSync(shmPath)) return;

  unlinkSync(shmPath);
  logger.info('database.shm.removed', { shmPath });
}

function startPeriodicCheckpoint(database: Database.Database): void {
  checkpointInterval = setInterval(() => {
    try {
      database.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      logger.warn('database.checkpoint.failed', errorMeta(err));
    }
  }, WAL_CHECKPOINT_INTERVAL_MS);

  checkpointInterval.unref();
}

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/apps.db');

    const dataDir = path.dirname(dbPath);
    try {
      mkdirSync(dataDir, { recursive: true });
    } catch {
      // Directory already exists
    }

    removeStaleShmFile(dbPath);

    const recovery = ensureDatabaseHealth(dbPath);
    if (recovery.status === 'failed') {
      throw new Error(`Database unrecoverable: ${recovery.error}`);
    }

    db = new Database(dbPath);

    initializeSchema(db);

    startPeriodicCheckpoint(db);
  }

  return db;
}

export function closeDatabase(): void {
  if (checkpointInterval) {
    clearInterval(checkpointInterval);
    checkpointInterval = null;
  }

  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      logger.warn('database.close.checkpoint_failed', errorMeta(err));
    }
    db.close();
    db = null;
  }
}
