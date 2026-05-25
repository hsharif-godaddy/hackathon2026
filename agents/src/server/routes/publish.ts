import { existsSync } from 'node:fs';

import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import { createForWorkspace } from '../../workspace/index.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { GitUtils } from '../../utils/git.js';
import { log } from '../../logging/index.js';
import { Router } from 'express';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import type { DevSupervisorClient, PublishRequest, PublishSuccessResponse, UnpublishResponse } from '../../services/DevSupervisorClient.js';
import { requirePermission } from '../middleware/require-permission.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { getPublishStrategy, BuildError, PreviewNotRunningError, MissingStartCommandError } from './publish/strategies/index.js';
import type { PublishContext } from './publish/strategies/index.js';
import { getGitHookService } from '../ai-lib-websocket-server.js';
import { validatePublishedSeo } from '../../services/SeoValidator.js';

const router: Router = Router();
const appRepository = new AppRepository();

// SECURITY: Apply ownership validation to all publish routes
// Prevents cross-tenant access to build artifacts and source archives
router.use('/apps/:id', validateAppOwnership);

/**
 * POST /apps/:id/publish
 *
 * Creates a production archive (tar.gz) for deployment. Supports two strategies:
 *
 * **Default strategy** (AAB apps):
 * 1. Get current commit hash from HEAD
 * 2. Check git status to verify repository state
 * 3. Get commit details from git log to validate the commit exists
 * 4. Build verification - run `npm run build` to ensure project is buildable
 * 5. Create archive at {DIST_DIR}/{commitHash}.tar.gz
 *    - Auto-detects content: dist-only if bundled server exists, full-source otherwise
 *
 * **PaaS strategy** (`deploymentStrategy: "paas"`):
 * 0. Verify preview HTTP server is responding (curl check via dev-supervisor)
 * 1. Skip git operations entirely
 * 2. Generate hex timestamp identifier (e.g., "019cab3def12")
 * 3. Run build via dev-supervisor
 * 4. Create full-source archive (includes package.json, src/, excludes node_modules, .git, .env*)
 *
 * For local dev with unified job (AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH set):
 * - Performs production-parity publish: archive → extract → run bundled JavaScript with .env.local
 * - Calls publish supervisor to update symlink and restart app
 *
 * Note: Database migrations are handled during development by the develop agent
 * and are committed to the repository before publish.
 *
 * @route POST /apps/:id/publish
 * @param {string} req.params.id - The application ID
 * @param {string} [req.body.deploymentStrategy] - Optional: "paas" for PaaS flow (skips git, uses full-source)
 *
 * @returns {Object} Response object
 * @returns {boolean} response.success - Whether the operation succeeded
 * @returns {string} response.commitHash - Git SHA (default) or hex timestamp (PaaS)
 * @returns {Object} response.archive - Archive information
 * @returns {string} response.archive.path - Path to the created archive
 *
 * @throws {400} If build fails or git operations fail
 * @throws {404} If app is not found
 * @throws {500} If git operations fail
 *
 * @example
 * // Default request (no body needed)
 * POST /apps/abc123/publish
 *
 * // PaaS request
 * POST /apps/abc123/publish
 * { "deploymentStrategy": "paas" }
 *
 * // Response
 * {
 *   "success": true,
 *   "commitHash": "a1b2c3d4e5f6789012345678901234567890abcd",
 *   "archive": {
 *     "path": "/publish/dist/a1b2c3d4e5f6789012345678901234567890abcd.tar.gz"
 *   }
 * }
 */
