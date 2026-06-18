/**
 * support-db.ts
 *
 * SQLite database for Support Tickets (Jira AABSP/CIEC) — third database per spec.
 * Separate from l1_transcripts.db and feedback_analytics.db.
 *
 * DB path: SUPPORT_DB_PATH env var (defaults to ./data/support.db)
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';

import { syncDb, scheduleUpload } from './db-backup';
import { logger } from './logger';

let _db: BetterSqlite3.Database | null = null;
let _syncPromise: Promise<void> | null = null;

function dbPath(): string {
  const envPath = process.env.SUPPORT_DB_PATH;
  if (envPath) return path.resolve(envPath);
  return path.resolve(process.cwd(), 'data', 'support.db');
}

export function getSupportDb(): BetterSqlite3.Database {
  if (_db) return _db;

  const p = dbPath();

  // Sync from S3 synchronously before opening database
  if (!_syncPromise) {
    try {
      if (!fs.existsSync(p) || fs.statSync(p).size < 4096) {
        const bucket = process.env.L1_TRANSCRIPTS_S3_BUCKET || 'airo-builder-l1-transcripts-dev';
        const prefix = 'backups/support-plane/support/';
        logger.info('support.db.sync.downloading', { path: p });

        const listCmd = `aws s3 ls s3://${bucket}/${prefix} --recursive | sort | tail -n 1 | awk '{print $4}'`;
        const latestKey = execSync(listCmd, { encoding: 'utf8' }).trim();

        if (latestKey) {
          execSync(`aws s3 cp s3://${bucket}/${latestKey} ${p}`, { stdio: 'inherit' });
          logger.info('support.db.sync.success', { s3Key: latestKey });
        } else {
          logger.info('support.db.sync.not_found', { message: 'No S3 backup, starting fresh' });
        }
      }
    } catch (err) {
      logger.error('support.db.sync.failed', {
        path: p,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    _syncPromise = Promise.resolve();
  }

  _db = new BetterSqlite3(p);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  logger.info('support.db.initialized', { path: p });
  return _db;
}

// ── Schema (per AAB Support Plane Engineering Spec) ──────────────────────────

function initSchema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      ticket_key      TEXT PRIMARY KEY,
      created_utc     TEXT NOT NULL,
      updated_utc     TEXT,
      resolved_utc    TEXT,
      status          TEXT,
      issue_type      TEXT,
      priority        TEXT,
      assignee        TEXT,
      rating          INTEGER,
      mttr_hours      REAL,
      summary         TEXT,
      description     TEXT,
      labels          TEXT,
      project         TEXT,
      meta_json       TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tk_created ON tickets(created_utc);
    CREATE INDEX IF NOT EXISTS idx_tk_updated ON tickets(updated_utc);
    CREATE INDEX IF NOT EXISTS idx_tk_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tk_assignee ON tickets(assignee);
    CREATE INDEX IF NOT EXISTS idx_tk_priority ON tickets(priority);
    CREATE INDEX IF NOT EXISTS idx_tk_project ON tickets(project);

    CREATE TABLE IF NOT EXISTS ingestion_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source          TEXT NOT NULL,
      status          TEXT NOT NULL,
      tickets_written INTEGER DEFAULT 0,
      error_msg       TEXT,
      ingested_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS meta (
      key             TEXT PRIMARY KEY,
      value           TEXT NOT NULL,
      updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Ticket {
  ticket_key: string;
  created_utc: string;
  updated_utc?: string;
  resolved_utc?: string;
  status?: string;
  issue_type?: string;
  priority?: string;
  assignee?: string;
  rating?: number;
  mttr_hours?: number;
  summary?: string;
  description?: string;
  labels?: string;
  project?: string;
  meta_json?: string;
}

export interface TicketStats {
  total: number;
  open: number;
  resolved: number;
  mean_mttr_hours?: number;
  median_mttr_hours?: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  by_assignee: Record<string, number>;
}

// ── CRUD Operations ───────────────────────────────────────────────────────────

export function upsertTicket(ticket: Ticket): void {
  const db = getSupportDb();

  const stmt = db.prepare(`
    INSERT INTO tickets (
      ticket_key, created_utc, updated_utc, resolved_utc,
      status, issue_type, priority, assignee, rating,
      mttr_hours, summary, description, labels, project, meta_json
    ) VALUES (
      @ticket_key, @created_utc, @updated_utc, @resolved_utc,
      @status, @issue_type, @priority, @assignee, @rating,
      @mttr_hours, @summary, @description, @labels, @project, @meta_json
    )
    ON CONFLICT(ticket_key) DO UPDATE SET
      updated_utc = excluded.updated_utc,
      resolved_utc = excluded.resolved_utc,
      status = excluded.status,
      issue_type = excluded.issue_type,
      priority = excluded.priority,
      assignee = excluded.assignee,
      rating = excluded.rating,
      mttr_hours = excluded.mttr_hours,
      summary = excluded.summary,
      description = excluded.description,
      labels = excluded.labels,
      project = excluded.project,
      meta_json = excluded.meta_json
  `);

  stmt.run(ticket);

  // Schedule S3 backup (debounced)
  scheduleUpload(dbPath(), 'support.db');
}

export function upsertTickets(tickets: Ticket[]): void {
  const db = getSupportDb();

  db.transaction(() => {
    tickets.forEach(ticket => upsertTicket(ticket));
  })();

  // Schedule S3 backup after batch write (debounced)
  scheduleUpload(dbPath(), 'support.db');
}

export function getTicketStats(): TicketStats {
  const db = getSupportDb();

  const total = db.prepare('SELECT COUNT(*) as count FROM tickets').get() as { count: number };
  const open = db.prepare('SELECT COUNT(*) as count FROM tickets WHERE status NOT IN (?, ?)').get('Done', 'Closed') as { count: number };
  const resolved = db.prepare('SELECT COUNT(*) as count FROM tickets WHERE status IN (?, ?)').get('Done', 'Closed') as { count: number };

  const mttrStats = db.prepare(`
    SELECT
      AVG(mttr_hours) as mean,
      (SELECT mttr_hours FROM tickets WHERE mttr_hours IS NOT NULL ORDER BY mttr_hours LIMIT 1 OFFSET (SELECT COUNT(*) FROM tickets WHERE mttr_hours IS NOT NULL) / 2) as median
    FROM tickets
    WHERE mttr_hours IS NOT NULL
  `).get() as { mean: number | null; median: number | null };

  const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM tickets GROUP BY status').all() as Array<{ status: string; count: number }>;
  const byPriority = db.prepare('SELECT priority, COUNT(*) as count FROM tickets GROUP BY priority').all() as Array<{ priority: string; count: number }>;
  const byAssignee = db.prepare('SELECT assignee, COUNT(*) as count FROM tickets WHERE assignee IS NOT NULL GROUP BY assignee ORDER BY count DESC LIMIT 20').all() as Array<{ assignee: string; count: number }>;

  return {
    total: total.count,
    open: open.count,
    resolved: resolved.count,
    mean_mttr_hours: mttrStats.mean ?? undefined,
    median_mttr_hours: mttrStats.median ?? undefined,
    by_status: Object.fromEntries(byStatus.map(r => [r.status, r.count])),
    by_priority: Object.fromEntries(byPriority.map(r => [r.priority, r.count])),
    by_assignee: Object.fromEntries(byAssignee.map(r => [r.assignee, r.count])),
  };
}

export function listTickets(filters?: {
  status?: string;
  priority?: string;
  assignee?: string;
  project?: string;
  limit?: number;
  offset?: number;
}): Ticket[] {
  const db = getSupportDb();

  let query = 'SELECT * FROM tickets WHERE 1=1';
  const params: Record<string, string | number> = {};

  if (filters?.status) {
    query += ' AND status = @status';
    params.status = filters.status;
  }
  if (filters?.priority) {
    query += ' AND priority = @priority';
    params.priority = filters.priority;
  }
  if (filters?.assignee) {
    query += ' AND assignee = @assignee';
    params.assignee = filters.assignee;
  }
  if (filters?.project) {
    query += ' AND project = @project';
    params.project = filters.project;
  }

  query += ' ORDER BY created_utc DESC';

  if (filters?.limit) {
    query += ' LIMIT @limit';
    params.limit = filters.limit;
  }
  if (filters?.offset) {
    query += ' OFFSET @offset';
    params.offset = filters.offset;
  }

  return db.prepare(query).all(params) as Ticket[];
}

export function getLastSyncTime(source: string): string | null {
  const db = getSupportDb();
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(`last_sync_${source}`) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setLastSyncTime(source: string, timestamp: string): void {
  const db = getSupportDb();
  db.prepare(`
    INSERT INTO meta (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(`last_sync_${source}`, timestamp);

  // Schedule S3 backup after metadata write (debounced)
  scheduleUpload(dbPath(), 'support.db');
}
