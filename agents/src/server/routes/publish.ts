import { existsSync } from 'node:fs';

import { PublishErrorCode } from '@airo/shared/publish';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import { createForWorkspace } from '../../workspace/index.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { MemoryRepository } from '../../database/repositories/MemoryRepository.js';
import { GitUtils } from '../../utils/git.js';
import { log } from '../../logging/index.js';
import { Router } from 'express';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import type { DevSupervisorClient, PublishRequest, PublishSuccessResponse, UnpublishResponse } from '../../services/DevSupervisorClient.js';
import { requirePermission } from '../middleware/require-permission.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { getPublishStrategy, BuildError, PreviewNotRunningError, MissingStartCommandError } from './publish/strategies/index.js';
import type { PublishContext } from './publish/strategies/index.js';
import { getGitHookService } from '../agent-runtime.js';
import { AdSensePublishManifestService } from '../../services/AdSensePublishManifestService.js';
import { logSeoAuditReport, runSeoAudit } from '../../services/seo-audit.js';
import type { SeoAuditReport } from '../../services/seo-audit.js';
import { reportPublishedComplianceStatus } from '../../services/compliance-publish-report.js';
import { scoreAuditReport, detectRegressionFromSnapshot } from '../../services/SeoQualityScorer.js';
import { SeoQualityRepository } from '../../database/repositories/SeoQualityRepository.js';
import type { ILogger } from '../../logging/types.js';
import { resolvePublicHttpsFetchUrl } from '../../utils/public-fetch-url.js';

const router: Router = Router();
const appRepository = new AppRepository();
const memoryRepository = new MemoryRepository();
const seoQualityRepo = new SeoQualityRepository();

// Tracks appIds with an in-progress SEO audit to prevent concurrent audits
// from producing out-of-order snapshots that break regression detection.
const seoAuditInProgress = new Set<string>();

