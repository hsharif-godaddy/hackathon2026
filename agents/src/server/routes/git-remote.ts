import { Router, Request, Response, NextFunction } from 'express';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { GitRemoteConfigRepository } from '../../database/repositories/GitRemoteConfigRepository.js';
import { GitTool } from '../../tools/git-tool.js';
import { Logger } from '../../logging/index.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { validateGitSync } from '../middleware/git-import-validation.js';
import { getErrorMessage } from '../../utils/error.js';
import { isCapabilityEnabled } from '../../utils/capability-config.js';
import { gitOpsService } from '../../services/GitOpsService.js';
import { ImportJobStatus, type ValidationError } from '../../types/import.js';

const router: Router = Router();
const appRepository = new AppRepository();
const gitRemoteConfigRepo = new GitRemoteConfigRepository();
const logger = Logger.create({ service: 'git-remote-routes' });

/**
 * Maps GitOps error codes to HTTP status codes
 */
function getHttpStatusForErrorCode(errorCode: string | undefined): number {
  switch (errorCode) {
    case 'APP_NOT_FOUND':
    case 'JOB_NOT_FOUND':
      return 404;
    case 'CONTAINER_UNAVAILABLE':
      return 503;
    case 'JOB_IN_PROGRESS':
      return 409;
    case 'FORBIDDEN':
      return 403;
    default:
      return 500;
  }
}

/**
 * Middleware to check if git remote sync feature is enabled
 *
 * Validates capability based on the request path:
 * - /git/push requires CODE_SYNC_GIT_PUSH capability
 * - /git/pull requires CODE_SYNC_GIT_PULL capability
 * - /git/remote/status requires CODE_SYNC_GIT_PUSH OR CODE_SYNC_GIT_PULL
 * - /git/remote/configure requires CODE_SYNC_GIT_PUSH OR CODE_SYNC_GIT_PULL
 */
function requireGitRemoteSync(req: Request, res: Response, next: NextFunction): void {
  // Check global feature flag first
  let isGitSyncEnabled: boolean = process.env.ENABLE_GIT_REMOTE_SYNC === 'true';
  let requiredCapability = '';
  const requestPath = req.path;
  if (!isGitSyncEnabled) {
    if (requestPath.endsWith('/git/push')) {
      isGitSyncEnabled = isCapabilityEnabled('CODE_SYNC_GIT_PUSH');
      requiredCapability = 'CODE_SYNC_GIT_PUSH';
    } else if (requestPath.endsWith('/git/pull')) {
      isGitSyncEnabled = isCapabilityEnabled('CODE_SYNC_GIT_PULL');
      requiredCapability = 'CODE_SYNC_GIT_PULL';
    } else if (requestPath.endsWith('/git/remote/status') || requestPath.endsWith('/git/remote/configure') || requestPath.includes('/git/sync/status/')) {
      isGitSyncEnabled = isCapabilityEnabled('CODE_SYNC_GIT_PUSH') || isCapabilityEnabled('CODE_SYNC_GIT_PULL');
      requiredCapability = 'CODE_SYNC_GIT_PUSH or CODE_SYNC_GIT_PULL';
    } else {
      // Unknown path - deny by default
      res.status(403).json({
        error: 'Unknown git remote operation',
        message: 'This operation is not recognized'
      });
      return;
    }
  }

  if (!isGitSyncEnabled) {
    logger.warn('git-remote.capability-denied', {
      path: requestPath,
      requiredCapability
    });

    res.status(403).json({
      error: 'Git operation not allowed',
      message: `This operation requires the ${requiredCapability} capability`
    });
    return;
  }

  next();
}

/**
 * POST /apps/:id/git/remote/configure
 *
 * Configure a git remote for an app
 *
 * Request body:
 * - repoUrl: string (required) - Repository URL (e.g., https://github.com/user/repo.git)
 * - remoteName: string (optional) - Remote name (default: 'origin')
 * - branch: string (optional) - Default branch (default: 'main')
 */
