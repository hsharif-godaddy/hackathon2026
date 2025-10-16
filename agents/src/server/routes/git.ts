import { Router } from 'express';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { GitTool } from '../../tools/git-tool.js';
import { Logger, log } from '../../logging/index.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';

const router: Router = Router();
const appRepository = new AppRepository();
const gitLogger = Logger.create({ service: 'git-routes' });

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
        shorthash: commitHash
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

export default router;
