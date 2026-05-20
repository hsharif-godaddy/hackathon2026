import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { initializeSchema } from './schema.js';
import { Logger } from '../logging/index.js';

const logger = Logger.create({ service: 'database-recovery' });

export type RecoveryResult =
  | { status: 'healthy'; action: 'none' }
  | { status: 'recovered'; action: 'rebuilt_db'; backupPath: string; tablesRecovered: string[]; rowsRecovered: Record<string, number> }
  | { status: 'recovered'; action: 'recreated_db'; backupPath: string }
  | { status: 'failed'; action: 'rebuilt_db' | 'recreated_db'; backupPath: string; error: string };

const KNOWN_TRANSIENT_CODES = new Set([
  'EACCES', 'EMFILE', 'ENFILE', 'EBUSY', 'EAGAIN', 'ENOENT',
]);

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  return !!code && KNOWN_TRANSIENT_CODES.has(code);
}

function isSqliteCorrupt(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  return code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB';
}

function discoverTables(db: Database.Database): string[] | null {
  try {
    const rows = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    ).all() as { name: string }[];
    return rows.map(r => r.name);
  } catch (err) {
    logger.warn('database.recovery.discover_tables_failed', {
      error: err instanceof Error ? err.message : String(err),
      code: (err as { code?: string }).code,
    });
    return null;
  }
}

// nosemgrep: path-traversal — dbPath is from DB_PATH env var (server-controlled, not user input)
function createBackupDir(dbPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(path.dirname(dbPath), `backup-${timestamp}`);
  mkdirSync(backupDir, { recursive: true });
  return backupDir;
}

function backupDatabaseFiles(dbPath: string, backupDir: string): void {
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  for (const file of files) {
    if (existsSync(file)) {
      // nosemgrep: path-traversal — backupDir is derived from DB_PATH env var (server-controlled, not user input)
      copyFileSync(file, path.join(backupDir, path.basename(file)));
    }
  }
}

export type DatabaseOpener = (dbPath: string, opts: Record<string, unknown>) => Database.Database;

const defaultOpener: DatabaseOpener = (dbPath, opts) => new Database(dbPath, opts);

export function probeDatabase(
  dbPath: string,
  opener: DatabaseOpener = defaultOpener,
): { healthy: boolean; error?: Error } {
  let testDb: Database.Database | null = null;
  try {
    testDb = opener(dbPath, { readonly: true, fileMustExist: true });
    testDb.prepare('SELECT COUNT(*) AS cnt FROM sqlite_master').get();

    const rows = testDb.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
    const hasCorruption = rows.some(r => r.integrity_check !== 'ok');
    if (hasCorruption) {
      const details = rows.map(r => r.integrity_check).join('; ');
      return { healthy: false, error: new Error(`integrity_check: ${details}`) };
    }
    return { healthy: true };
  } catch (err) {
    if (isTransientError(err)) {
      logger.warn('database.recovery.probe_transient_error', {
        error: err instanceof Error ? err.message : String(err),
        code: (err as { code?: string }).code,
      });
      return { healthy: true };
    }
    return { healthy: false, error: err as Error };
  } finally {
    try { testDb?.close(); } catch { /* ignore close errors on corrupt db */ }
  }
}

interface DumpResult {
  rows: Record<string, unknown[]>;
  tablesRecovered: string[];
  nonCorruptionFailure: boolean;
}

function dumpRecoverableRows(dbPath: string): DumpResult {
  const rows: Record<string, unknown[]> = {};
  const tablesRecovered: string[] = [];
  let corruptDb: Database.Database | null = null;

  try {
    corruptDb = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    const code = (err as { code?: string }).code;
    logger.warn('database.recovery.dump_open_failed', {
      error: err instanceof Error ? err.message : String(err),
      code,
    });
    // If the open failed for a non-corruption reason (EACCES, etc.),
    // signal that so we don't delete a potentially valid file.
    const nonCorruptionFailure = isTransientError(err);
    return { rows, tablesRecovered, nonCorruptionFailure };
  }

  const tables = discoverTables(corruptDb);
  if (tables === null || tables.length === 0) {
    // Schema is unreadable — this IS corruption, not a transient error
    try { corruptDb.close(); } catch { /* ignore */ }
    return { rows, tablesRecovered, nonCorruptionFailure: false };
  }

  for (const table of tables) {
    try {
      const tableRows = corruptDb.prepare(`SELECT * FROM "${table}"`).all();
      if (tableRows.length > 0) {
        rows[table] = tableRows;
        tablesRecovered.push(table);
      }
    } catch {
      logger.warn('database.recovery.table_unreadable', { table });
    }
  }

  try { corruptDb.close(); } catch { /* ignore */ }
  return { rows, tablesRecovered, nonCorruptionFailure: false };
}

