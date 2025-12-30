/**
 * ImportJobRepository
 *
 * Repository for managing import job records in the database.
 * Tracks the status of zip file imports, validation errors, and build output.
 */

import { nanoid } from 'nanoid';
import { getDatabase } from '../connection.js';
import { Logger } from '../../logging/index.js';
import {
  ImportJobStatus,
  type ImportJob,
  type ValidationError,
} from '../../types/import.js';

/**
 * Database row representation of an import job
 */
interface ImportJobRow {
  id: string;
  app_id: string;
  status: string;
  source_type: string;
  zip_file_name: string | null;
  zip_file_size: number | null;
  git_url: string | null;
  git_branch: string | null;
  git_commit_hash: string | null;
  extracted_path: string | null;
  detected_package_manager: string | null;
  has_build_script: number | null;
  has_dev_script: number | null;
  validation_errors: string | null;
  install_output: string | null;
  build_output: string | null;
  error_message: string | null;
  error_stage: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Parameters for creating a new import job
 */
export interface CreateImportJobParams {
  appId: string;
  sourceType: 'zip' | 'git';
  // For zip imports
  zipFileName?: string;
  zipFileSize?: number;
  // For git imports
  gitUrl?: string;
  gitBranch?: string;
}

/**
 * Parameters for updating import job status
 */
export interface UpdateImportJobParams {
  status?: ImportJobStatus;
  extractedPath?: string | undefined;
  detectedPackageManager?: 'npm' | 'yarn' | 'pnpm' | undefined;
  hasBuildScript?: boolean | undefined;
  hasDevScript?: boolean | undefined;
  validationErrors?: ValidationError[] | undefined;
  installOutput?: string | undefined;
  buildOutput?: string | undefined;
  errorMessage?: string | undefined;
  errorStage?: string | undefined;
  startedAt?: Date;
  completedAt?: Date;
  // Git-specific fields
  gitUrl?: string | undefined;
  gitBranch?: string | undefined;
  gitCommitHash?: string | undefined;
}

export class ImportJobRepository {
  private db = getDatabase();
  private logger = Logger.create({ service: 'import-job-repository' });

  /**
   * Map a database row to an ImportJob object
   *
   * @param row - Database row
   * @returns ImportJob object
   */
  private mapRowToJob(row: ImportJobRow): ImportJob {
    const job: ImportJob = {
      id: row.id,
      appId: row.app_id,
      status: row.status as ImportJobStatus,
      sourceType: row.source_type as 'zip' | 'git',
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };

    if (row.zip_file_name) job.zipFileName = row.zip_file_name;
    if (row.zip_file_size) job.zipFileSize = row.zip_file_size;
    if (row.git_url) job.gitUrl = row.git_url;
    if (row.git_branch) job.gitBranch = row.git_branch;
    if (row.git_commit_hash) job.gitCommitHash = row.git_commit_hash;
    if (row.extracted_path) job.extractedPath = row.extracted_path;
    if (row.detected_package_manager) job.detectedPackageManager = row.detected_package_manager as 'npm' | 'yarn' | 'pnpm';
    if (row.has_build_script !== null) job.hasBuildScript = row.has_build_script === 1;
    if (row.has_dev_script !== null) job.hasDevScript = row.has_dev_script === 1;
    if (row.validation_errors) job.validationErrors = row.validation_errors;
    if (row.install_output) job.installOutput = row.install_output;
    if (row.build_output) job.buildOutput = row.build_output;
    if (row.error_message) job.errorMessage = row.error_message;
    if (row.error_stage) job.errorStage = row.error_stage;
    if (row.started_at) job.startedAt = new Date(row.started_at);
    if (row.completed_at) job.completedAt = new Date(row.completed_at);

    return job;
  }

