/**
 * DatabaseImportService
 *
 * Orchestrates the database import pipeline:
 * 1. Validate MySQL connection
 * 2. Drop existing user tables
 * 3. Stream and execute SQL statements
 * 4. Track progress and handle errors
 */

import { createReadStream, existsSync } from 'node:fs';
import { rm, mkdir } from 'node:fs/promises';
import type mysql from 'mysql2/promise';
import { Logger } from '../logging/index.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { DbImportJobRepository } from '../database/repositories/DbImportJobRepository.js';
import { MySQLUtils, isSystemTable } from '../utils/mysql-utils.js';
import type { DatabaseCredentials } from '../utils/mysql-utils.js';
import { SqlStatementSplitter } from './SqlStatementSplitter.js';
import {
  DbImportJobStatus,
  DbImportErrorCode,
  DB_IMPORT_DEFAULTS,
  type DbImportJob,
} from '../types/db-import.js';

export class DatabaseImportService {
  private logger = Logger.create({ service: 'database-import' });
  private dbImportJobRepo: DbImportJobRepository;
  private appRepo: AppRepository;
  private mysqlUtils: MySQLUtils;

  constructor(
    dbImportJobRepo?: DbImportJobRepository,
    appRepo?: AppRepository,
    mysqlUtils?: MySQLUtils,
  ) {
    this.dbImportJobRepo = dbImportJobRepo ?? new DbImportJobRepository();
    this.appRepo = appRepo ?? new AppRepository();
    this.mysqlUtils = mysqlUtils ?? new MySQLUtils();
  }

