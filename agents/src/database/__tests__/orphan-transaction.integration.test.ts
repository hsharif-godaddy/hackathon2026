/**
 * Migration transaction-safety regression tests (PR #4150).
 *
 * Asserts the post-fix invariants for `initializeSchema` when a CHECK-constraint
 * migration throws mid-script: the connection must be left in clean autocommit,
 * so subsequent `BEGIN` and `wal_checkpoint(TRUNCATE)` succeed and writes after
 * the failed migration are durable across close + reopen.
 *
 * The repro stages an old `import_jobs` schema (old `source_type` CHECK, missing
 * `diagnose_snapshot_path`) so `migrateSourceTypeConstraint`'s INSERT/SELECT
 * throws "no such column: diagnose_snapshot_path" mid-script. Pre-fix this
 * orphaned the transaction (SQLITE_LOCKED on every checkpoint, writes lost on
 * close); the fix wraps the work in `db.transaction()`, which auto-rolls-back.
 *
 * These tests guard the transaction-safety invariant, not the column-mismatch
 * trigger — any future hand-rolled `db.exec("BEGIN; …; COMMIT")` migration
 * with a swallowed catch will reintroduce the bug and fail these tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { initializeSchema } from '../schema.js';
import { Logger } from '../../logging/index.js';

/**
 * Asserts that `migrateSourceTypeConstraint` actually attempted the migration
 * and failed mid-script. Without this guard, a future change to migration
 * ordering (e.g. adding `diagnose_snapshot_path` before the source-type
 * migration) would make the migration succeed and the orphan-tx assertions
 * pass vacuously — the bug could regress without being caught.
 */
function expectMigrationFailed(errorSpy: MockInstance, event: string): void {
  const failedCall = errorSpy.mock.calls.find(([loggedEvent]) => loggedEvent === event);
  expect(
    failedCall,
    `${event} should have been logged (precondition for orphan-tx repro). ` +
    'If this fails, the migration succeeded — these tests are no longer exercising the bug.',
  ).toBeDefined();
}

/**
 * Pre-stage `apps` and `import_jobs` to look like an older release:
 *   - `import_jobs.source_type` has the old CHECK (`'zip','git'`), so
 *     `migrateSourceTypeConstraint` decides to migrate.
 *   - `import_jobs` is missing `diagnose_snapshot_path` — that column is
 *     added by `migrateImportJobsDiagnoseSnapshotPath`, which runs AFTER
 *     `migrateSourceTypeConstraint`. The source-type migration's
 *     INSERT/SELECT references `diagnose_snapshot_path`, so it throws
 *     "no such column" mid-`db.exec(BEGIN…COMMIT)` and exposes the
 *     transaction-safety bug.
 */
function stageOldImportJobs(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 3000,
      status TEXT NOT NULL DEFAULT 'created',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE import_jobs (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
        'pending','creating_container','extracting','validating',
        'copying','installing','building','completed','failed'
      )),
      source_type TEXT NOT NULL DEFAULT 'zip' CHECK(source_type IN ('zip','git')),
      zip_file_name TEXT,
      zip_file_size INTEGER,
      git_url TEXT,
      git_branch TEXT,
      git_commit_hash TEXT,
      extracted_path TEXT,
      detected_package_manager TEXT,
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
}

/**
 * Pre-stage `import_jobs` so only `migrateImportJobsStatusConstraint` runs and
 * fails (source-type CHECK already current → that migration skips; status CHECK
 * still rejects 'pushing' → status migration attempts the table recreation;
 * `diagnose_snapshot_path` missing → INSERT/SELECT throws mid-script).
 *
 * Symmetric coverage for the status-migration wrapper. Without this, a partial
 * revert that re-introduces a hand-rolled BEGIN/COMMIT in only the status
 * migration could go undetected if the source-type migration always runs first
 * and rolls itself back cleanly.
 */
function stageStatusOnlyFailure(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 3000,
      status TEXT NOT NULL DEFAULT 'created',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE import_jobs (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
        'pending','creating_container','extracting','validating',
        'copying','installing','building','completed','failed'
      )),
      source_type TEXT NOT NULL DEFAULT 'zip' CHECK(source_type IN ('zip','git_pull','git_push')),
      zip_file_name TEXT,
      zip_file_size INTEGER,
      git_url TEXT,
      git_branch TEXT,
      git_commit_hash TEXT,
      extracted_path TEXT,
      detected_package_manager TEXT,
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
}

describe('Schema migration transaction safety', () => {
  let errorSpy: MockInstance;

  beforeEach(() => {
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('in-memory DB', () => {
    let db: Database.Database;

    beforeEach(() => {
      db = new Database(':memory:');
      stageOldImportJobs(db);
    });

    afterEach(() => {
      if (db.open) db.close();
    });

    it('leaves no orphan transaction after initializeSchema, even when a migration fails mid-script', () => {
      initializeSchema(db);
      expectMigrationFailed(errorSpy, 'database.migration.source-type-constraint.failed');

      expect(db.inTransaction, 'Database should not be in transaction after initializing schema').toBe(false);
    });

    it('allows a fresh BEGIN after initializeSchema (no "transaction within a transaction")', () => {
      initializeSchema(db);
      expectMigrationFailed(errorSpy, 'database.migration.source-type-constraint.failed');

      expect(() => {
        db.exec('BEGIN TRANSACTION');
        db.exec('ROLLBACK');
      }, 'A new transaction should not throw an exception after initializing schema').not.toThrow();
    });

    it('leaves no orphan transaction when only the status-constraint migration fails', () => {
      const statusOnlyDb = new Database(':memory:');
      try {
        stageStatusOnlyFailure(statusOnlyDb);

        initializeSchema(statusOnlyDb);
        expectMigrationFailed(errorSpy, 'database.migration.status-constraint.failed');

        expect(statusOnlyDb.inTransaction, 'Database should not be in transaction after initializing schema').toBe(false);
        expect(() => {
          statusOnlyDb.exec('BEGIN TRANSACTION');
          statusOnlyDb.exec('ROLLBACK');
        }, 'A new transaction should not throw after a status-migration failure').not.toThrow();
      } finally {
        statusOnlyDb.close();
      }
    });
  });

  describe('file-based DB in WAL mode', () => {
    let tmpDir: string;
    let dbPath: string;
    let db: Database.Database;

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'migration-tx-safety-'));
      dbPath = path.join(tmpDir, 'apps.db');
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      stageOldImportJobs(db);
    });

    afterEach(() => {
      if (db.open) db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('wal_checkpoint(TRUNCATE) succeeds after initializeSchema (no SQLITE_LOCKED)', () => {
      initializeSchema(db);
      expectMigrationFailed(errorSpy, 'database.migration.source-type-constraint.failed');

      expect(() => db.pragma('wal_checkpoint(TRUNCATE)'), 'Performing backup should not throw exceptions.').not.toThrow();
    });

    it('writes performed after initializeSchema persist across close + reopen', () => {
      initializeSchema(db);
      expectMigrationFailed(errorSpy, 'database.migration.source-type-constraint.failed');

      db.prepare(`
        INSERT INTO apps (id, name, path, port, status)
        VALUES (?, ?, ?, ?, ?)
      `).run('post-migration-app', 'Post Migration App', '/p', 3000, 'created');

      db.close();

      const reopened = new Database(dbPath);
      try {
        const row = reopened
          .prepare('SELECT id FROM apps WHERE id = ?')
          .get('post-migration-app') as { id: string } | undefined;
        expect(row?.id).toBe('post-migration-app');
      } finally {
        reopened.close();
      }
    });
  });
});
