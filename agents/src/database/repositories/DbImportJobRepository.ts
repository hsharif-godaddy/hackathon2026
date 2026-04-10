/**
 * DbImportJobRepository
 *
 * Repository for managing database import job records in SQLite.
 * Tracks the status of SQL file imports into app MySQL databases.
 */

import { nanoid } from 'nanoid';
import { getDatabase } from '../connection.js';
import { Logger } from '../../logging/index.js';
import {
  DbImportJobStatus,
  DbImportConflictError,
  type DbImportJob,
  type CreateDbImportJobParams,
  type UpdateDbImportJobParams,
  DB_IMPORT_DEFAULTS,
} from '../../types/db-import.js';

/**
 * Database row representation of a db import job (snake_case columns)
 */
interface DbImportJobRow {
  id: string;
  app_id: string;
  status: string;
  file_name: string | null;
  file_size: number | null;
  tables_dropped: number | null;
  tables_imported: number | null;
  statements_executed: number;
  statements_total: number | null;
  bytes_processed: number;
  progress_updated_at: string | null;
  error_message: string | null;
  error_stage: string | null;
  error_code: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export class DbImportJobRepository {
  private db = getDatabase();
  private logger = Logger.create({ service: 'db-import-job-repository' });

  /**
   * Map a database row to a DbImportJob object
   */
  private mapRowToJob(row: DbImportJobRow): DbImportJob {
    const job: DbImportJob = {
      id: row.id,
      appId: row.app_id,
      status: row.status as DbImportJobStatus,
      statementsExecuted: row.statements_executed,
      bytesProcessed: row.bytes_processed,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };

    if (row.file_name) job.fileName = row.file_name;
    if (row.file_size !== null) job.fileSize = row.file_size;
    if (row.tables_dropped !== null) job.tablesDropped = row.tables_dropped;
    if (row.tables_imported !== null) job.tablesImported = row.tables_imported;
    if (row.statements_total !== null) job.statementsTotal = row.statements_total;
    if (row.progress_updated_at) job.progressUpdatedAt = new Date(row.progress_updated_at);
    if (row.error_message) job.errorMessage = row.error_message;
    if (row.error_stage) job.errorStage = row.error_stage;
    if (row.error_code) job.errorCode = row.error_code;
    if (row.started_at) job.startedAt = new Date(row.started_at);
    if (row.completed_at) job.completedAt = new Date(row.completed_at);

    return job;
  }

  /**
   * Create a new database import job
   */
  async create(params: CreateDbImportJobParams): Promise<DbImportJob> {
    const id = nanoid();

    try {
      const stmt = this.db.prepare(`
        INSERT INTO db_import_jobs (id, app_id, status, file_name, file_size, statements_total)
        VALUES (?, ?, 'pending', ?, ?, ?)
      `);

      stmt.run(id, params.appId, params.fileName ?? null, params.fileSize ?? null, params.statementsTotal ?? null);

      this.logger.info('db-import-job.create.success', {
        jobId: id,
        appId: params.appId,
        fileName: params.fileName,
        fileSize: params.fileSize,
      });

      const job = await this.findById(id);
      if (!job) {
        throw new Error('Failed to retrieve created db import job');
      }

      return job;
    } catch (error) {
      this.logger.error('db-import-job.create.failed', {
        appId: params.appId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Atomically check for active jobs and create a new one.
   * Throws DbImportConflictError if an active (non-terminal) job already exists for the app.
   * Uses a SQLite transaction to prevent TOCTOU race conditions.
   */
  createIfNoActiveJob(params: CreateDbImportJobParams): DbImportJob {
    const id = nanoid();

    const createTxn = this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT id FROM db_import_jobs
        WHERE app_id = ? AND status NOT IN ('completed', 'failed')
        LIMIT 1
      `).get(params.appId) as { id: string } | undefined;

      if (existing) {
        throw new DbImportConflictError(existing.id);
      }

      this.db.prepare(`
        INSERT INTO db_import_jobs (id, app_id, status, file_name, file_size, statements_total)
        VALUES (?, ?, 'pending', ?, ?, ?)
      `).run(id, params.appId, params.fileName ?? null, params.fileSize ?? null, params.statementsTotal ?? null);
    });

    createTxn();

    this.logger.info('db-import-job.create.success', {
      jobId: id,
      appId: params.appId,
      fileName: params.fileName,
      fileSize: params.fileSize,
    });

    const row = this.db.prepare('SELECT * FROM db_import_jobs WHERE id = ?').get(id) as DbImportJobRow;
    return this.mapRowToJob(row);
  }

  /**
   * Find a database import job by ID
   */
  async findById(id: string): Promise<DbImportJob | null> {
    try {
      const stmt = this.db.prepare(`SELECT * FROM db_import_jobs WHERE id = ?`);
      const row = stmt.get(id) as DbImportJobRow | undefined;
      return row ? this.mapRowToJob(row) : null;
    } catch (error) {
      this.logger.error('db-import-job.findById.failed', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find the most recent database import job for an app
   */
  async findByAppId(appId: string): Promise<DbImportJob | null> {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM db_import_jobs
        WHERE app_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const row = stmt.get(appId) as DbImportJobRow | undefined;
      return row ? this.mapRowToJob(row) : null;
    } catch (error) {
      this.logger.error('db-import-job.findByAppId.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find any active (non-terminal) database import job for an app.
   * Used for the concurrency guard.
   */
  async findActiveByAppId(appId: string): Promise<DbImportJob | null> {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM db_import_jobs
        WHERE app_id = ?
          AND status NOT IN ('completed', 'failed')
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const row = stmt.get(appId) as DbImportJobRow | undefined;
      return row ? this.mapRowToJob(row) : null;
    } catch (error) {
      this.logger.error('db-import-job.findActiveByAppId.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Map param keys to database columns with optional value transformers
   */
  private static readonly FIELD_MAP: Record<
    keyof UpdateDbImportJobParams,
    { column: string; transform?: (v: unknown) => unknown }
  > = {
    status: { column: 'status' },
    fileName: { column: 'file_name' },
    fileSize: { column: 'file_size' },
    tablesDropped: { column: 'tables_dropped' },
    tablesImported: { column: 'tables_imported' },
    statementsExecuted: { column: 'statements_executed' },
    statementsTotal: { column: 'statements_total' },
    bytesProcessed: { column: 'bytes_processed' },
    progressUpdatedAt: { column: 'progress_updated_at', transform: (v) => (v as Date).toISOString() },
    errorMessage: { column: 'error_message' },
    errorStage: { column: 'error_stage' },
    errorCode: { column: 'error_code' },
    startedAt: { column: 'started_at', transform: (v) => (v as Date).toISOString() },
    completedAt: { column: 'completed_at', transform: (v) => (v as Date).toISOString() },
  };

  /**
   * Update a database import job
   */
  async update(id: string, params: UpdateDbImportJobParams): Promise<DbImportJob> {
    try {
      const updates: string[] = [];
      const values: unknown[] = [];

      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;

        const mapping = DbImportJobRepository.FIELD_MAP[key as keyof UpdateDbImportJobParams];
        if (!mapping) continue;

        updates.push(`${mapping.column} = ?`);
        values.push(mapping.transform ? mapping.transform(value) : value);
      }

      if (updates.length === 0) {
        const job = await this.findById(id);
        if (!job) {
          throw new Error(`DB import job not found: ${id}`);
        }
        return job;
      }

      values.push(id);

      const stmt = this.db.prepare(`
        UPDATE db_import_jobs
        SET ${updates.join(', ')}
        WHERE id = ?
      `);

      stmt.run(...values);

      this.logger.info('db-import-job.update.success', {
        jobId: id,
        updates: Object.keys(params),
      });

      const job = await this.findById(id);
      if (!job) {
        throw new Error(`DB import job not found after update: ${id}`);
      }

      return job;
    } catch (error) {
      this.logger.error('db-import-job.update.failed', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update progress metrics with throttling.
   * Only writes to SQLite every N statements or every M seconds.
   */
  async updateProgress(
    id: string,
    statementsExecuted: number,
    bytesProcessed: number,
    lastWriteTime: number
  ): Promise<{ written: boolean; writeTime: number }> {
    const now = Date.now();
    const sinceLastWrite = now - lastWriteTime;
    const shouldWrite =
      statementsExecuted % DB_IMPORT_DEFAULTS.progressWriteInterval === 0 ||
      sinceLastWrite >= DB_IMPORT_DEFAULTS.progressWriteTimeInterval;

    if (!shouldWrite) {
      return { written: false, writeTime: lastWriteTime };
    }

    try {
      const stmt = this.db.prepare(`
        UPDATE db_import_jobs
        SET statements_executed = ?, bytes_processed = ?, progress_updated_at = ?
        WHERE id = ?
      `);

      stmt.run(statementsExecuted, bytesProcessed, new Date().toISOString(), id);

      return { written: true, writeTime: now };
    } catch (error) {
      this.logger.error('db-import-job.updateProgress.failed', {
        jobId: id,
        statementsExecuted,
        bytesProcessed,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Mark a database import job as failed
   */
  async markFailed(
    id: string,
    errorMessage: string,
    errorStage: string,
    errorCode?: string,
  ): Promise<DbImportJob> {
    const params: UpdateDbImportJobParams = {
      status: DbImportJobStatus.FAILED,
      errorMessage,
      errorStage,
      completedAt: new Date(),
    };
    if (errorCode) {
      params.errorCode = errorCode;
    }
    return this.update(id, params);
  }

  /**
   * Mark a database import job as completed
   */
  async markCompleted(id: string, tablesImported?: number): Promise<DbImportJob> {
    const params: UpdateDbImportJobParams = {
      status: DbImportJobStatus.COMPLETED,
      completedAt: new Date(),
    };
    if (tablesImported !== undefined) {
      params.tablesImported = tablesImported;
    }
    return this.update(id, params);
  }

  /**
   * List database import jobs for an app with pagination
   */
  async listByAppId(
    appId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{ jobs: DbImportJob[]; total: number }> {
    try {
      const countStmt = this.db.prepare(`
        SELECT COUNT(*) as total FROM db_import_jobs WHERE app_id = ?
      `);
      const countResult = countStmt.get(appId) as { total: number };
      const total = countResult.total;

      const offset = (page - 1) * limit;
      const stmt = this.db.prepare(`
        SELECT * FROM db_import_jobs
        WHERE app_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `);
      const rows = stmt.all(appId, limit, offset) as DbImportJobRow[];

      return {
        jobs: rows.map(row => this.mapRowToJob(row)),
        total,
      };
    } catch (error) {
      this.logger.error('db-import-job.listByAppId.failed', {
        appId,
        page,
        limit,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