  /**
   * Create a new import job
   *
   * @param params - Job creation parameters
   * @returns Created import job
   */
  async create(params: CreateImportJobParams): Promise<ImportJob> {
    const { appId, sourceType, zipFileName, zipFileSize, gitUrl, gitBranch } = params;
    const id = nanoid();

    try {
      if (sourceType === 'zip') {
        const stmt = this.db.prepare(`
          INSERT INTO import_jobs (
            id, app_id, status, source_type,
            zip_file_name, zip_file_size
          )
          VALUES (?, ?, 'pending', 'zip', ?, ?)
        `);

        stmt.run(id, appId, zipFileName, zipFileSize);

        this.logger.info('import-job.create.success', {
          jobId: id,
          appId,
          sourceType,
          zipFileName,
          zipFileSize,
        });
      } else {
        const stmt = this.db.prepare(`
          INSERT INTO import_jobs (
            id, app_id, status, source_type,
            zip_file_name, zip_file_size,
            git_url, git_branch
          )
          VALUES (?, ?, 'pending', 'git', NULL, NULL, ?, ?)
        `);

        stmt.run(id, appId, gitUrl, gitBranch || null);

        this.logger.info('import-job.create.success', {
          jobId: id,
          appId,
          sourceType,
          gitUrl,
          gitBranch,
        });
      }

      const job = await this.findById(id);
      if (!job) {
        throw new Error('Failed to retrieve created import job');
      }

      return job;
    } catch (error) {
      this.logger.error('import-job.create.failed', {
        appId,
        sourceType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find an import job by ID
   *
   * @param id - Import job ID
   * @returns Import job or null if not found
   */
  async findById(id: string): Promise<ImportJob | null> {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM import_jobs WHERE id = ?
      `);

      const row = stmt.get(id) as ImportJobRow | undefined;

      if (!row) {
        return null;
      }

      return this.mapRowToJob(row);
    } catch (error) {
      this.logger.error('import-job.findById.failed', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find an import job by app ID (returns the most recent one)
   *
   * @param appId - App ID
   * @returns Import job or null if not found
   */
  async findByAppId(appId: string): Promise<ImportJob | null> {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM import_jobs 
        WHERE app_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `);

      const row = stmt.get(appId) as ImportJobRow | undefined;

      if (!row) {
        return null;
      }

      return this.mapRowToJob(row);
    } catch (error) {
      this.logger.error('import-job.findByAppId.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all import jobs for an app
   *
   * @param appId - App ID
   * @returns Array of import jobs
   */
  async findAllByAppId(appId: string): Promise<ImportJob[]> {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM import_jobs 
        WHERE app_id = ?
        ORDER BY created_at DESC
      `);

      const rows = stmt.all(appId) as ImportJobRow[];

      return rows.map(row => this.mapRowToJob(row));
    } catch (error) {
      this.logger.error('import-job.findAllByAppId.failed', {
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
    keyof UpdateImportJobParams,
    { column: string; transform?: (v: unknown) => unknown }
  > = {
    status: { column: 'status' },
    extractedPath: { column: 'extracted_path' },
    detectedPackageManager: { column: 'detected_package_manager' },
    hasBuildScript: { column: 'has_build_script', transform: (v) => (v ? 1 : 0) },
    hasDevScript: { column: 'has_dev_script', transform: (v) => (v ? 1 : 0) },
    validationErrors: { column: 'validation_errors', transform: (v) => JSON.stringify(v) },
    installOutput: { column: 'install_output' },
    buildOutput: { column: 'build_output' },
    errorMessage: { column: 'error_message' },
    errorStage: { column: 'error_stage' },
    startedAt: { column: 'started_at', transform: (v) => (v as Date).toISOString() },
    completedAt: { column: 'completed_at', transform: (v) => (v as Date).toISOString() },
    gitUrl: { column: 'git_url' },
    gitBranch: { column: 'git_branch' },
    gitCommitHash: { column: 'git_commit_hash' },
  };

  /**
   * Update an import job
   *
   * @param id - Import job ID
   * @param params - Update parameters
   * @returns Updated import job
   */
  async update(id: string, params: UpdateImportJobParams): Promise<ImportJob> {
    try {
      const updates: string[] = [];
      const values: unknown[] = [];

      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;

        const mapping = ImportJobRepository.FIELD_MAP[key as keyof UpdateImportJobParams];
        if (!mapping) continue;

        updates.push(`${mapping.column} = ?`);
        values.push(mapping.transform ? mapping.transform(value) : value);
      }

      if (updates.length === 0) {
        const job = await this.findById(id);
        if (!job) {
          throw new Error(`Import job not found: ${id}`);
        }
        return job;
      }

      values.push(id);

      const stmt = this.db.prepare(`
        UPDATE import_jobs 
        SET ${updates.join(', ')}
        WHERE id = ?
      `);

      stmt.run(...values);

      this.logger.info('import-job.update.success', {
        jobId: id,
        updates: Object.keys(params),
      });

      const job = await this.findById(id);
      if (!job) {
        throw new Error(`Import job not found after update: ${id}`);
      }

      return job;
    } catch (error) {
      this.logger.error('import-job.update.failed', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update import job status
   *
   * @param id - Import job ID
   * @param status - New status
   * @returns Updated import job
   */
  async updateStatus(id: string, status: ImportJobStatus): Promise<ImportJob> {
    return this.update(id, { status });
  }

  /**
   * Set validation errors on an import job
   *
   * @param id - Import job ID
   * @param errors - Validation errors
   * @returns Updated import job
   */
  async setValidationErrors(id: string, errors: ValidationError[]): Promise<ImportJob> {
    return this.update(id, { validationErrors: errors });
  }

  /**
   * Mark an import job as failed
   *
   * @param id - Import job ID
   * @param errorMessage - Error message
   * @param errorStage - Stage where error occurred
   * @param validationErrors - Optional validation errors
   * @returns Updated import job
   */
  async markFailed(
    id: string,
    errorMessage: string,
    errorStage: string,
    validationErrors?: ValidationError[]
  ): Promise<ImportJob> {
    const params: UpdateImportJobParams = {
      status: ImportJobStatus.FAILED,
      errorMessage,
      errorStage,
      completedAt: new Date(),
    };
    if (validationErrors) {
      params.validationErrors = validationErrors;
    }
    return this.update(id, params);
  }

  /**
   * Mark an import job as completed
   *
   * @param id - Import job ID
   * @returns Updated import job
   */
  async markCompleted(id: string): Promise<ImportJob> {
    return this.update(id, {
      status: ImportJobStatus.COMPLETED,
      completedAt: new Date(),
    });
  }

  /**
   * Delete an import job
   *
   * @param id - Import job ID
   * @returns True if deleted
   */
  async delete(id: string): Promise<boolean> {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM import_jobs WHERE id = ?
      `);

      const result = stmt.run(id);

      this.logger.info('import-job.delete.success', {
        jobId: id,
        deleted: result.changes > 0,
      });

      return result.changes > 0;
    } catch (error) {
      this.logger.error('import-job.delete.failed', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all pending or in-progress import jobs
   * Useful for cleanup on restart
   *
   * @returns Array of incomplete import jobs
   */
  async findIncomplete(): Promise<ImportJob[]> {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM import_jobs 
        WHERE status NOT IN ('completed', 'failed')
        ORDER BY created_at ASC
      `);

      const rows = stmt.all() as ImportJobRow[];

      return rows.map(row => this.mapRowToJob(row));
    } catch (error) {
      this.logger.error('import-job.findIncomplete.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Clean up old completed/failed import jobs
   *
   * @param maxAgeHours - Maximum age in hours
   * @returns Number of deleted jobs
   */
  async cleanup(maxAgeHours: number = 24): Promise<number> {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM import_jobs 
        WHERE status IN ('completed', 'failed')
        AND created_at < datetime('now', '-' || ? || ' hours')
      `);

      const result = stmt.run(maxAgeHours);

      this.logger.info('import-job.cleanup.success', {
        maxAgeHours,
        deleted: result.changes,
      });

      return result.changes;
    } catch (error) {
      this.logger.error('import-job.cleanup.failed', {
        maxAgeHours,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

