/**
 * Database Import Routes
 *
 * API endpoints for importing SQL dumps into app MySQL databases.
 *
 * POST /apps/:id/database/import       — Upload SQL dump
 * GET  /apps/:id/database/import/:jobId — Poll job status
 * GET  /apps/:id/database/import        — List jobs
 */

import { Router, Request, Response } from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { DbImportJobRepository } from '../../database/repositories/DbImportJobRepository.js';
import { DatabaseImportService } from '../../services/DatabaseImportService.js';
import { Logger, log } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import {
  DbImportJobStatus,
  DbImportConflictError,
  DB_IMPORT_DEFAULTS,
  type DbImportJob,
  type DbImportProgress,
  type DbImportStatusResponse,
} from '../../types/db-import.js';

const router: Router = Router();
const appRepo = new AppRepository();
const dbImportJobRepo = new DbImportJobRepository();
const importService = new DatabaseImportService(dbImportJobRepo, appRepo);
const logger = Logger.create({ service: 'db-import-routes' });

// Ensure temp directory exists
const TEMP_DIR = DB_IMPORT_DEFAULTS.tempDir;
if (!existsSync(TEMP_DIR)) {
  mkdirSync(TEMP_DIR, { recursive: true });
}

// =============================================================================
// Multer configuration for SQL file uploads
// =============================================================================

const sqlUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, TEMP_DIR);
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${nanoid(8)}`;
      cb(null, `db-import-${uniqueSuffix}.sql`);
    },
  }),
  limits: {
    fileSize: DB_IMPORT_DEFAULTS.maxFileSize,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      'application/sql',
      'text/sql',
      'text/plain',
      'application/octet-stream',
    ];

    if (allowedMimeTypes.includes(file.mimetype) || file.originalname.toLowerCase().endsWith('.sql')) {
      cb(null, true);
    } else {
      cb(new Error('Only .sql files are allowed'));
    }
  },
});

// =============================================================================
// Apply middleware
// =============================================================================

// SECURITY: Ownership validation on all routes
router.use('/apps/:id', validateAppOwnership);

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /apps/:id/database/import — Upload SQL dump for import
 */
router.post(
  '/apps/:id/database/import',
  async (req: Request, res: Response): Promise<void> => {
    const appId = req.params.id;
    if (!appId) {
      res.status(400).json({ success: false, error: 'App ID is required' });
      return;
    }

    logger.info('db-import.upload.begin', { appId });

    // Check app exists (before multer — no file saved yet)
    const app = appRepo.findById(appId);
    if (!app) {
      logger.warn('db-import.upload.app_not_found', { appId });
      res.status(404).json({ success: false, error: 'App not found' });
      return;
    }

    // Handle file upload via multer
    const upload = sqlUpload.single('sqlFile');

    upload(req, res, async (multerErr) => {
      if (multerErr) {
        const contextLogger = appId ? log.forApp(appId) : logger;

        if (multerErr instanceof multer.MulterError && multerErr.code === 'LIMIT_FILE_SIZE') {
          log.error(contextLogger, 'db-import.upload.too_large', multerErr, { appId });
          res.status(413).json({
            success: false,
            error: `File exceeds maximum size of ${Math.round(DB_IMPORT_DEFAULTS.maxFileSize / 1024 / 1024)}MB`,
          });
          return;
        }

        log.error(contextLogger, 'db-import.upload.multer_error', multerErr, { appId });
        res.status(400).json({
          success: false,
          error: multerErr.message || 'Upload failed',
        });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ success: false, error: 'No file provided' });
        return;
      }

      // Validate file extension
      if (!file.originalname.toLowerCase().endsWith('.sql')) {
        await cleanupFile(file.path);
        res.status(400).json({
          success: false,
          error: 'Only .sql files are accepted',
        });
        return;
      }

      // Validate non-empty
      if (file.size === 0) {
        await cleanupFile(file.path);
        res.status(400).json({
          success: false,
          error: 'File is empty',
        });
        return;
      }

      try {
        // Concurrency guard is atomic inside startImport → createIfNoActiveJob
        const job = await importService.startImport(
          appId,
          file.path,
          file.originalname,
          file.size,
        );

        res.status(202).json({
          success: true,
          appId,
          jobId: job.id,
          status: job.status,
        });
      } catch (error) {
        await cleanupFile(file.path);

        if (error instanceof DbImportConflictError) {
          logger.warn('db-import.upload.conflict', { appId, existingJobId: error.existingJobId });
          res.status(409).json({
            success: false,
            error: 'Another database import is already in progress',
            existingJobId: error.existingJobId,
          });
          return;
        }

        const contextLogger = appId ? log.forApp(appId) : logger;
        log.error(contextLogger, 'db-import.upload.failed', error as Error, { appId });
        res.status(500).json({
          success: false,
          error: 'Failed to start database import',
        });
      }
    });
  },
);

/**
 * GET /apps/:id/database/import/:jobId — Poll import job status
 */
router.get(
  '/apps/:id/database/import/:jobId',
  async (req: Request, res: Response): Promise<void> => {
    const appId = req.params.id;
    const jobId = req.params.jobId;
    if (!appId || !jobId) {
      res.status(400).json({ error: 'App ID and Job ID are required' });
      return;
    }

    try {
      const job = await dbImportJobRepo.findById(jobId);

      if (!job || job.appId !== appId) {
        res.status(404).json({ error: 'Import job not found' });
        return;
      }

      res.json(buildStatusResponse(job));
    } catch (error) {
      const contextLogger = appId ? log.forApp(appId) : logger;
      log.error(contextLogger, 'db-import.status.failed', error as Error, { appId, jobId });
      res.status(500).json({
        error: 'Failed to retrieve import status',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

/**
 * GET /apps/:id/database/import — List import jobs for app
 */
router.get(
  '/apps/:id/database/import',
  async (req: Request, res: Response): Promise<void> => {
    const appId = req.params.id;
    if (!appId) {
      res.status(400).json({ error: 'App ID is required' });
      return;
    }
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 10), 100);

    try {
      const { jobs, total } = await dbImportJobRepo.listByAppId(appId, page, limit);

      res.json({
        jobs: jobs.map(buildStatusResponse),
        total,
        page,
        limit,
      });
    } catch (error) {
      const contextLogger = appId ? log.forApp(appId) : logger;
      log.error(contextLogger, 'db-import.list.failed', error as Error, { appId });
      res.status(500).json({
        error: 'Failed to list import jobs',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build progress object for a given job status
 */
function buildProgress(job: DbImportJob): DbImportProgress {
  const stageMessages: Record<string, string> = {
    pending: 'Preparing import...',
    validating: 'Validating database connection...',
    dropping_tables: 'Dropping existing tables...',
    importing: job.statementsTotal
      ? `Executing SQL import... (${job.statementsExecuted}/~${job.statementsTotal} statements)`
      : `Executing SQL import... (${job.statementsExecuted} statements)`,
    completed: 'Database import completed successfully',
    failed: 'Import failed',
  };

  const progress: DbImportProgress = {
    stage: job.status,
    message: stageMessages[job.status] || job.status,
  };

  // Include detailed progress for importing stage
  if (job.status === DbImportJobStatus.IMPORTING) {
    progress.statementsExecuted = job.statementsExecuted;
    if (job.statementsTotal) {
      progress.statementsTotal = job.statementsTotal;
    }
    progress.bytesProcessed = job.bytesProcessed;
    if (job.fileSize) {
      progress.bytesTotal = job.fileSize;
    }
  }

  return progress;
}

/**
 * Build API response from a job record
 */
function buildStatusResponse(job: DbImportJob): DbImportStatusResponse {
  const response: DbImportStatusResponse = {
    jobId: job.id,
    appId: job.appId,
    status: job.status,
    progress: buildProgress(job),
    createdAt: job.createdAt.toISOString(),
  };

  if (job.fileName) response.fileName = job.fileName;
  if (job.fileSize !== undefined) response.fileSize = job.fileSize;
  if (job.tablesImported !== undefined) response.tablesImported = job.tablesImported;
  if (job.errorStage) response.errorStage = job.errorStage;
  if (job.errorCode) response.errorCode = job.errorCode;
  if (job.updatedAt) response.updatedAt = job.updatedAt.toISOString();
  if (job.completedAt) response.completedAt = job.completedAt.toISOString();

  return response;
}

/**
 * Best-effort cleanup of a temp file
 */
async function cleanupFile(filePath: string): Promise<void> {
  try {
    await rm(filePath, { force: true });
  } catch {
    // Ignore cleanup errors
  }
}

export default router;
