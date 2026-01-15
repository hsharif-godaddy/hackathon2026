import { Router, Request, Response, NextFunction } from 'express';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { GitRemoteConfigRepository } from '../../database/repositories/GitRemoteConfigRepository.js';
import { GitTool } from '../../tools/git-tool.js';
import { Logger } from '../../logging/index.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { getErrorMessage } from '../../utils/error.js';

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
 * Validates both global feature flag and product-specific enablement.
 * Checks the app's product family against GIT_REMOTE_SYNC_PRODUCTS.
 */
function requireGitRemoteSync(req: Request, res: Response, next: NextFunction): void {

  // 1. Check global feature flag
  if (process.env.ENABLE_GIT_REMOTE_SYNC !== 'true') {
    res.status(503).json({
      error: 'Git remote sync feature is not enabled',
      message: 'Set ENABLE_GIT_REMOTE_SYNC=true to enable this feature'
    });
    return;
  }

  //TODO: This need to discuss with V2-team/John and then need to enable.
  // Have to get agreement what env var can be used for this.
  //

  // // 2. Parse allowed product families
  // const allowedProducts = (process.env.GIT_REMOTE_SYNC_PRODUCTS || '')
  //   .split(',')
  //   .map(p => p.trim())
  //   .filter(Boolean);
  //
  // // If no products specified, feature is disabled
  // if (allowedProducts.length === 0) {
  //   res.status(403).json({
  //     error: 'Git remote sync feature is not enabled for any products',
  //     message: 'Configure GIT_REMOTE_SYNC_PRODUCTS to enable this feature'
  //   });
  //   return;
  // }
  //
  // // 3. Get app and determine its product family
  // const appId = req.params.id;
  // if (!appId) {
  //   res.status(400).json({ error: 'App ID is required' });
  //   return;
  // }
  //
  // const app = appRepository.findById(appId);
  // if (!app) {
  //   res.status(404).json({ error: 'App not found' });
  //   return;
  // }
  //
  // // 4. Check if app's product family is allowed
  // const appProductFamily = getProductFamily(app.templateVersion);
  //
  // if (!allowedProducts.includes(appProductFamily)) {
  //   logger.warn('git-remote.product-not-allowed', {
  //     appId,
  //     templateVersion: app.templateVersion,
  //     productFamily: appProductFamily,
  //     allowedProducts
  //   });
  //
  //   res.status(403).json({
  //     error: 'Git remote sync is not enabled for this app',
  //     message: `This app uses product family '${appProductFamily}' which is not in the allowed list: ${allowedProducts.join(', ')}`,
  //     appProductFamily,
  //     allowedProducts
  //   });
  //   return;
  // }
  //
  // logger.info('git-remote.product-allowed', {
  //   appId,
  //   templateVersion: app.templateVersion,
  //   productFamily: appProductFamily
  // });

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
