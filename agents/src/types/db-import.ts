/**
 * Database Import Types
 *
 * TypeScript interfaces for the database import feature.
 * These types define the structure for DB import jobs, error codes,
 * and related data used throughout the import process.
 */

/**
 * Status values for database import jobs
 */
export enum DbImportJobStatus {
  PENDING = 'pending',
  VALIDATING = 'validating',
  DROPPING_TABLES = 'dropping_tables',
  IMPORTING = 'importing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/** Terminal statuses that indicate a job is no longer active */
export const DB_IMPORT_TERMINAL_STATUSES: ReadonlySet<DbImportJobStatus> = new Set([
  DbImportJobStatus.COMPLETED,
  DbImportJobStatus.FAILED,
]);

/**
 * Error codes for database import failures
 */
export enum DbImportErrorCode {
  // Upload errors
  FILE_MISSING = 'FILE_MISSING',
  FILE_INVALID_EXTENSION = 'FILE_INVALID_EXTENSION',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  FILE_EMPTY = 'FILE_EMPTY',
  IMPORT_ALREADY_IN_PROGRESS = 'IMPORT_ALREADY_IN_PROGRESS',
  // Validation errors
  DB_CONNECTION_FAILED = 'DB_CONNECTION_FAILED',
  DB_CREDENTIALS_NOT_FOUND = 'DB_CREDENTIALS_NOT_FOUND',
  // Drop errors
  DROP_TABLES_FAILED = 'DROP_TABLES_FAILED',
  // Import errors
  SQL_EXECUTION_FAILED = 'SQL_EXECUTION_FAILED',
  SQL_PARSE_ERROR = 'SQL_PARSE_ERROR',
  IMPORT_TIMEOUT = 'IMPORT_TIMEOUT',
  STATEMENT_TOO_LARGE = 'STATEMENT_TOO_LARGE',
  CONNECTION_LOST = 'CONNECTION_LOST',
  // System errors
  DISK_SPACE_EXHAUSTED = 'DISK_SPACE_EXHAUSTED',
  UNSUPPORTED_STATEMENT = 'UNSUPPORTED_STATEMENT',
  AGENT_RESTART = 'AGENT_RESTART',
}

export class DbImportConflictError extends Error {
  public existingJobId: string;
  constructor(existingJobId: string) {
    super('Another database import is already in progress');
    this.name = 'DbImportConflictError';
    this.existingJobId = existingJobId;
  }
}

/**
 * Database import job record stored in SQLite
 */
export interface DbImportJob {
  id: string;
  appId: string;
  status: DbImportJobStatus;
  fileName?: string;
  fileSize?: number;
  tablesDropped?: number;
  tablesImported?: number;
  statementsExecuted: number;
  statementsTotal?: number;
  bytesProcessed: number;
  progressUpdatedAt?: Date;
  errorMessage?: string;
  errorStage?: string;
  errorCode?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Parameters for creating a new DB import job
 */
export interface CreateDbImportJobParams {
  appId: string;
  fileName?: string;
  fileSize?: number;
  statementsTotal?: number;
}

/**
 * Parameters for updating a DB import job
 */
export interface UpdateDbImportJobParams {
  status?: DbImportJobStatus;
  fileName?: string;
  fileSize?: number;
  tablesDropped?: number;
  tablesImported?: number;
  statementsExecuted?: number;
  statementsTotal?: number;
  bytesProcessed?: number;
  progressUpdatedAt?: Date;
  errorMessage?: string;
  errorStage?: string;
  errorCode?: string;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Progress information for the status API response
 */
export interface DbImportProgress {
  stage: string;
  statementsExecuted?: number;
  statementsTotal?: number;
  bytesProcessed?: number;
  bytesTotal?: number;
  message: string;
}

/**
 * Response from POST /apps/:id/database/import
 */
export interface DbImportUploadResponse {
  success: boolean;
  appId: string;
  jobId: string;
  status: DbImportJobStatus;
}

/**
 * Response from GET /apps/:id/database/import/:jobId
 */
export interface DbImportStatusResponse {
  jobId: string;
  appId: string;
  status: DbImportJobStatus;
  fileName?: string;
  fileSize?: number;
  progress: DbImportProgress;
  tablesImported?: number;
  errorStage?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
}

/**
 * Response from GET /apps/:id/database/import (list)
 */
export interface DbImportListResponse {
  jobs: DbImportStatusResponse[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Default configuration values for database import
 */
export const DB_IMPORT_DEFAULTS = {
  /** Maximum upload size in bytes (100MB) */
  maxFileSize: parseInt(process.env.MAX_DB_IMPORT_SIZE || '104857600', 10),
  /** Temporary directory for uploads */
  tempDir: process.env.DB_IMPORT_TEMP_DIR || '/tmp/airo-db-imports',
  /** Per-statement execution timeout in ms (5 minutes) */
  statementTimeout: parseInt(process.env.DB_IMPORT_STATEMENT_TIMEOUT || '300000', 10),
  /** Overall import timeout in ms (30 minutes) */
  overallTimeout: parseInt(process.env.DB_IMPORT_OVERALL_TIMEOUT || '1800000', 10),
  /** Number of statements per transaction batch (reduces fsync overhead) */
  transactionBatchSize: parseInt(process.env.DB_IMPORT_TRANSACTION_BATCH_SIZE || '1000', 10),
  /** Number of statements between progress writes */
  progressWriteInterval: 500,
  /** Minimum time between progress writes in ms */
  progressWriteTimeInterval: 5000,
} as const;
