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

    // Get commit history
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

    return res.json({ 
      success: true, 
      commits: result.commits || []
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
 * Checkout a specific commit
 */
router.post('/apps/:id/git/checkout', async (req, res) => {
  try {
    const { id } = req.params;
    const { commitHash } = req.body;

    if (!commitHash) {
      return res.status(400).json({ error: 'Commit hash is required' });
    }

    // Get app path from database
    const app = appRepository.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    // First save the current HEAD position
    const currentBranchResult = await gitTool.executeGitOperation(app.path, {
      operation: 'branch'
    });

    if (!currentBranchResult.success) {
      return res.status(400).json({ 
        error: 'Failed to get current branch', 
        details: currentBranchResult.error 
      });
    }

    const currentBranch = currentBranchResult.currentBranch || 'HEAD';
    
    // Create a temporary branch at the specified commit
    const branchName = `temp-view-${commitHash.substring(0, 7)}`;
    
    // Checkout the specific commit
    const result = await gitTool.executeGitOperation(app.path, {
      operation: 'checkout',
      branch: commitHash
    });

    if (!result.success) {
      return res.status(400).json({ 
        error: 'Failed to checkout commit', 
        details: result.error 
      });
    }

    return res.json({ 
      success: true, 
      message: `Checked out commit ${commitHash}`,
      previousBranch: currentBranch
    });
  } catch (error) {
    console.error('Error checking out commit:', error);
    return res.status(500).json({ 
      error: 'Failed to checkout commit',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Return to the previous branch
 */
router.post('/apps/:id/git/return', async (req, res) => {
  try {
    const { id } = req.params;
    const { branch = 'main' } = req.body;

    // Get app path from database
    const app = appRepository.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }
    
    // Return to the previous branch
    const result = await gitTool.executeGitOperation(app.path, {
      operation: 'checkout',
      branch
    });

    if (!result.success) {
      return res.status(400).json({ 
        error: 'Failed to return to branch', 
        details: result.error 
      });
    }

    return res.json({ 
      success: true, 
      message: `Returned to branch ${branch}`
    });
  } catch (error) {
    console.error('Error returning to branch:', error);
    return res.status(500).json({ 
      error: 'Failed to return to branch',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
