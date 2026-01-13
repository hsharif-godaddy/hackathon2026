import { existsSync } from 'node:fs';

import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { GitUtils } from '../../utils/git.js';
import { log } from '../../logging/index.js';
import { Router } from 'express';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import type { PublishResponse, PublishSuccessResponse } from '../../services/DevSupervisorClient.js';

const router: Router = Router();
const appRepository = new AppRepository();

/**
 * POST /apps/:id/publish
 *
 * Creates a git archive (tar.gz) of the application at a specific commit.
 * This endpoint performs a five-step workflow:
 * 1. Resolve the commit reference to a full SHA-1 hash (40 characters)
 * 2. Check git status to verify repository state
 * 3. Get commit details from git log to validate the commit exists
 * 4. Build verification - run `npm run build` to ensure project is buildable
 * 5. Create archive at {DIST_DIR}/{fullCommitHash}.tar.gz using git archive
 *
 * Note: Database migrations are handled during development by the develop agent
 * and are committed to the repository before publish. This step no longer
 * generates migrations as they should already exist in the commit being published.
 *
 * @route POST /apps/:id/publish
 * @param {string} req.params.id - The application ID
 * @param {string} req.body.commitHash - The git commit reference (short hash, full hash, tag, branch)
 *
 * @returns {Object} Response object
 * @returns {boolean} response.success - Whether the operation succeeded
 * @returns {string} response.commitHash - The full SHA-1 commit hash (40 characters)
 * @returns {Object} response.archive - Archive information
 * @returns {string} response.archive.path - Path to the created archive
 *
 * @throws {400} If commit reference is missing, invalid, cannot be resolved, or build fails
 * @throws {404} If app is not found
 * @throws {500} If git operations fail
 *
 * @example
 * // Request (with commit hash)
 * POST /apps/abc123/publish
 * {
 *   "commitHash": "a1b2c3d4e5f6789012345678901234567890abcd"
 * }
 *
 * // Response (returns full hash)
 * {
 *   "success": true,
 *   "commitHash": "a1b2c3d4e5f6789012345678901234567890abcd",
 *   "archive": {
 *     "path": "/publish/dist/a1b2c3d4e5f6789012345678901234567890abcd.tar.gz"
 *   }
 * }
 */
