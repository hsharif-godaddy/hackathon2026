import { Router } from 'express';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { GitTool } from '../../tools/git-tool.js';
import path from 'path';

const router: Router = Router();
const gitTool = new GitTool();
const appRepository = new AppRepository();

/**
 * Get commit history for an app
 */
router.get('/apps/:id/git/history', async (req, res) => {
  try {
    const { id } = req.params;
    const { count = 30 } = req.query;

    // Get app path from database
    const app = appRepository.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

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
    console.log(`Git history API returning ${commits.length} commits, showing all commits regardless of checked out commit`);
    
    return res.json({ 
      success: true, 
      commits: commits
    });
  } catch (error) {
    console.error('Error getting commit history:', error);
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

    if (!commitHash) {
      return res.status(400).json({ error: 'Commit hash is required' });
    }

    console.log(`🔎 Git: App ${id} checking out commit ${commitHash.substring(0, 7)}`);

    // Get app path from database
    const app = appRepository.findById(id);
    if (!app) {
      console.error(`❌ Git: App ${id} not found`);
      return res.status(404).json({ error: 'App not found' });
    }

    // First save the current HEAD position
    const currentBranchResult = await gitTool.executeGitOperation(app.path, {
      operation: 'branch'
    });

    if (!currentBranchResult.success) {
      console.error(`❌ Git: Failed to get current branch for app ${id}`);
      return res.status(400).json({ 
        error: 'Failed to get current branch', 
        details: currentBranchResult.error 
      });
    }

    const currentBranch = currentBranchResult.currentBranch || 'HEAD';
    console.log(`ℹ️ Git: App ${id} current branch state before checkout: ${currentBranch}`);
    
    // Create a temporary branch at the specified commit
    const branchName = `temp-view-${commitHash.substring(0, 7)}`;
    
    // Checkout the specific commit
    const result = await gitTool.executeGitOperation(app.path, {
      operation: 'checkout',
      branch: commitHash
    });

    if (!result.success) {
      console.error(`❌ Git: Failed to checkout commit ${commitHash.substring(0, 7)} for app ${id}:`, result.error);
      return res.status(400).json({ 
        error: 'Failed to checkout commit', 
        details: result.error 
      });
    }

    console.log(`✅ Git: Successfully checked out commit ${commitHash.substring(0, 7)} for app ${id}. Previous branch: ${currentBranch}`);
    console.log(`⚠️ Git: App ${id} is now in detached HEAD state. Any changes should be made after returning to main branch.`);

    return res.json({ 
      success: true, 
      message: `Checked out commit ${commitHash}`,
      previousBranch: currentBranch,
      isDetachedHead: true
    });
  } catch (error) {
    console.error(`❌ Git: Error checking out commit for app ${req.params.id}:`, error);
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

    console.log(`🔄 Git: Returning app ${id} to ${branch} branch`);

    // Get app path from database
    const app = appRepository.findById(id);
    if (!app) {
      console.error(`❌ Git: App ${id} not found`);
      return res.status(404).json({ error: 'App not found' });
    }
    
    // First, check current branch status
    const statusResult = await gitTool.executeGitOperation(app.path, {
      operation: 'branch'
    });

    // Log current state before attempting checkout
    if (statusResult.success) {
      const currentBranch = statusResult.currentBranch || 'detached HEAD';
      console.log(`ℹ️ Git: App ${id} current branch state: ${currentBranch}`);
    } else {
      console.warn(`⚠️ Git: Could not determine current branch for app ${id}`);
    }
    
    // Return to the specified branch
    const result = await gitTool.executeGitOperation(app.path, {
      operation: 'checkout',
      branch
    });

    if (!result.success) {
      console.error(`❌ Git: Failed to return to ${branch} branch:`, result.error);
      return res.status(400).json({ 
        error: `Failed to return to ${branch} branch`, 
        details: result.error 
      });
    }

    console.log(`✅ Git: Successfully returned app ${id} to ${branch} branch`);
    
    return res.json({ 
      success: true, 
      message: `Returned to branch ${branch}`,
      previousState: statusResult.success ? statusResult.currentBranch : 'unknown'
    });
  } catch (error) {
    console.error(`❌ Git: Error returning app to branch:`, error);
    return res.status(500).json({ 
      error: 'Failed to return to branch',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