export function rebuildDatabase(
  dbPath: string,
  recoveredRows: Record<string, unknown[]>,
): { tempPath: string; rowsInserted: Record<string, number> } {
  const tempPath = `${dbPath}.recovery-tmp`;
  if (existsSync(tempPath)) unlinkSync(tempPath);

  const freshDb = new Database(tempPath);
  initializeSchema(freshDb);

  freshDb.pragma('foreign_keys = OFF');

  const rowsInserted: Record<string, number> = {};

  for (const [table, rows] of Object.entries(recoveredRows)) {
    if (rows.length === 0) continue;

    const freshColumns = freshDb.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
    const validColumnNames = new Set(freshColumns.map(c => c.name));

    let inserted = 0;
    for (const row of rows) {
      const record = row as Record<string, unknown>;
      const filteredKeys = Object.keys(record).filter(k => validColumnNames.has(k));
      if (filteredKeys.length === 0) continue;

      const columns = filteredKeys.map(k => `"${k}"`).join(', ');
      const placeholders = filteredKeys.map(() => '?').join(', ');
      const values = filteredKeys.map(k => record[k]);

      try {
        const info = freshDb.prepare(
          `INSERT OR IGNORE INTO "${table}" (${columns}) VALUES (${placeholders})`
        ).run(...values);

        if (info.changes > 0) {
          inserted++;
        } else {
          const pk = record['id'] ?? record['rowid'] ?? 'unknown';
          logger.warn('database.recovery.row_silently_dropped', {
            table,
            rowId: String(pk),
          });
        }
      } catch (err) {
        const pk = record['id'] ?? record['rowid'] ?? 'unknown';
        logger.warn('database.recovery.row_insert_failed', {
          table,
          rowId: String(pk),
          error: (err as Error).message,
        });
      }
    }

    rowsInserted[table] = inserted;
  }

  freshDb.pragma('foreign_keys = ON');
  freshDb.close();
  return { tempPath, rowsInserted };
}

function swapDatabase(dbPath: string, recoveredPath: string): void {
  const corruptPath = `${dbPath}.corrupt`;

  // Copy original to .corrupt first (non-destructive), so original remains at
  // dbPath until the final atomic rename overwrites it.
  copyFileSync(dbPath, corruptPath);

  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (existsSync(walPath)) unlinkSync(walPath);
  if (existsSync(shmPath)) unlinkSync(shmPath);

  // Atomic overwrite: rename recovered → dbPath. On POSIX this is atomic;
  // if we crash before this line, dbPath still has the original corrupt file
  // (operator can retry). If we crash after, dbPath has the recovered file.
  renameSync(recoveredPath, dbPath);
}

export function ensureDatabaseHealth(dbPath: string): RecoveryResult {
  // Check for leftover .recovered file from a previously interrupted swap
  const recoveredLeftover = `${dbPath}.recovered`;
  if (!existsSync(dbPath) && existsSync(recoveredLeftover)) {
    logger.info('database.recovery.resuming_interrupted_swap', { recoveredLeftover });
    renameSync(recoveredLeftover, dbPath);
    return { status: 'healthy', action: 'none' };
  }

  if (!existsSync(dbPath)) {
    return { status: 'healthy', action: 'none' };
  }

  const probe = probeDatabase(dbPath);
  if (probe.healthy) {
    return { status: 'healthy', action: 'none' };
  }

  logger.warn('database.recovery.corruption_detected', {
    dbPath,
    error: probe.error?.message,
  });

  const backupDir = createBackupDir(dbPath);
  backupDatabaseFiles(dbPath, backupDir);
  logger.info('database.recovery.backup_created', { backupDir });

  const { rows, tablesRecovered, nonCorruptionFailure } = dumpRecoverableRows(dbPath);

  logger.info('database.recovery.rows_extracted', {
    tablesRecovered,
    rowCounts: Object.fromEntries(Object.entries(rows).map(([t, r]) => [t, r.length])),
  });

  if (tablesRecovered.length === 0) {
    // If the dump failed for a non-corruption reason (EACCES, etc.),
    // don't delete a potentially valid file — report failure instead.
    if (nonCorruptionFailure) {
      logger.error('database.recovery.dump_failed_non_corruption', { dbPath });
      return { status: 'failed', action: 'recreated_db', backupPath: backupDir, error: 'Cannot open database for row extraction (non-corruption failure)' };
    }

    try {
      unlinkSync(dbPath);
      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      if (existsSync(walPath)) unlinkSync(walPath);
      if (existsSync(shmPath)) unlinkSync(shmPath);

      logger.info('database.recovery.recreated_empty', { dbPath });
      return { status: 'recovered', action: 'recreated_db', backupPath: backupDir };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('database.recovery.recreate_failed', { error: msg });
      return { status: 'failed', action: 'recreated_db', backupPath: backupDir, error: msg };
    }
  }

  try {
    const { tempPath, rowsInserted } = rebuildDatabase(dbPath, rows);
    swapDatabase(dbPath, tempPath);

    logger.info('database.recovery.success', { tablesRecovered, rowsInserted, backupDir });
    return {
      status: 'recovered',
      action: 'rebuilt_db',
      backupPath: backupDir,
      tablesRecovered,
      rowsRecovered: rowsInserted,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('database.recovery.rebuild_failed', { error: msg });
    return { status: 'failed', action: 'rebuilt_db', backupPath: backupDir, error: msg };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // nosemgrep: path-traversal — fallback path is a static relative default, DB_PATH is server-controlled
  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/apps.db');

  console.log(`Checking database: ${dbPath}`);
  const result = ensureDatabaseHealth(dbPath);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === 'failed' ? 1 : 0);
}
