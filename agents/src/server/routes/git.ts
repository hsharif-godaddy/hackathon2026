import { Router, Request, Response } from 'express';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { GitTool } from '../../tools/git-tool.js';
import { GitUtils } from '../../utils/git.js';
import { Logger, log } from '../../logging/index.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import {
  ImportJobStatus,
  type CreateImportResponse,
  type ImportStatusResponse,
  type ValidationError,
} from '../../types/import.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { importType, validateGitImport } from '../middleware/git-import-validation.js';
import {
  requireZipImportFeature,
  handleZipImport,
  getStageInfo,
  importJobRepo,
} from './zip-import.js';

const router: Router = Router();
const appRepository = new AppRepository();
const importLogger = Logger.create({ service: 'import-routes' });

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
    const gitUtils = new GitUtils(devSupervisor || undefined)

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

    // Get current commit (HEAD)
    let currentCommit: string | null = null;
    try {
      currentCommit = await gitUtils.getCurrentCommit(app.path);
    } catch (error) {
      // Log but don't fail - current commit is optional
      contextLogger.warn('route.git.history.current-commit-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    contextLogger.info('route.git.history.success', {
      commitCount: commits.length,
      currentCommit: currentCommit?.substring(0, 7),
    });

    return res.json({
      success: true,
      commits: commits,
      currentCommit: currentCommit
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
// Legacy endpoints for backward compatibility - new code should use /apps/:id/zip/upload
// =============================================================================

/**
 * POST /apps/:id/git/replace - Replace entire codebase from a zip file or git repository
 *
 * DEPRECATED: Use POST /apps/:id/zip/upload for new integrations.
 *
 * DESTRUCTIVE: Deletes all existing code and replaces it with new contents.
 *
 * FEATURE FLAG: Requires ENABLE_ZIP_IMPORT=true environment variable.
 *
 * Accepts two input formats:
 * 1. Zip file (multipart/form-data with zipFile field)
 * 2. Git repository (application/json with gitUrl, gitToken, gitBranch fields)
 *
 * Process:
 * 1. For Zip: Validate and extract zip file
 *    For Git: Clone repository using provided token
 * 2. Validate project structure (package.json)
 * 3. Delete existing code from app directory
 * 4. Copy new code to app directory
 * 5. Run `npm install` to install dependencies
 * 6. Run `npm run build` if build script exists
 * 7. On success: `git commit` to persist changes
 * 8. On failure: `git checkout .` to rollback
 * 9. Restart dev server
 *
 * @returns {CreateImportResponse} 202 - Replacement job started
 */
router.post(
  '/apps/:id/git/replace',
  requireZipImportFeature,
  validateAppOwnership,
  validateGitImport,
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
        } as CreateImportResponse);
      }

      // Detect input type based on content-type
      const importTypeReq = importType(req);


      if (!importTypeReq) {
        return res.status(400).json({
          success: false,
          error: 'Must provide either zipFile (multipart/form-data) or gitUrl (application/json)',
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

      if (importTypeReq === 'git') {
        // Handle Git import
        return handleGitImport(req, res, appId);
      } else {
        // Handle Zip import
        return handleZipImport(req, res, appId);
      }

    } catch (error) {
      log.error(importLogger, 'route.git.replace.error', error as Error, { appId });

      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      } as CreateImportResponse);
    }
  }
);

/**
 * Handle git repository import
 *
 * Note: Git clone import is no longer supported. Use git pull/push for syncing.
 */
async function handleGitImport(_req: Request, res: Response, appId: string): Promise<Response> {
  importLogger.warn('route.git.replace.git.not-supported', { appId });

  return res.status(501).json({
    success: false,
    error: 'Git clone import is no longer supported. Use git pull/push for syncing with existing repositories.',
  });
}

/**
 * GET /apps/:id/git/replace/status - Get the current status of a codebase replacement
 *
 * DEPRECATED: Use GET /apps/:id/zip/upload/status for new integrations.
 *
 * FEATURE FLAG: Requires ENABLE_ZIP_IMPORT=true environment variable.
 *
 * Poll this endpoint to track replacement progress.
 *
 * @returns {ImportStatusResponse} 200 - Replacement status
 */
router.get('/apps/:id/git/replace/status', requireZipImportFeature, validateAppOwnership, async (req: Request, res: Response) => {
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
router.delete('/apps/:id/git/replace', requireZipImportFeature, validateAppOwnership, async (_req: Request, res: Response) => {
  return res.status(501).json({
    error: 'Import cancellation not yet implemented',
    message: 'This feature is planned for a future release',
  });
});

export default router;