  /**
   * Create a job and kick off background processing. Returns immediately.
   */
  async startImport(
    appId: string,
    filePath: string,
    fileName: string,
    fileSize: number,
  ): Promise<DbImportJob> {
    // Estimate statement count (fast pre-scan)
    let statementsTotal: number | undefined;
    try {
      statementsTotal = await SqlStatementSplitter.estimateStatementCount(filePath);
    } catch {
      // Non-critical — progress will just lack a total
    }

    const job = this.dbImportJobRepo.createIfNoActiveJob({
      appId,
      fileName,
      fileSize,
      statementsTotal,
    });

    this.logger.info('db-import.upload.accepted', {
      appId,
      jobId: job.id,
      fileName,
      fileSize,
      statementsTotal,
    });

    // Fire-and-forget background processing
    this.processImport(job.id, appId, filePath).catch(error => {
      this.logger.error('db-import.background.failed', {
        jobId: job.id,
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return job;
  }

  /**
   * Background import pipeline
   */
  private async processImport(jobId: string, appId: string, filePath: string): Promise<void> {
    let connection: mysql.PoolConnection | null = null;
    let overallTimer: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    let importAbortController: AbortController | null = null;

    try {
      // Set overall timeout — actively aborts connection + stream when fired
      overallTimer = setTimeout(() => {
        timedOut = true;
        this.logger.warn('db-import.timeout', { jobId, appId });
        if (connection) {
          try { connection.destroy(); } catch { /* ignore */ }
        }
        if (importAbortController) {
          importAbortController.abort();
        }
      }, DB_IMPORT_DEFAULTS.overallTimeout);

      // Stage 1: Validating
      await this.dbImportJobRepo.update(jobId, {
        status: DbImportJobStatus.VALIDATING,
        startedAt: new Date(),
      });
      this.logger.info('db-import.validate.begin', { jobId, appId });

      const app = this.appRepo.findById(appId);
      if (!app) {
        await this.dbImportJobRepo.markFailed(
          jobId, 'App not found', 'validating', DbImportErrorCode.DB_CREDENTIALS_NOT_FOUND,
        );
        return;
      }

      let credentials: DatabaseCredentials;
      try {
        credentials = await this.mysqlUtils.loadCredentialsFromApp(app);
      } catch (error) {
        await this.dbImportJobRepo.markFailed(
          jobId,
          error instanceof Error ? error.message : 'Failed to load credentials',
          'validating',
          DbImportErrorCode.DB_CREDENTIALS_NOT_FOUND,
        );
        return;
      }

      // Test connection
      try {
        connection = await this.mysqlUtils.createConnection(credentials);
      } catch (error) {
        await this.dbImportJobRepo.markFailed(
          jobId,
          error instanceof Error ? error.message : 'Connection failed',
          'validating',
          DbImportErrorCode.DB_CONNECTION_FAILED,
        );
        return;
      }

      this.logger.info('db-import.validate.complete', { jobId, appId });

      if (timedOut) {
        await this.handleTimeout(jobId);
        return;
      }

      // Stage 2: Dropping tables
      await this.dbImportJobRepo.update(jobId, {
        status: DbImportJobStatus.DROPPING_TABLES,
      });
      this.logger.info('db-import.drop.begin', { jobId, appId });

      try {
        const tablesDropped = await this.dropUserTables(connection);
        await this.dbImportJobRepo.update(jobId, { tablesDropped });
        this.logger.info('db-import.drop.complete', { jobId, appId, tablesDropped });
      } catch (error) {
        await this.dbImportJobRepo.markFailed(
          jobId,
          error instanceof Error ? error.message : 'Failed to drop tables',
          'dropping_tables',
          DbImportErrorCode.DROP_TABLES_FAILED,
        );
        return;
      }

      if (timedOut) {
        await this.handleTimeout(jobId);
        return;
      }

      // Stage 3: Importing
      await this.dbImportJobRepo.update(jobId, {
        status: DbImportJobStatus.IMPORTING,
      });
      this.logger.info('db-import.import.begin', { jobId, appId });

      try {
        importAbortController = new AbortController();
        await this.executeImport(jobId, appId, connection, filePath, importAbortController.signal);
      } catch (error) {
        if (timedOut) {
          await this.handleTimeout(jobId);
          return;
        }

        const errorCode = this.classifyError(error);
        await this.dbImportJobRepo.markFailed(
          jobId,
          error instanceof Error ? error.message : 'SQL execution failed',
          'importing',
          errorCode,
        );
        return;
      }

      if (timedOut) {
        await this.handleTimeout(jobId);
        return;
      }

      // Stage 4: Completed — count tables
      let tablesImported = 0;
      try {
        const [rows] = await connection.query('SHOW TABLES');
        tablesImported = (rows as any[]).filter(
          row => !isSystemTable(Object.values(row)[0] as string),
        ).length;
      } catch {
        // Non-critical
      }

      await this.dbImportJobRepo.markCompleted(jobId, tablesImported);
      this.logger.info('db-import.import.complete', { jobId, appId, tablesImported });

    } catch (error) {
      // Catch-all for unexpected errors
      this.logger.error('db-import.import.failed', {
        jobId,
        appId,
        error: error instanceof Error ? error.message : String(error),
      });

      try {
        await this.dbImportJobRepo.markFailed(
          jobId,
          error instanceof Error ? error.message : 'Unexpected error',
          'unknown',
          DbImportErrorCode.SQL_EXECUTION_FAILED,
        );
      } catch {
        // Best effort
      }
    } finally {
      if (overallTimer) clearTimeout(overallTimer);

      // Close MySQL connection
      if (connection) {
        try { connection.release(); } catch { /* ignore */ }
      }

      // Clean up temp file
      await this.cleanupTempFile(filePath, jobId);
    }
  }

  /**
   * Drop all user tables (excluding system tables)
   */
  private async dropUserTables(connection: mysql.PoolConnection): Promise<number> {
    const [rows] = await connection.query('SHOW TABLES');
    const tables = (rows as any[])
      .map(row => Object.values(row)[0] as string)
      .filter(name => !isSystemTable(name));

    if (tables.length === 0) return 0;

    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const table of tables) {
      // Use backticks for safe quoting
      await connection.query(`DROP TABLE IF EXISTS \`${table.replace(/`/g, '``')}\``);
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    return tables.length;
  }

  /**
   * Stream the SQL file and execute statements sequentially
   */
  private async executeImport(
    jobId: string,
    appId: string,
    connection: mysql.PoolConnection,
    filePath: string,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    // Set up import environment
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query('SET NAMES utf8mb4');

    const splitter = new SqlStatementSplitter();
    const streamOptions: { encoding: BufferEncoding; highWaterMark: number; signal?: AbortSignal } = {
      encoding: 'utf8',
      highWaterMark: 64 * 1024,
    };
    if (abortSignal) {
      streamOptions.signal = abortSignal;
    }
    const stream = createReadStream(filePath, streamOptions);
    const batchSize = DB_IMPORT_DEFAULTS.transactionBatchSize;

    let statementsExecuted = 0;
    let bytesProcessed = 0;
    let lastProgressWrite = Date.now();
    let batchCount = 0;
    let inTransaction = false;

    try {
      for await (const chunk of stream) {
        const chunkStr = chunk as string;
        bytesProcessed += Buffer.byteLength(chunkStr, 'utf8');

        const statements = splitter.splitStatements(chunkStr);
        for (const stmt of statements) {
          // Start a new transaction batch
          if (!inTransaction) {
            await connection.query('START TRANSACTION');
            inTransaction = true;
            batchCount = 0;
          }

          await connection.query({ sql: stmt, timeout: DB_IMPORT_DEFAULTS.statementTimeout }); // nosemgrep: node-mysql-sqli — stmt is sanitized by SqlStatementSplitter.sanitizeStatement
          statementsExecuted++;
          batchCount++;

          // Commit when batch is full
          if (batchCount >= batchSize) {
            await connection.query('COMMIT');
            inTransaction = false;
          }

          // Throttled progress update (non-critical — don't abort import on write failure)
          try {
            const progressResult = await this.dbImportJobRepo.updateProgress(
              jobId,
              statementsExecuted,
              bytesProcessed,
              lastProgressWrite,
            );
            if (progressResult.written) {
              lastProgressWrite = progressResult.writeTime;
            }
          } catch (progressError) {
            this.logger.warn('db-import.progress.write_failed', {
              jobId,
              statementsExecuted,
              error: progressError instanceof Error ? progressError.message : String(progressError),
            });
          }
        }
      }

      // Flush remaining buffered statement
      const remaining = splitter.flush();
      for (const stmt of remaining) {
        if (!inTransaction) {
          await connection.query('START TRANSACTION');
          inTransaction = true;
        }
        await connection.query({ sql: stmt, timeout: DB_IMPORT_DEFAULTS.statementTimeout }); // nosemgrep: node-mysql-sqli — stmt is sanitized by SqlStatementSplitter.sanitizeStatement
        statementsExecuted++;
      }

      // Commit any remaining transaction
      if (inTransaction) {
        await connection.query('COMMIT');
        inTransaction = false;
      }
    } catch (error) {
      if (inTransaction) {
        try { await connection.query('ROLLBACK'); } catch { /* connection may be dead */ }
      }
      throw error;
    }

    // Final progress write
    await this.dbImportJobRepo.update(jobId, {
      statementsExecuted,
      bytesProcessed,
    });

    // Restore foreign key checks
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    } catch {
      // Non-critical
    }

    this.logger.info('db-import.import.progress', {
      jobId,
      appId,
      statementsExecuted,
      bytesProcessed,
    });
  }

  /**
   * Handle overall timeout
   */
  private async handleTimeout(jobId: string): Promise<void> {
    await this.dbImportJobRepo.markFailed(
      jobId,
      'Import exceeded overall time limit',
      'importing',
      DbImportErrorCode.IMPORT_TIMEOUT,
    );
  }

  /**
   * Classify a MySQL error into an error code
   */
  private classifyError(error: unknown): DbImportErrorCode {
    if (!(error instanceof Error)) return DbImportErrorCode.SQL_EXECUTION_FAILED;

    const msg = error.message.toLowerCase();

    if (msg.includes('net_packet_too_large') || msg.includes('max_allowed_packet')) {
      return DbImportErrorCode.STATEMENT_TOO_LARGE;
    }
    if (msg.includes('connection lost') || msg.includes('econnreset') || msg.includes('epipe')) {
      return DbImportErrorCode.CONNECTION_LOST;
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return DbImportErrorCode.IMPORT_TIMEOUT;
    }
    if (msg.includes('syntax') || msg.includes('parse')) {
      return DbImportErrorCode.SQL_PARSE_ERROR;
    }
    if (msg.includes('access denied')) {
      return DbImportErrorCode.DB_CONNECTION_FAILED;
    }
    if (msg.includes('no space') || msg.includes('disk full')) {
      return DbImportErrorCode.DISK_SPACE_EXHAUSTED;
    }

    return DbImportErrorCode.SQL_EXECUTION_FAILED;
  }

  /**
   * Clean up the temporary SQL file
   */
  private async cleanupTempFile(filePath: string, jobId: string): Promise<void> {
    try {
      if (existsSync(filePath)) {
        await rm(filePath, { force: true });
        this.logger.info('db-import.cleanup.complete', { jobId, filePath });
      }
    } catch (error) {
      this.logger.warn('db-import.cleanup.failed', {
        jobId,
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Ensure the temp upload directory exists
   */
  static async ensureTempDir(): Promise<void> {
    await mkdir(DB_IMPORT_DEFAULTS.tempDir, { recursive: true });
  }
}