router.post(
  '/apps/:id/git/remote/configure',
  requireGitRemoteSync,
  validateAppOwnership,
  async (req: Request, res: Response) => {
    const appId = req.params.id;
    const { repoUrl, remoteName, branch } = req.body;

    if (!appId) {
      res.status(400).json({ error: 'App ID is required' });
      return;
    }

    logger.info('git-remote.configure.begin', {
      appId,
      repoUrl,
      remoteName: remoteName || 'origin'
    });

    try {
      // Validate required parameters
      if (!repoUrl) {
        res.status(400).json({
          error: 'Repository URL is required',
          message: 'Please provide repoUrl in request body'
        });
        return;
      }

      // Get app
      const app = appRepository.findById(appId);
      if (!app) {
        res.status(404).json({ error: 'App not found' });
        return;
      }

      // Get dev-supervisor for the app
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (!devSupervisor?.isAvailable()) {
        res.status(503).json({
          error: 'App container is not available',
          message: 'The app container must be running to configure git remote'
        });
        return;
      }

      // Create git tool with dev-supervisor
      const gitTool = new GitTool(devSupervisor);

      // Execute configure-remote operation
      const result = await gitTool.executeGitOperation(app.path, {
        operation: 'configure-remote',
        repoUrl,
        remoteName: remoteName || 'origin',
        branch: branch || 'main'
      });

      if (!result.success) {
        logger.error('git-remote.configure.error', {
          appId,
          error: result.error
        });

        res.status(400).json({
          error: 'Failed to configure git remote',
          message: result.error,
          details: result.output
        });
        return;
      }

      logger.info('git-remote.configure.success', { appId });

      res.json({
        success: true,
        message: 'Git remote configured successfully',
        output: result.output
      });
    } catch (error) {
      logger.error('git-remote.configure.exception', {
        appId,
        error: getErrorMessage(error)
      });

      res.status(500).json({
        error: 'Internal server error',
        message: getErrorMessage(error)
      });
    }
  }
);

/**
 * POST /apps/:id/git/push
 *
 * Push to remote repository (async operation)
 *
 * Credential options:
 * - Provide both 'token' AND 'repoUrl' together for direct authentication
 * - Omit both to use credentials from database config / secrets API
 *
 * Request body:
 * - remoteName: string (optional) - Remote name (default: 'origin')
 * - branch: string (optional) - Branch to push (default: current branch)
 * - forcePush: boolean (optional) - Whether to force push (default: false)
 * - token: string (optional, required with repoUrl) - GitHub token for authentication
 * - repoUrl: string (optional, required with token) - Repository URL
 *
 * Returns 202 Accepted with job ID for tracking
 */
router.post(
  '/apps/:id/git/push',
  requireGitRemoteSync,
  validateAppOwnership,
  validateGitSync,
  async (req: Request, res: Response) => {
    const appId = req.params.id;
    const { remoteName, branch, forcePush, token, repoUrl } = req.body;

    if (!appId) {
      res.status(400).json({ error: 'App ID is required' });
      return;
    }

    const result = await gitOpsService.startPush({
      appId,
      remoteName,
      branch,
      forcePush,
      token,
      repoUrl,
    });

    if (!result.success) {
      res.status(getHttpStatusForErrorCode(result.errorCode)).json({
        error: result.error,
        ...(result.existingJobId && { existingJobId: result.existingJobId }),
      });
      return;
    }

    res.status(202).json({
      success: true,
      message: 'Git push operation started',
      jobId: result.jobId,
      status: result.status,
    });
  }
);

/**
 * POST /apps/:id/git/pull
 *
 * Pull from remote repository (async operation)
 *
 * Credential options:
 * - Provide both 'token' AND 'repoUrl' together for direct authentication
 * - Omit both to use credentials from database config / secrets API
 *
 * Request body:
 * - remoteName: string (optional) - Remote name (default: 'origin')
 * - branch: string (optional) - Branch to pull (default: configured default branch)
 * - token: string (optional, required with repoUrl) - GitHub token for authentication
 * - repoUrl: string (optional, required with token) - Repository URL
 * - modifyViteConfig: boolean (optional) - Whether to modify vite config to set server.allowedHosts: true.
 *   Use this when pulling external projects that need proxy compatibility (e.g., projects not originally
 *   created in Airo). This is the same modification applied during zip import.
 *
 * Returns 202 Accepted with job ID for tracking
 */
