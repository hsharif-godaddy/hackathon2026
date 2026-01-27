import { Router, Request, Response, NextFunction } from 'express';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { GitRemoteConfigRepository } from '../../database/repositories/GitRemoteConfigRepository.js';
import { GitTool } from '../../tools/git-tool.js';
import { Logger } from '../../logging/index.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { isSupportedProjectOnHost, SUPPORTED_BUILD_TOOLS } from '../middleware/git-import-validation.js';
import { getErrorMessage } from '../../utils/error.js';
import { isCapabilityEnabled } from '../../utils/capability-config.js';

const router: Router = Router();
const appRepository = new AppRepository();
const gitRemoteConfigRepo = new GitRemoteConfigRepository();
const logger = Logger.create({ service: 'git-remote-routes' });

/**
 * Map app template version to product family
 *
 * @param templateVersion - Template version from app record (e.g., "v8")
 * @returns Product family identifier (e.g., "aab-v1", "paas-nodejs-v1")
 */
function getProductFamily(templateVersion?: string): string {
  // Default to aab-v1 for all current templates
  // Future: Add logic to detect PaaS templates and return "paas-nodejs-v1"
  if (!templateVersion) {
    return 'aab-v1';
  }

  // AAB templates: v1, v2, v3, v4, v5, v6, v7, v8, etc.
  if (templateVersion.match(/^v\d+$/)) {
    return 'aab-v1';
  }

  // PaaS Node.js templates (future)
  if (templateVersion.startsWith('paas-nodejs-')) {
    return 'paas-nodejs-v1';
  }

  // Default to aab-v1
  return 'aab-v1';
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
    } else if (requestPath.endsWith('/git/remote/status') || requestPath.endsWith('/git/remote/configure')) {
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
      if (!devSupervisor || !devSupervisor.isAvailable()) {
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
 * Push to remote repository
 *
 * Request body:
 * - remoteName: string (optional) - Remote name (default: 'origin')
 * - branch: string (optional) - Branch to push (default: current branch)
 * - forcePush: boolean (optional) - Whether to force push (default: false)
 */
router.post(
  '/apps/:id/git/push',
  requireGitRemoteSync,
  validateAppOwnership,
  async (req: Request, res: Response) => {
    const appId = req.params.id;
    const { remoteName, branch, forcePush } = req.body;

    if (!appId) {
      res.status(400).json({ error: 'App ID is required' });
      return;
    }

    logger.info('git-remote.push.begin', {
      appId,
      remoteName: remoteName || 'origin',
      branch,
      forcePush: forcePush || false
    });

    try {
      // Get app
      const app = appRepository.findById(appId);
      if (!app) {
        res.status(404).json({ error: 'App not found' });
        return;
      }

      // Get dev-supervisor for the app
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (!devSupervisor || !devSupervisor.isAvailable()) {
        res.status(503).json({
          error: 'App container is not available',
          message: 'The app container must be running to push to git remote'
        });
        return;
      }

      // Create git tool with dev-supervisor
      const gitTool = new GitTool(devSupervisor);

      // Execute push operation
      const result = await gitTool.executeGitOperation(app.path, {
        operation: 'push',
        remoteName: remoteName || 'origin',
        branch,
        forcePush: forcePush || false
      });

      if (!result.success) {
        logger.error('git-remote.push.error', {
          appId,
          error: result.error
        });

        res.status(400).json({
          error: 'Failed to push to git remote',
          message: result.error,
          details: result.output
        });
        return;
      }

      logger.info('git-remote.push.success', { appId });

      res.json({
        success: true,
        message: 'Successfully pushed to git remote',
        output: result.output
      });
    } catch (error) {
      logger.error('git-remote.push.exception', {
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
 * POST /apps/:id/git/pull
 *
 * Pull from remote repository
 *
 * Request body:
 * - remoteName: string (optional) - Remote name (default: 'origin')
 * - branch: string (optional) - Branch to pull (default: configured default branch)
 */
router.post(
  '/apps/:id/git/pull',
  requireGitRemoteSync,
  validateAppOwnership,
  async (req: Request, res: Response) => {
    const appId = req.params.id;
    const { remoteName, branch } = req.body;

    if (!appId) {
      res.status(400).json({ error: 'App ID is required' });
      return;
    }

    logger.info('git-remote.pull.begin', {
      appId,
      remoteName: remoteName || 'origin',
      branch
    });

    try {
      // Get app
      const app = appRepository.findById(appId);
      if (!app) {
        res.status(404).json({ error: 'App not found' });
        return;
      }

      // Get dev-supervisor for the app
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (!devSupervisor || !devSupervisor.isAvailable()) {
        res.status(503).json({
          error: 'App container is not available',
          message: 'The app container must be running to pull from git remote'
        });
        return;
      }

      // Create git tool with dev-supervisor
      const gitTool = new GitTool(devSupervisor);

      // Execute pull operation
      const result = await gitTool.executeGitOperation(app.path, {
        operation: 'pull',
        remoteName: remoteName || 'origin',
        branch
      });

      if (!result.success) {
        logger.error('git-remote.pull.error', {
          appId,
          error: result.error
        });

        res.status(400).json({
          error: 'Failed to pull from git remote',
          message: result.error,
          details: result.output
        });
        return;
      }

      // Validate pulled code uses a supported build tool
      const supportedToolNames = SUPPORTED_BUILD_TOOLS.map(t => t.name).join(', ');
      if (!isSupportedProjectOnHost(app.path)) {
        logger.warn('git-remote.pull.unsupported-project', { appId, supportedTools: supportedToolNames });

        // Rollback the pull using ORIG_HEAD (set by git before pull/merge operations)
        // This correctly handles multi-commit pulls and fast-forwards
        const rollbackResult = await gitTool.executeGitOperation(app.path, {
          operation: 'reset',
          options: { mode: 'hard', hash: 'ORIG_HEAD' }
        });

        if (!rollbackResult.success) {
          logger.error('git-remote.pull.rollback-failed', {
            appId,
            error: rollbackResult.error
          });

          res.status(500).json({
            error: `Only ${supportedToolNames}-based projects are supported`,
            message: `The pulled code does not use a supported build tool. Attempted rollback failed - repository may be in inconsistent state.`,
            rollbackError: rollbackResult.error
          });
          return;
        }

        res.status(400).json({
          error: `Only ${supportedToolNames}-based projects are supported`,
          message: `The pulled code does not use a supported build tool (${supportedToolNames}). Changes have been rolled back.`
        });
        return;
      }

      logger.info('git-remote.pull.success', { appId });

      res.json({
        success: true,
        message: 'Successfully pulled from git remote',
        output: result.output
      });
    } catch (error) {
      logger.error('git-remote.pull.exception', {
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

export default router;
