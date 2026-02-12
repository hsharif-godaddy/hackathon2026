import { Router, Request, Response, NextFunction } from 'express';
import { rm } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { ImportJobRepository } from '../../database/repositories/ImportJobRepository.js';
import { Logger, log } from '../../logging/index.js';
import { projectImportService } from '../../services/ProjectImportService.js';
import { zipSecurityService } from '../../services/ZipSecurityService.js';
import { getZipImportLimits } from '../../services/features.js';
import {
  ImportJobStatus,
  type CreateImportResponse,
  type ImportStatusResponse,
  type ImportProgress,
  type ValidationError,
} from '../../types/import.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { isCapabilityEnabled } from '../../utils/capability-config.js';

const router: Router = Router();
const appRepository = new AppRepository();
const zipLogger = Logger.create({ service: 'zip-import-routes' });

// =============================================================================
// SHARED ZIP IMPORT INFRASTRUCTURE
// These exports are used by both zip-import.ts and git.ts routes
// =============================================================================

/**
 * Repository for import job tracking
 */
export const importJobRepo = new ImportJobRepository();

/**
 * Temporary directory for zip uploads before validation
 *
 * @see docs/zip-import-plan.md for design decision rationale
 */
const TEMP_UPLOAD_DIR = process.env.IMPORT_TEMP_DIR || '/tmp/airo-imports';
if (!existsSync(TEMP_UPLOAD_DIR)) {
  mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
}

/**
 * Configure multer for zip file uploads
 *
 * Files are stored in TEMP_UPLOAD_DIR until validated, then copied to the
 * app's shared mount for container-side processing.
 */