router.post(
  '/apps/:id/git/pull',
  requireGitRemoteSync,
  validateAppOwnership,
  validateGitSync,
  async (req: Request, res: Response) => {
    const appId = req.params.id;
    const {
      remoteName,
      branch,
      token,
      repoUrl,
      modifyViteConfig,
      // PaaS Node.js parameters
      entryFile,
      installCommand,
      buildCommand,
      devCommand,
      startCommand,
    } = req.body;

    if (!appId) {
      res.status(400).json({ error: 'App ID is required' });
      return;
    }

    if (modifyViteConfig !== undefined && typeof modifyViteConfig !== 'boolean') {
      res.status(400).json({ error: 'modifyViteConfig must be a boolean' });
      return;
    }

    const result = await gitOpsService.startPull({
      appId,
      remoteName,
      branch,
      token,
      repoUrl,
      modifyViteConfig,
      // PaaS Node.js parameters
      entryFile,
      commands: (installCommand || buildCommand || devCommand || startCommand)
        ? { install: installCommand, build: buildCommand, dev: devCommand, start: startCommand }
        : undefined,
    });

    if (!result.success) {
      res.status(getHttpStatusForErrorCode(result.errorCode)).json({
        error: result.error,
        ...(result.existingJobId && { existingJobId: result.existingJobId }),
      });
      return;
    }

    res.status(202).json({
      success: true,
      message: 'Git pull operation started',
      jobId: result.jobId,
      status: result.status,
    });
  }
);

/**
 * GET /apps/:id/git/remote/status
 *
 * Get git remote configuration status
 */
router.get(
  '/apps/:id/git/remote/status',
  requireGitRemoteSync,
  validateAppOwnership,
  async (req: Request, res: Response) => {
    const appId = req.params.id;

    if (!appId) {
      res.status(400).json({ error: 'App ID is required' });
      return;
    }

    logger.info('git-remote.status.begin', { appId });

    try {
      // Get all remote configs for the app
      const remoteConfigs = gitRemoteConfigRepo.findByAppId(appId);

      logger.info('git-remote.status.success', {
        appId,
        count: remoteConfigs.length
      });

      res.json({
        success: true,
        remotes: remoteConfigs.map(config => ({
          id: config.id,
          remoteName: config.remoteName,
          provider: config.provider,
          repoUrl: config.repoUrl,
          defaultBranch: config.defaultBranch,
          lastSyncAt: config.lastSyncAt,
          syncEnabled: config.syncEnabled,
          createdAt: config.createdAt,
          updatedAt: config.updatedAt
        }))
      });
    } catch (error) {
      logger.error('git-remote.status.exception', {
        appId,
        error: getErrorMessage(error)
      });

      res.status(500).json({
        error: 'Internal server error',
        message: getErrorMessage(error)
      });
    }
  }
);

/**
 * GET /apps/:id/git/sync/status/:jobId
 *
 * Get status of a specific git sync operation by job ID
 */
router.get(
  '/apps/:id/git/sync/status/:jobId',
  requireGitRemoteSync,
  validateAppOwnership,
  async (req: Request, res: Response) => {
    const appId = req.params.id;
    const jobId = req.params.jobId;

    if (!appId || !jobId) {
      res.status(400).json({ error: 'App ID and Job ID are required' });
      return;
    }

    const result = await gitOpsService.getJobStatus(appId, jobId);

    if (!result.success) {
      res.status(getHttpStatusForErrorCode(result.errorCode)).json({
        error: result.error,
      });
      return;
    }

    const job = result.job!;

    // Parse validation errors/warnings from job
    let validationErrors: Pick<ValidationError, 'key' | 'message'>[] | undefined;
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

    res.json({
      success: true,
      jobId: job.id,
      appId: job.appId,
      status: job.status,
      sourceType: job.sourceType,
      errorMessage: job.status === ImportJobStatus.FAILED ? job.errorMessage : undefined,
      errorStage: job.status === ImportJobStatus.FAILED ? job.errorStage : undefined,
      validationErrors: errors && errors.length > 0 ? errors : undefined,
      warnings: warnings && warnings.length > 0 ? warnings : undefined,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      completedAt: job.completedAt?.toISOString(),
    });
  }
);

export default router;
