import { Router } from 'express';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { GitTool } from '../../tools/git-tool.js';
import { GitUtils } from '../../utils/git.js';
import { log } from '../../logging/index.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';

const router: Router = Router();
const appRepository = new AppRepository();

/** Default page size; keep in sync with app `GIT_HISTORY_PAGE_SIZE` (`app/src/services/AppService.ts`). */
const GIT_HISTORY_DEFAULT_COUNT = 30;
const GIT_HISTORY_MAX_COUNT = 200;
const GIT_HISTORY_MAX_OFFSET = 100_000;

function parseGitHistoryCount(value: unknown): number | null {
  if (value === undefined || value === '') {
    return GIT_HISTORY_DEFAULT_COUNT;
  }
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(typeof raw === 'string' ? raw.trim() : raw);
  if (!Number.isInteger(n) || n < 1 || n > GIT_HISTORY_MAX_COUNT) {
    return null;
  }
  return n;
}

function parseGitHistoryOffset(value: unknown): number | null {
  if (value === undefined || value === '') {
    return 0;
  }
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(typeof raw === 'string' ? raw.trim() : raw);
  if (!Number.isInteger(n) || n < 0 || n > GIT_HISTORY_MAX_OFFSET) {
    return null;
  }
  return n;
}

/**
 * Get commit history for an app
 * SECURITY: Ownership validation prevents cross-tenant git history access
 */
router.get('/apps/:id/git/history', validateAppOwnership, async (req, res) => {
  try {
    const id = req.params.id!; // Validated by validateAppOwnership middleware
    const count = parseGitHistoryCount(req.query.count);
    const offset = parseGitHistoryOffset(req.query.offset);
    if (count === null || offset === null) {
      return res.status(400).json({
        error: 'Invalid git history query parameters',
        details: 'count must be an integer 1-' + GIT_HISTORY_MAX_COUNT + ', offset must be an integer 0-' + GIT_HISTORY_MAX_OFFSET,
      });
    }
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

    // Fetch one extra commit so the API can return hasMore without an extra round-trip.
    const result = await gitTool.executeGitOperation(app.path, {
      operation: 'log',
      options: {
        count: count + 1,
        offset
      }
    });

    if (!result.success) {
      return res.status(400).json({
        error: 'Failed to get commit history',
        details: result.error
      });
    }

    const commits = result.commits || [];
    const hasMore = commits.length > count;
    const visibleCommits = hasMore ? commits.slice(0, count) : commits;

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
      commitCount: visibleCommits.length,
      hasMore,
      currentCommit: currentCommit?.substring(0, 7),
    });

    return res.json({
      success: true,
      commits: visibleCommits,
      hasMore,
      currentCommit: currentCommit
    });
  } catch (error) {
    const contextLogger = log.forApp(req.params.id!);
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
 * SECURITY: Ownership validation prevents cross-tenant git checkout operations
 */
router.post('/apps/:id/git/checkout', validateAppOwnership, async (req, res) => {
  try {
    const id = req.params.id!; // Validated by validateAppOwnership middleware
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
    const contextLogger = log.forApp(req.params.id!);
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
 * SECURITY: Ownership validation prevents cross-tenant git operations
 */
router.post('/apps/:id/git/return', validateAppOwnership, async (req, res) => {
  try {
    const id = req.params.id!; // Validated by validateAppOwnership middleware
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
    const contextLogger = log.forApp(req.params.id!);
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
 * SECURITY: Ownership validation prevents cross-tenant git restore operations
 */
router.post('/apps/:id/git/restore', validateAppOwnership, async (req, res) => {
  try {
    const id = req.params.id!; // Validated by validateAppOwnership middleware
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
    const contextLogger = log.forApp(req.params.id!);
    log.error(contextLogger, 'route.git.restore-files.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to restore files from commit',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
