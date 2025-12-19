import { Router, Request, Response, NextFunction } from 'express';
import { rm } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { ImportJobRepository } from '../../database/repositories/ImportJobRepository.js';
import { GitTool } from '../../tools/git-tool.js';
import { Logger, log } from '../../logging/index.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
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

const router: Router = Router();
const appRepository = new AppRepository();
const importJobRepo = new ImportJobRepository();
const importLogger = Logger.create({ service: 'import-routes' });

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
const zipUpload = multer({
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
 * Requires ENABLE_ZIP_IMPORT=true environment variable.
 */
function requireZipImportFeature(req: Request, res: Response, next: NextFunction): void {
  if (process.env.ENABLE_ZIP_IMPORT !== 'true') {
    res.status(403).json({
      success: false,
      error: 'Zip import feature is not enabled',
      details: 'Set ENABLE_ZIP_IMPORT=true to enable this feature',
    });
    return;
  }

  next();
}

/**
 * Get commit history for an app
 */
router.get('/apps/:id/git/history', async (req, res) => {
  try {
    const { id } = req.params;
    const { count = 30 } = req.query;
    const contextLogger = log.forApp(id);

    // Get app path from database
    const app = appRepository.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    // Create git tool with dev-supervisor for this specific app
    const devSupervisor = DevSupervisorClientFactory.createForApp(id)
    const gitTool = new GitTool(devSupervisor || undefined)

    // Get commit history - always get all commits
    const result = await gitTool.executeGitOperation(app.path, {
      operation: 'log',
      options: {
        count: Number(count)
      }
    });

    if (!result.success) {
      return res.status(400).json({
        error: 'Failed to get commit history',
        details: result.error
      });
    }

    const commits = result.commits || [];
    contextLogger.info('route.git.history.success', {
      commitCount: commits.length,
    });

    return res.json({
      success: true,
      commits: commits
    });
  } catch (error) {
    const contextLogger = log.forApp(req.params.id);
    log.error(contextLogger, 'route.git.history.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to get commit history',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Checkout a specific commit for viewing purposes
 * Note: Any changes should be made on the main branch, not in detached HEAD state
 */
router.post('/apps/:id/git/checkout', async (req, res) => {
  try {
    const { id } = req.params;
    const { commitHash } = req.body;
    const contextLogger = log.forApp(id);

    if (!commitHash) {
      return res.status(400).json({ error: 'Commit hash is required' });
    }

    contextLogger.info('route.git.checkout.begin', {
      commitHash: commitHash.substring(0, 7),
    });

    // Get app path from database
    const app = appRepository.findById(id);
    if (!app) {
      contextLogger.error('route.git.checkout.app-not-found', {});
      return res.status(404).json({ error: 'App not found' });
    }

    // Create git tool with dev-supervisor for this specific app
    const devSupervisor = DevSupervisorClientFactory.createForApp(id)
    const gitTool = new GitTool(devSupervisor || undefined)

    // First save the current HEAD position
    const currentBranchResult = await gitTool.executeGitOperation(app.path, {
      operation: 'branch'
    });

    if (!currentBranchResult.success) {
      contextLogger.error('route.git.checkout.branch-check-failed', {});
      return res.status(400).json({
        error: 'Failed to get current branch',
        details: currentBranchResult.error
      });
    }

    const currentBranch = currentBranchResult.currentBranch || 'HEAD';
    contextLogger.info('route.git.checkout.current-branch', {
      currentBranch,
    });

    // Check for uncommitted changes and auto-commit if needed
    const statusResult = await gitTool.executeGitOperation(app.path, {
      operation: 'status'
    });

    if (statusResult.success && statusResult.status && !statusResult.status.isClean) {
      contextLogger.info('route.git.checkout.auto-committing', {
        stagedFiles: statusResult.status.stagedFiles,
        modifiedFiles: statusResult.status.modifiedFiles,
        untrackedFiles: statusResult.status.untrackedFiles,
      });

      // Add all files
      const addResult = await gitTool.executeGitOperation(app.path, {
        operation: 'add',
        files: ['.']
      });

      if (!addResult.success) {
        contextLogger.error('route.git.checkout.add-failed', {
          error: addResult.error,
        });
        return res.status(500).json({
          error: 'Failed to stage changes before checkout',
          details: addResult.error
        });
      }

      // Commit with descriptive message
      const commitResult = await gitTool.executeGitOperation(app.path, {
        operation: 'commit',
        message: `Auto-commit: Save changes before switching to version ${commitHash.substring(0, 7)}`
      });

      if (!commitResult.success) {
        contextLogger.error('route.git.checkout.commit-failed', {
          error: commitResult.error,
        });
        return res.status(500).json({
          error: 'Failed to commit changes before checkout',
          details: commitResult.error
        });
      }

      contextLogger.info('route.git.checkout.auto-committed', {});
    }

    // Create a temporary branch at the specified commit (not used currently)
    // const branchName = `temp-view-${commitHash.substring(0, 7)}`;

    // Checkout the specific commit
    const result = await gitTool.executeGitOperation(app.path, {
      operation: 'checkout',
      branch: commitHash
    });

    if (!result.success) {
      contextLogger.error('route.git.checkout.failed', {
        commitHash: commitHash.substring(0, 7),
        error: result.error,
      });
      return res.status(400).json({
        error: 'Failed to checkout commit',
        details: result.error
      });
    }

    contextLogger.info('route.git.checkout.success', {
      commitHash: commitHash.substring(0, 7),
      previousBranch: currentBranch,
    });
    contextLogger.warn('route.git.checkout.detached-head', {
      warning: 'App is now in detached HEAD state',
    });

    return res.json({
      success: true,
      message: `Checked out commit ${commitHash}`,
      previousBranch: currentBranch,
      isDetachedHead: true
    });
  } catch (error) {
    const contextLogger = log.forApp(req.params.id);
    log.error(contextLogger, 'route.git.checkout.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to checkout commit',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Return to the main branch (or specified branch) to ensure changes are made on HEAD
 * This is critical for preventing detached HEAD state issues
 */
router.post('/apps/:id/git/return', async (req, res) => {
  try {
    const { id } = req.params;
    const { branch = 'main' } = req.body;
    const contextLogger = log.forApp(id);

    contextLogger.info('route.git.return-to-branch.begin', {
      branch,
    });

    // Get app path from database
    const app = appRepository.findById(id);
    if (!app) {
      contextLogger.error('route.git.return-to-branch.app-not-found', {});
      return res.status(404).json({ error: 'App not found' });
    }

    // Create git tool with dev-supervisor for this specific app
    const devSupervisor = DevSupervisorClientFactory.createForApp(id)
    const gitTool = new GitTool(devSupervisor || undefined)

    // First, check current branch status
    const statusResult = await gitTool.executeGitOperation(app.path, {
      operation: 'branch'
    });

    // Log current state before attempting checkout
    if (statusResult.success) {
      const currentBranch = statusResult.currentBranch || 'detached HEAD';
      contextLogger.info('route.git.return-to-branch.current-state', {
        currentBranch,
      });
    } else {
      contextLogger.warn('route.git.return-to-branch.state-unknown', {});
    }

    // Return to the specified branch
    const result = await gitTool.executeGitOperation(app.path, {
      operation: 'checkout',
      branch
    });

    if (!result.success) {
      contextLogger.error('route.git.return-to-branch.failed', {
        branch,
        error: result.error,
      });
      return res.status(400).json({
        error: `Failed to return to ${branch} branch`,
        details: result.error
      });
    }

    contextLogger.info('route.git.return-to-branch.success', {
      branch,
    });

    return res.json({
      success: true,
      message: `Returned to branch ${branch}`,
      previousState: statusResult.success ? statusResult.currentBranch : 'unknown'
    });
  } catch (error) {
    const contextLogger = log.forApp(req.params.id);
    log.error(contextLogger, 'route.git.return-to-branch.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to return to branch',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Restore files from a specific commit
 * Implements git restore functionality with auto-commit
 */
router.post('/apps/:id/git/restore', async (req, res) => {
  try {
    const { id } = req.params;
    const { commitHash } = req.body;
    const contextLogger = log.forApp(id);

    if (!commitHash) {
      return res.status(400).json({ error: 'Commit hash is required' });
    }

    contextLogger.info('route.git.restore-files.begin', {
      commitHash: commitHash.substring(0, 7),
    });

    // Get app path from database
    const app = appRepository.findById(id);
    if (!app) {
      contextLogger.error('route.git.restore-files.app-not-found', {});
      return res.status(404).json({ error: 'App not found' });
    }

    // Create git tool with dev-supervisor for this specific app
    const devSupervisor = DevSupervisorClientFactory.createForApp(id)
    const gitTool = new GitTool(devSupervisor || undefined)

    // First check current branch status
    const statusResult = await gitTool.executeGitOperation(app.path, {
      operation: 'branch'
    });

    // Log current state before attempting restore
    if (statusResult.success) {
      const currentBranch = statusResult.currentBranch || 'detached HEAD';
      contextLogger.info('route.git.restore-files.current-state', {
        currentBranch,
      });
    } else {
      contextLogger.warn('route.git.restore-files.state-unknown', {});
    }

    // Execute the restore operation
    const result = await gitTool.executeGitOperation(app.path, {
      operation: 'restore',
      options: {
        hash: commitHash
      }
    });

    if (!result.success) {
      return res.status(400).json({
        error: 'Failed to restore files from commit',
        details: result.error
      });
    }

    return res.json({
      success: true,
      message: `Restored files from commit ${commitHash}`,
      previousState: statusResult.success ? statusResult.currentBranch : 'unknown'
    });
  } catch (error) {
    const contextLogger = log.forApp(req.params.id);
    log.error(contextLogger, 'route.git.restore-files.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to restore files from commit',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// =============================================================================
// ZIP IMPORT ROUTES (Feature-flagged with ENABLE_ZIP_IMPORT)
// =============================================================================

/**
 * Ordered list of import stages for progress tracking
 */
const STAGE_ORDER: ImportJobStatus[] = [
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

const STAGE_MESSAGES: Record<ImportJobStatus, string> = {
  [ImportJobStatus.PENDING]: 'Import job created, waiting to start...',
  [ImportJobStatus.CREATING_CONTAINER]: 'Creating app container...',
  [ImportJobStatus.EXTRACTING]: 'Extracting zip file...',
  [ImportJobStatus.VALIDATING]: 'Validating project structure...',
  [ImportJobStatus.COPYING]: 'Copying files to container...',
  [ImportJobStatus.INSTALLING]: 'Installing dependencies...',
  [ImportJobStatus.BUILDING]: 'Building project...',
  [ImportJobStatus.COMMITTING]: 'Committing to git...',
  [ImportJobStatus.RESTARTING]: 'Restarting dev server...',
  [ImportJobStatus.COMPLETED]: 'Import completed successfully!',
  [ImportJobStatus.FAILED]: 'Import failed',
};

/**
 * Get stage information for progress display
 */
function getStageInfo(status: ImportJobStatus): ImportProgress {
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
 * POST /apps/:id/git/replace - Replace entire codebase from a zip file
 *
 * DESTRUCTIVE: Deletes all existing code and replaces it with zip contents.
 *
 * FEATURE FLAG: Requires ENABLE_ZIP_IMPORT=true environment variable.
 *
 * Process:
 * 1. Validate zip file (size, security, structure)
 * 2. Delete existing code from app directory
 * 3. Extract zip contents to app directory
 * 4. Run `npm install` to install dependencies
 * 5. Run `npm run build` if build script exists
 * 6. On success: `git commit` to persist changes
 * 7. On failure: `git checkout .` to rollback
 * 8. Restart dev server
 *
 * @returns {CreateImportResponse} 202 - Replacement job started
 */
router.post(
  '/apps/:id/git/replace',
  requireZipImportFeature,
  zipUpload.single('zipFile'),
  async (req: Request, res: Response) => {
    let zipPath: string | null = null;
    const { id: appId } = req.params;

    try {
      if (!appId) {
        return res.status(400).json({
          success: false,
          error: 'App ID is required',
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'Zip file is required',
        } as CreateImportResponse);
      }

      zipPath = req.file.path;

      importLogger.info('route.git.replace.upload.start', {
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

        return res.status(400).json({
          success: false,
          error: 'Invalid zip file',
          validationErrors: sanitizedErrors,
        });
      }

      const existingJob = await importJobRepo.findByAppId(appId);
      if (existingJob && existingJob.status !== ImportJobStatus.COMPLETED && existingJob.status !== ImportJobStatus.FAILED) {
        await rm(zipPath, { force: true });
        return res.status(409).json({
          success: false,
          error: 'Import already in progress',
          existingJobId: existingJob.id,
        });
      }

      const importJob = await projectImportService.startImport({
        appId,
        appName: appId,
        zipPath,
        zipFileName: req.file.originalname,
        zipFileSize: req.file.size,
      });

      importLogger.info('route.git.replace.upload.success', {
        appId,
        importJobId: importJob.id,
      });

      return res.status(202).json({
        success: true,
        appId,
        importJobId: importJob.id,
        status: importJob.status,
      } as CreateImportResponse);

    } catch (error) {
      if (zipPath) {
        try {
          await rm(zipPath, { force: true });
        } catch {
          // Ignore cleanup errors
        }
      }

      log.error(importLogger, 'route.git.replace.upload.error', error as Error, { appId });

      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      } as CreateImportResponse);
    }
  }
);

/**
 * GET /apps/:id/git/replace/status - Get the current status of a codebase replacement
 *
 * FEATURE FLAG: Requires ENABLE_ZIP_IMPORT=true environment variable.
 *
 * Poll this endpoint to track replacement progress.
 *
 * @returns {ImportStatusResponse} 200 - Replacement status
 */
router.get('/apps/:id/git/replace/status', requireZipImportFeature, async (req: Request, res: Response) => {
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
    log.error(importLogger, 'route.git.replace.status.error', error as Error, {
      appId: req.params.id,
    });

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});

/**
 * DELETE /apps/:id/git/replace - Cancel an in-progress import (future feature)
 *
 * FEATURE FLAG: Requires ENABLE_ZIP_IMPORT=true environment variable.
 *
 * Currently returns 501 Not Implemented.
 */
router.delete('/apps/:id/git/replace', requireZipImportFeature, async (_req: Request, res: Response) => {
  return res.status(501).json({
    error: 'Import cancellation not yet implemented',
    message: 'This feature is planned for a future release',
  });
});

export default router;