router.post('/apps/:id/publish', async (req, res) => {
  try {
    const { id } = req.params;
    const { commitHash } = req.body;
    const contextLogger = log.forApp(id);

    if (!commitHash) {
      return res.status(400).json({ error: 'Commit hash is required' });
    }

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

    contextLogger.info('route.publish.begin', {
      commitHash: commitHash.substring(0, 7),
    });

    // Get app from database
    const app = appRepository.findById(id);
    if (!app) {
      contextLogger.error('route.publish.app-not-found', {});
      return res.status(404).json({ error: 'App not found' });
    }

    // Create GitUtils with dev-supervisor for this specific app
    const devSupervisor = DevSupervisorClientFactory.createForApp(id);
    const gitUtils = new GitUtils(devSupervisor || undefined);

    // Resolve the commit reference to a full SHA
    let fullCommitHash: string;
    try {
      fullCommitHash = await gitUtils.resolveCommitHash(app.path, commitHash);
      contextLogger.info('route.publish.commit-resolved', {
        providedRef: commitHash.substring(0, 7),
        fullHash: fullCommitHash.substring(0, 7),
      });
    } catch (error) {
      contextLogger.error('route.publish.commit-resolve-failed', {
        commitRef: commitHash,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(400).json({
        error: 'Failed to resolve commit reference',
        details: error instanceof Error ? error.message : String(error),
      });
    }

    // Step 1: Check git status to verify repository state
    contextLogger.info('route.publish.git-status.begin', {});

    try {
      const status = await gitUtils.getStatus(app.path);

      contextLogger.info('route.publish.git-status.success', {
        branch: status.branch,
        isClean: status.isClean,
      });
    } catch (error) {
      contextLogger.error('route.publish.git-status.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(400).json({
        error: 'Failed to check git status',
        details: error instanceof Error ? error.message : String(error),
      });
    }

    // Step 2: Get commit details from git log to validate commit exists
    contextLogger.info('route.publish.git-log.begin', {});

    try {
      const commits = await gitUtils.getCommitHistory(app.path, 100);

      // Validate that the requested commit exists in recent history
      const commitExists = commits.some(
        (commit) => commit.hash === fullCommitHash
      );

      if (!commitExists && commits.length > 0) {
        contextLogger.warn('route.publish.commit-not-in-recent-history', {
          commitHash: fullCommitHash.substring(0, 7),
          recentCommitsCount: commits.length,
        });
        // Still proceed - commit might be older than the 100 we checked
      }

      contextLogger.info('route.publish.git-log.success', {
        commitsCount: commits.length,
        latestCommit: commits[0]?.hash.substring(0, 7),
      });
    } catch (error) {
      contextLogger.error('route.publish.git-log.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(400).json({
        error: 'Failed to get commit log',
        details: error instanceof Error ? error.message : String(error),
      });
    }

    // Step 3: Build verification - ensure project is in a buildable state
    contextLogger.info('route.publish.build.begin', {
      commitHash: fullCommitHash.substring(0, 7),
    });

    try {
      if (!devSupervisor) {
        throw new Error('Dev supervisor not available for build verification');
      }

      const buildResult = await devSupervisor.exec({
        command: 'npm run build',
        working_dir: '/app',
        timeout: 120, // 2 minutes
        capture_output: true
      });

      if (!buildResult.success) {
        contextLogger.error('route.publish.build.failed', {
          commitHash: fullCommitHash.substring(0, 7),
          exitCode: buildResult.exit_code,
          stderr: buildResult.stderr,
        });
        return res.status(400).json({
          error: 'Build failed - project is not in a buildable state',
          details: buildResult.stderr || buildResult.stdout,
          exitCode: buildResult.exit_code
        });
      }

      contextLogger.info('route.publish.build.success', {
        commitHash: fullCommitHash.substring(0, 7),
        executionTime: buildResult.execution_time
      });
    } catch (error) {
      contextLogger.error('route.publish.build.failed', {
        commitHash: fullCommitHash.substring(0, 7),
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(400).json({
        error: 'Build verification failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }

    // Step 4: Create archive using GitUtils with full commit hash
    contextLogger.info('route.publish.git-archive.begin', {
      commitHash: fullCommitHash.substring(0, 7),
    });

    let archivePath: string;
    try {
      const archiveResult = await gitUtils.createArchive(
        app.path,
        fullCommitHash
      );
      archivePath = archiveResult.path;

      contextLogger.info('route.publish.git-archive.success', {
        commitHash: fullCommitHash.substring(0, 7),
        archivePath,
      });
    } catch (error) {
      contextLogger.error('route.publish.git-archive.failed', {
        commitHash: fullCommitHash.substring(0, 7),
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(400).json({
        error: 'Failed to create archive',
        details: error instanceof Error ? error.message : String(error),
      });
    }

    // Step 5 (v4 unified only): Call publish supervisor to update symlink and reload app
    // Detect if this is a V4 unified job by checking for publish supervisor socket
    const publishSocketPath = process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;
    const isUnifiedJob = publishSocketPath && existsSync(publishSocketPath);

    let publishResult: PublishSuccessResponse | null = null;
    if (isUnifiedJob) {
      contextLogger.info('route.publish.supervisor.begin', {
        commitHash: fullCommitHash.substring(0, 7),
        socketPath: publishSocketPath,
      });

      try {
        const publishSupervisor = DevSupervisorClientFactory.createForSocketPath(publishSocketPath, id);
        if (!publishSupervisor) {
          throw new Error('Failed to create publish supervisor client');
        }

        const publishResponse: PublishResponse = await publishSupervisor.publish({
          commitHash: fullCommitHash,
          force: false
        });

        if (publishResponse.status === 'error') {
          contextLogger.error('route.publish.supervisor.failed', {
            commitHash: fullCommitHash.substring(0, 7),
            error: publishResponse.error,
          });
          return res.status(500).json({
            error: 'Publish supervisor failed',
            details: publishResponse.error,
            logs: publishResponse.logs,
            exitCode: publishResponse.exitCode
          });
        }

        publishResult = publishResponse;

        contextLogger.info('route.publish.supervisor.success', {
          commitHash: fullCommitHash.substring(0, 7),
          version: publishResult.version,
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
        startupTime: publishResult.startupTime
      };
    }

    return res.json(response);
  } catch (error) {
    const contextLogger = log.forApp(req.params.id);
    log.error(contextLogger, 'route.publish.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to publish archive',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