export const zipUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, TEMP_UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${nanoid(8)}`;
      cb(null, `import-${uniqueSuffix}.zip`);
    },
  }),
  limits: {
    fileSize: getZipImportLimits().maxZipSize,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      'application/zip',
      'application/x-zip-compressed',
      'application/x-zip',
      'multipart/x-zip',
    ];

    if (allowedMimeTypes.includes(file.mimetype) || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'));
    }
  },
});

/**
 * Middleware to check if zip import feature is enabled
 *
 * Requires ENABLE_ZIP_IMPORT=true environment variable or CODE_SYNC_ZIP_UPLOAD capability.
 */
export function requireZipImportFeature(req: Request, res: Response, next: NextFunction): void {
  const isZipUploadEnabled: boolean = process.env.ENABLE_ZIP_IMPORT === 'true' || isCapabilityEnabled("CODE_SYNC_ZIP_UPLOAD");
  if (!isZipUploadEnabled) {
    res.status(403).json({
      success: false,
      error: 'Zip import feature is not enabled',
      details: 'Enable CODE_SYNC_ZIP_UPLOAD capability via /alloc/config.json',
    });
    return;
  }

  next();
}

/**
 * Ordered list of import stages for progress tracking
 */
export const STAGE_ORDER: ImportJobStatus[] = [
  ImportJobStatus.PENDING,
  ImportJobStatus.CREATING_CONTAINER,
  ImportJobStatus.EXTRACTING,
  ImportJobStatus.VALIDATING,
  ImportJobStatus.COPYING,
  ImportJobStatus.INSTALLING,
  ImportJobStatus.BUILDING,
  ImportJobStatus.COMMITTING,
  ImportJobStatus.RESTARTING,
  ImportJobStatus.COMPLETED,
];

export const STAGE_MESSAGES: Record<ImportJobStatus, string> = {
  [ImportJobStatus.PENDING]: 'Import job created, waiting to start...',
  [ImportJobStatus.CREATING_CONTAINER]: 'Creating app container...',
  [ImportJobStatus.EXTRACTING]: 'Extracting zip file...',
  [ImportJobStatus.VALIDATING]: 'Validating project structure...',
  [ImportJobStatus.COPYING]: 'Copying files to container...',
  [ImportJobStatus.INSTALLING]: 'Installing dependencies...',
  [ImportJobStatus.BUILDING]: 'Building project...',
  [ImportJobStatus.COMMITTING]: 'Committing to git...',
  [ImportJobStatus.PUSHING]: 'Pushing to remote repository...',
  [ImportJobStatus.PULLING]: 'Pulling from remote repository...',
  [ImportJobStatus.RESTARTING]: 'Restarting dev server...',
  [ImportJobStatus.COMPLETED]: 'Import completed successfully!',
  [ImportJobStatus.FAILED]: 'Import failed',
};

/**
 * Get stage information for progress display
 */
export function getStageInfo(status: ImportJobStatus): ImportProgress {
  const stageIndex = STAGE_ORDER.indexOf(status);

  const result: ImportProgress = {
    stage: status,
    message: STAGE_MESSAGES[status] || 'Unknown status',
  };

  if (status !== ImportJobStatus.FAILED && stageIndex >= 0) {
    result.stageNumber = stageIndex + 1;
  }

  return result;
}

/**
 * Handle zip file import
 */
export async function handleZipImport(req: Request, res: Response, appId: string): Promise<Response> {
  return new Promise((resolve) => {
    zipUpload.single('zipFile')(req, res, async (err) => {
      let zipPath: string | null = null;

      try {
        if (err) {
          return resolve(res.status(400).json({
            success: false,
            error: err.message || 'Failed to upload zip file',
          } as CreateImportResponse));
        }

        if (!req.file) {
          return resolve(res.status(400).json({
            success: false,
            error: 'Zip file is required',
          } as CreateImportResponse));
        }

        zipPath = req.file.path;

        zipLogger.info('route.zip.upload.start', {
          appId,
          zipFileName: req.file.originalname,
          zipFileSize: req.file.size,
        });

        const validation = await zipSecurityService.validate(zipPath);
        if (!validation.valid) {
          await rm(zipPath, { force: true });

          const sanitizedErrors = validation.errors.map(err => ({
            key: err.key,
            message: err.message,
          }));

          return resolve(res.status(400).json({
            success: false,
            error: 'Invalid zip file',
            validationErrors: sanitizedErrors,
          } as CreateImportResponse));
        }

        // Extract optional PaaS parameters from form data
        const entryFile = req.body.entryFile as string | undefined;
        const installCommand = req.body.installCommand as string | undefined;
        const buildCommand = req.body.buildCommand as string | undefined;
        const startCommand = req.body.startCommand as string | undefined;

        const importJob = await projectImportService.startImport({
          appId,
          appName: appId,
          sourceType: 'zip',
          zipPath,
          zipFileName: req.file.originalname,
          zipFileSize: req.file.size,
          // PaaS Node.js parameters
          entryFile,
          commands: (installCommand || buildCommand || startCommand)
            ? { install: installCommand, build: buildCommand, start: startCommand }
            : undefined,
        });

        zipLogger.info('route.zip.upload.success', {
          appId,
          importJobId: importJob.id,
        });

        return resolve(res.status(202).json({
          success: true,
          appId,
          importJobId: importJob.id,
          status: importJob.status,
          sourceType: 'zip',
        } as CreateImportResponse));

      } catch (error) {
        if (zipPath) {
          try {
            await rm(zipPath, { force: true });
          } catch {
            // Ignore cleanup errors
          }
        }

        log.error(zipLogger, 'route.zip.upload.error', error as Error, { appId });

        return resolve(res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Internal server error',
        } as CreateImportResponse));
      }
    });
  });
}

// =============================================================================
// ZIP IMPORT ROUTES
// =============================================================================

/**
 * POST /apps/:id/zip/upload - Upload a ZIP file to replace the app codebase
 *
 * DESTRUCTIVE: Deletes all existing code and replaces it with ZIP contents.
 *
 * FEATURE FLAG: Requires ENABLE_ZIP_IMPORT=true or CODE_SYNC_ZIP_UPLOAD capability.
 *
 * Accepts multipart/form-data with zipFile field.
 *
 * Process:
 * 1. Validate and extract zip file
 * 2. Validate project structure (package.json)
 * 3. Delete existing code from app directory
 * 4. Copy new code to app directory
 * 5. Run `npm install` to install dependencies
 * 6. Run `npm run build` if build script exists
 * 7. On success: `git commit` to persist changes
 * 8. On failure: `git checkout .` to rollback
 * 9. Restart dev server
 *
 * @returns 202 - Upload job started with jobId
 */
router.post(
  '/apps/:id/zip/upload',
  requireZipImportFeature,
  validateAppOwnership,
  async (req: Request, res: Response) => {
    const { id: appId } = req.params;

    try {
      if (!appId) {
        return res.status(400).json({
          success: false,
          error: 'App ID is required',
        });
      }

      // Validate app exists
      const app = appRepository.findById(appId);
      if (!app) {
        return res.status(404).json({
          success: false,
          error: 'App not found',
        });
      }

      // Check for existing job
      const existingJob = await importJobRepo.findByAppId(appId);
      if (existingJob && existingJob.status !== ImportJobStatus.COMPLETED && existingJob.status !== ImportJobStatus.FAILED) {
        return res.status(409).json({
          success: false,
          error: 'Import already in progress',
          existingJobId: existingJob.id,
        });
      }

      // Handle the ZIP upload
      return handleZipImport(req, res, appId);

    } catch (error) {
      log.error(zipLogger, 'route.zip.upload.error', error as Error, { appId });

      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      });
    }
  }
);

/**
 * GET /apps/:id/zip/upload/status - Get the current status of a ZIP upload
 *
 * FEATURE FLAG: Requires ENABLE_ZIP_IMPORT=true or CODE_SYNC_ZIP_UPLOAD capability.
 *
 * Poll this endpoint to track upload progress.
 *
 * @returns 200 - Upload status with progress information
 */
router.get(
  '/apps/:id/zip/upload/status',
  requireZipImportFeature,
  validateAppOwnership,
  async (req: Request, res: Response) => {
    try {
      const { id: appId } = req.params;

      if (!appId) {
        return res.status(400).json({
          error: 'App ID is required',
        });
      }

      const job = await importJobRepo.findByAppId(appId);

      if (!job) {
        return res.status(404).json({
          error: 'Import job not found for this app',
        });
      }

      const app = appRepository.findById(appId);

      let validationErrors: ValidationError[] | undefined;
      if (job.validationErrors) {
        try {
          const rawErrors: ValidationError[] = JSON.parse(job.validationErrors);
          validationErrors = rawErrors.map(err => ({
            key: err.key,
            message: err.message,
          }));
        } catch {
          // Ignore parse errors
        }
      }

      const warnings = job.status === ImportJobStatus.COMPLETED ? validationErrors : undefined;
      const errors = job.status === ImportJobStatus.FAILED ? validationErrors : undefined;

      const response: ImportStatusResponse = {
        jobId: job.id,
        appId: job.appId,
        status: job.status,
        progress: getStageInfo(job.status),
        previewUrl: job.status === ImportJobStatus.COMPLETED ? app?.previewUrl || null : null,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      };

      if (errors && errors.length > 0) response.validationErrors = errors;
      if (warnings && warnings.length > 0) response.warnings = warnings;
      if (job.errorStage) response.errorStage = job.errorStage;

      return res.json(response);
    } catch (error) {
      log.error(zipLogger, 'route.zip.upload.status.error', error as Error, {
        appId: req.params.id,
      });

      return res.status(500).json({
        error: 'Internal server error',
      });
    }
  }
);

export default router;