async function captureSeoQuality(
  appId: string,
  report: SeoAuditReport,
  contextLogger: Pick<ILogger, 'info' | 'warn' | 'error'>,
): Promise<void> {
  const result = scoreAuditReport(report);

  if (result.pageCount === 0) {
    contextLogger.warn('seo.quality.empty-report', {
      appId,
      reason: 'audit returned no pages — skipping snapshot',
    });
    return;
  }

  const previous = seoQualityRepo.findLatest(appId);
  const snapshot = seoQualityRepo.save({
    appId,
    score: result.score,
    pageScores: result.pageScores,
    missingElements: result.missingElements,
    triggeredBy: 'publish',
  });

  contextLogger.info('seo.quality.scored', {
    appId,
    snapshotId: snapshot.id,
    score: result.score,
    pageCount: result.pageCount,
    pagesWithIssues: result.pagesWithIssues,
    isBaseline: snapshot.isBaseline,
    triggeredBy: 'publish',
  });

  if (previous) {
    const regression = detectRegressionFromSnapshot(result, previous);
    if (regression.isRegression) {
      contextLogger.warn('seo.quality.regression', {
        appId,
        currentScore: result.score,
        previousScore: previous.score,
        scoreDelta: regression.scoreDelta,
        affectedPages: regression.regressions.map(r => ({
          path: r.path,
          newIssues: r.newIssues,
        })),
      });
    }
  }
}

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
    const authReq = req as AuthenticatedRequest;

    // Enforce token freshness for AAB before trusting claims (PaaS tokens may be longer-lived)
    if (authReq.agentContext?.product !== 'PaaSNodeJS') {
      const iat = authReq.agentContext?.iat;
      if (iat == null) {
        contextLogger.warn('route.publish.token-missing-iat', {});
        return res.status(401).json({
          error: 'Token missing iat',
          details: 'Publish requires a token with an issued-at claim. Please retry.',
          code: PublishErrorCode.TokenStale,
        });
      }
      const tokenAge = Math.floor(Date.now() / 1000) - iat;
      if (tokenAge > 30) {
        contextLogger.warn('route.publish.token-stale', { tokenAge, iat });
        return res.status(401).json({
          error: 'Token too old for publish',
          details: 'Publish requires a recently issued token. Please retry.',
          code: PublishErrorCode.TokenStale,
        });
      }
    }

    // Get app from database
    const app = appRepository.findById(id);
    if (!app) {
      contextLogger.error('route.publish.app-not-found', {});
      return res.status(404).json({ error: 'App not found' });
    }

    // Logo pre-publish guard: revert/strip any media slot still carrying a
    // pending logo job (shimmer placeholder / mid-regeneration) BEFORE the build
    // archives the committed manifest, so the published archive never ships an
    // in-progress placeholder. Best-effort — must never fail the publish. Dynamic
    // import keeps the logo/WS module graph out of route eval (see media.ts).
    try {
      const { reconcilePendingLogoSlotsForPublish } = await import('../../services/logo/logo-reconciler.js');
      await reconcilePendingLogoSlotsForPublish(id);
    } catch (error) {
      contextLogger.warn('route.publish.logo_guard_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const workspace = createForWorkspace(id, 'preview');

    if (!workspace) {
      contextLogger.error('route.publish.workspace.unavailable', {});
      return res.status(503).json({ error: 'Preview container is not available' });
    }

    const gitUtils = new GitUtils(workspace.tasks);

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
      tasks: workspace.tasks,
      gitUtils,
      logger: contextLogger,
      runtime: workspace.runtime,
      ...(strategy.key === 'default'
        ? {
            runtimeArtifactHooks: [
              async () => {
                await new AdSensePublishManifestService().writeForPublish(id, workspace);
              },
            ],
          }
        : {}),
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

    // Advisory SEO validation + quality scoring — fire-and-forget; never blocks publish.
    // Runs on every publish: HTML audit when published_url is available, source-only otherwise.
    (async (): Promise<void> => {
      if (seoAuditInProgress.has(id)) {
        contextLogger.info('seo.quality.audit-skipped', { appId: id, reason: 'previous audit still in progress' });
        return;
      }
      seoAuditInProgress.add(id);
      try {
      const bodyUrl = typeof req.body.publishedUrl === 'string' ? req.body.publishedUrl.trim() : null;
      const publishedUrl = resolvePublicHttpsFetchUrl(app.publishedUrl, bodyUrl);
      if ((app.publishedUrl?.trim() || bodyUrl) && !publishedUrl) {
        contextLogger.warn('seo.audit.blocked-url', {
          appId: id,
          hadDbUrl: Boolean(app.publishedUrl?.trim()),
          hadBodyUrl: Boolean(bodyUrl),
        });
      }
      const report = await runSeoAudit({
        appId: id,
        appPath: app.path,
        publishedUrl,
        isPublished: !!publishedUrl,
        includeSourceScan: true,
      });
      logSeoAuditReport(id, report, contextLogger);
      await captureSeoQuality(id, report, contextLogger);
      } finally {
        seoAuditInProgress.delete(id);
      }
    })().catch((err) => {
      contextLogger.error('seo.audit.exception', {
        appId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Compliance document status — fire-and-forget after response; never blocks
    // publish. Reports the published/deleted state of any compliance docs the
    // app generated. Requires a real customerId (the AppRepository default of
    // 'not-provided' is treated as absent — the compliance API is keyed by it).
    const customerId = app.customerId?.trim();
    if (customerId && customerId !== 'not-provided') {
      reportPublishedComplianceStatus(id, customerId, workspace, contextLogger).catch((err) => {
        contextLogger.warn('compliance.publishReport.exception', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } else {
      contextLogger.info('compliance.publishReport.skipped', { reason: 'no-customer-id' });
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

    const updateResult = appRepository.updatePublishedUrl(id, null);
    if (!updateResult) {
      contextLogger.warn('route.unpublish.publishedUrl.clear-failed', {});
    }
    await memoryRepository.set(id, 'site.domains', []);

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

interface PublishStateDomain {
  fqdn: string;
  isPrimary: boolean;
  status: string;
}

interface PublishStateUpdateBody {
  publishedUrl?: string | null;
  domains?: PublishStateDomain[];
}

/**
 * POST /apps/:id/publish-state
 *
 * Accepts a push of current publish and domain state from the UI/BFF.
 * Persists to SQLite so the agent's per-turn context is accurate regardless
 * of whether publish/domain changes happened via chat or the UI.
 *
 * Both fields are optional — callers can update just publishedUrl, just domains, or both.
 * Omitted fields are left unchanged in the DB.
 */
router.post('/apps/:id/publish-state', requirePermission('canPublish'), async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const contextLogger = log.forApp(id);

    const app = appRepository.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const body = req.body as PublishStateUpdateBody;

    if (!('publishedUrl' in body) && !('domains' in body)) {
      return res.status(400).json({ error: 'At least one of publishedUrl or domains is required' });
    }

    let publishedUrl: string | null | undefined;
    if ('publishedUrl' in body) {
      const rawUrl = typeof body.publishedUrl === 'string' ? body.publishedUrl.trim() : null;
      publishedUrl = rawUrl && rawUrl.length < 2048 && /^https?:\/\//.test(rawUrl) ? rawUrl : null;
      appRepository.updatePublishedUrl(id, publishedUrl);
    }

    if (Array.isArray(body.domains)) {
      const domains: PublishStateDomain[] = body.domains
        .filter(d => typeof d.fqdn === 'string' && d.fqdn.trim().length > 0 && d.fqdn.length < 256)
        .slice(0, 50)
        .map(d => ({
          fqdn: d.fqdn.trim().toLowerCase(),
          isPrimary: d.isPrimary ?? false,
          status: d.status ?? 'active',
        }));
      await memoryRepository.set(id, 'site.domains', domains);
    }

    contextLogger.info('route.publishState.updated', {
      publishedUrl: publishedUrl !== undefined ? (publishedUrl ? publishedUrl.slice(0, 200) : null) : 'unchanged',
      domainCount: body.domains?.length,
    });

    return res.json({ success: true });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : log.forAgent('publish-routes');
    log.error(contextLogger, 'route.publishState.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to update publish state',
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