router.post('/apps/:id/publish', requirePermission('canPublish'), async (req, res) => {
  try {
    const { id } = req.params;
    const { deploymentStrategy } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const contextLogger = log.forApp(id);

    // Check publish permission from JWT claims
    const authReq = req as AuthenticatedRequest;
    if (!authReq.agentContext?.canPublish) {
      contextLogger.error('route.publish.forbidden', {
        reason: 'missing_canPublish_permission',
      });
      return res.status(403).json({
        error: 'Publish not allowed',
        details: 'Airo Plus subscription required to publish apps'
      });
    }

    // Get app from database
    const app = appRepository.findById(id);
    if (!app) {
      contextLogger.error('route.publish.app-not-found', {});
      return res.status(404).json({ error: 'App not found' });
    }

    const devSupervisor = DevSupervisorClientFactory.createForApp(id);
    const workspace = createForWorkspace(id, 'preview');
    const gitUtils = new GitUtils(workspace?.tasks);

    // Check if dev-supervisor is available
    if (!devSupervisor) {
      contextLogger.error('route.publish.build.supervisor-unavailable', {});
      return res.status(500).json({
        error: 'Dev supervisor not available',
        details: 'Unable to execute build - dev supervisor connection not established'
      });
    }

    // Detect environment and job type for archive path
    const isLocalDev = !process.env.NOMAD_ALLOC_DIR;
    const publishSocketPath = process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;
    const isUnifiedJob = isLocalDev || (publishSocketPath && existsSync(publishSocketPath));
    const targetDir = isUnifiedJob && isLocalDev ? '/dist' : undefined;

    // Get strategy via factory
    const strategy = getPublishStrategy(deploymentStrategy);
    contextLogger.info('route.publish.strategy-selected', {
      strategy: strategy.key,
    });

    // Create context for strategy
    const publishContext: PublishContext = {
      appId: id,
      appPath: app.path,
      targetDir,
      devSupervisor,
      gitUtils,
      logger: contextLogger,
    };

    // Execute strategy - Phase 1: Prepare build artifact
    let fullCommitHash: string;
    let archivePath: string;

    try {
      const result = await strategy.prepareBuild(publishContext);
      fullCommitHash = result.commitHash;
      archivePath = result.archivePath;

      // Publish merges the feature branch to main via GitUtils directly,
      // bypassing GitHookService. Clear stale branch tracking so subsequent
      // messages create a fresh feature branch instead of referencing the
      // deleted one.
      const gitHookService = getGitHookService();
      if (gitHookService.hasActiveBranch(id)) {
        gitHookService.clearBranchTracking(id);
        contextLogger.info('route.publish.branch_tracking_cleared', { appId: id });
      }
    } catch (error) {
      if (error instanceof BuildError) {
        return res.status(400).json({
          error: error.message,
          details: error.details,
          exitCode: error.exitCode,
        });
      }
      if (error instanceof PreviewNotRunningError) {
        // Use 503 for system/connection errors, 400 for known bad states
        const statusCode = error.isSystemError ? 503 : 400;
        return res.status(statusCode).json({
          error: error.message,
          processState: error.processState,
          details: error.details,
        });
      }
      if (error instanceof MissingStartCommandError) {
        return res.status(error.statusCode).json({
          error: error.message,
          preflight: error.preflight,
        });
      }
      throw error;
    }

    // Step 5 (v4 unified only): Call publish supervisor to update symlink and reload app
    let publishResult: PublishSuccessResponse | null = null;
    if (isUnifiedJob) {
      contextLogger.info('route.publish.supervisor.begin', {
        commitHash: fullCommitHash.substring(0, 7),
        socketPath: publishSocketPath || 'tcp',
        isLocalDev,
      });

      try {
        // Create publish supervisor client
        // For production: use Unix socket from env var
        // For local dev: look up TCP path from database
        let publishSupervisor: DevSupervisorClient | null = null;

        if (publishSocketPath) {
          // Production: use provided socket path
          publishSupervisor = DevSupervisorClientFactory.createForSocketPath(publishSocketPath, id);
        } else {
          // Local dev: look up from database
          const app = appRepository.findById(id);
          if (app?.publishSupervisorPath) {
            publishSupervisor = DevSupervisorClientFactory.createForSocketPath(app.publishSupervisorPath, id);
          }
        }

        if (!publishSupervisor) {
          throw new Error('Failed to create publish supervisor client');
        }

        // Phase 2: Deploy to publish supervisor (strategy handles recovery logic)
        const publishRequest: PublishRequest = {
          commitHash: fullCommitHash,
          force: false,
          waitForHealthy: true,
          healthTimeoutSeconds: strategy.key === 'paas' ? 120 : 60
        };

        const publishResponse = await strategy.deploy(
          publishSupervisor,
          publishRequest,
          contextLogger
        );

        if (publishResponse.status === 'error') {
          contextLogger.error('route.publish.supervisor.failed', {
            commitHash: fullCommitHash.substring(0, 7),
            error: publishResponse.error,
            healthStatus: publishResponse.healthStatus,
          });
          return res.status(500).json({
            error: 'Publish supervisor failed',
            details: publishResponse.error,
            logs: publishResponse.logs,
            exitCode: publishResponse.exitCode,
            healthStatus: publishResponse.healthStatus,
            healthCheckDuration: publishResponse.healthCheckDuration
          });
        }

        publishResult = publishResponse;

        contextLogger.info('route.publish.supervisor.success', {
          commitHash: fullCommitHash.substring(0, 7),
          version: publishResult.version,
          healthStatus: publishResult.healthStatus,
          healthCheckDuration: publishResult.healthCheckDuration,
        });
      } catch (error) {
        contextLogger.error('route.publish.supervisor.failed', {
          commitHash: fullCommitHash.substring(0, 7),
          error: error instanceof Error ? error.message : String(error),
        });
        return res.status(500).json({
          error: 'Failed to call publish supervisor',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }

    contextLogger.info('route.publish.success', {
      commitHash: fullCommitHash.substring(0, 7),
      fullCommitHash,
      archivePath,
      isUnifiedJob,
    });

    const response: any = {
      success: true,
      commitHash: fullCommitHash,
      archive: {
        path: archivePath,
      },
    };

    if (publishResult) {
      response.supervisor = {
        version: publishResult.version,
        startupTime: publishResult.startupTime,
        healthStatus: publishResult.healthStatus,
        healthCheckDuration: publishResult.healthCheckDuration
      };
      // Flag for local dev UI to show success immediately (no polling needed)
      if (isLocalDev) {
        response.published = true;
      }
    }

    res.json(response);

    // Advisory SEO validation - fire-and-forget, never blocks publish.
    // Reuse the app record from line 106 — nothing in this route updates
    // publishedUrl, so a second DB read would return the same value.
    const publishedUrl = app.publishedUrl ?? null;
    if (publishedUrl) {
      validatePublishedSeo(publishedUrl, { logger: contextLogger }).catch((err) => {
        contextLogger.warn('seo.validation.exception', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } else {
      contextLogger.info('seo.validation.skipped', { reason: 'no-published-url' });
    }
    return;
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : log.forAgent('publish-routes');
    log.error(contextLogger, 'route.publish.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to publish archive',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /apps/:id/unpublish
 *
 * Removes the published version so the app reverts to the Coming Soon page.
 * Calls the publish supervisor to delete the `current` symlink and restart the process.
 *
 * @route POST /apps/:id/unpublish
 * @param {string} req.params.id - The application ID
 *
 * @returns {Object} Response object
 * @returns {boolean} response.success - Whether the operation succeeded
 *
 * @throws {400} If app ID is missing
 * @throws {404} If app is not found
 * @throws {500} If publish supervisor is unavailable or unpublish fails
 */
router.post('/apps/:id/unpublish', requirePermission('canPublish'), async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const contextLogger = log.forApp(id);

    const app = appRepository.findById(id);
    if (!app) {
      contextLogger.error('route.unpublish.app-not-found', {});
      return res.status(404).json({ error: 'App not found' });
    }

    const publishSocketPath = process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;
    let publishSupervisor: DevSupervisorClient | null = null;

    if (publishSocketPath && existsSync(publishSocketPath)) {
      publishSupervisor = DevSupervisorClientFactory.createForSocketPath(publishSocketPath, id);
    } else if (app.publishSupervisorPath) {
      publishSupervisor = DevSupervisorClientFactory.createForSocketPath(app.publishSupervisorPath, id);
    }

    if (!publishSupervisor) {
      contextLogger.error('route.unpublish.supervisor-unavailable', {});
      return res.status(500).json({
        error: 'Publish supervisor not available',
        details: 'Unable to unpublish - publish supervisor connection not established'
      });
    }

    contextLogger.info('route.unpublish.begin', {
      socketPath: publishSocketPath || app.publishSupervisorPath || 'unknown',
    });

    const response: UnpublishResponse = await publishSupervisor.unpublish();

    contextLogger.info('route.unpublish.success', {
      status: response.status,
    });

    return res.json({ success: true, status: response.status });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : log.forAgent('publish-routes');
    log.error(contextLogger, 'route.unpublish.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to unpublish',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /apps/:id/publish/restart
 *
 * Gracefully restarts the published app's process via the publish supervisor.
 * Mirrors the preview restart endpoint (POST /apps/:id/restart) but targets
 * the publish container.
 */
router.post('/apps/:id/publish/restart', requirePermission('canPublish'), async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'App ID is required' });
  }

  const contextLogger = log.forApp(id);
  contextLogger.info('route.publish.restart.begin', {});

  try {
    const publishSocketPath = process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;
    let publishSupervisor: DevSupervisorClient | null = null;

    if (publishSocketPath && existsSync(publishSocketPath)) {
      publishSupervisor = DevSupervisorClientFactory.createForSocketPath(publishSocketPath, id);
    } else {
      const app = appRepository.findById(id);
      if (!app) {
        contextLogger.error('route.publish.restart.app-not-found', {});
        return res.status(404).json({ error: 'App not found' });
      }
      if (app.publishSupervisorPath) {
        publishSupervisor = DevSupervisorClientFactory.createForSocketPath(app.publishSupervisorPath, id);
      }
    }

    if (!publishSupervisor) {
      contextLogger.error('route.publish.restart.supervisor-unavailable', {});
      return res.status(500).json({
        error: 'Publish supervisor not available',
        details: 'Unable to restart - publish supervisor connection not established'
      });
    }

    const result = await publishSupervisor.restartProcess({ graceful: true });

    if (!result.success) {
      const failureMessage =
        result.error ?? 'supervisor returned success=false with no error message';
      contextLogger.error('route.publish.restart.supervisor-failure', { error: failureMessage });
      return res.status(500).json({
        error: 'Failed to restart published server',
        details: failureMessage
      });
    }

    contextLogger.info('route.publish.restart.success', {});
    return res.json({ success: true, message: `Published server restarted for app ${id}` });
  } catch (error) {
    log.error(contextLogger, 'route.publish.restart.failure', error as Error, {});
    return res.status(500).json({
      error: 'Failed to restart published server',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
