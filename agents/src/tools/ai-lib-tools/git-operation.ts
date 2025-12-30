import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { GitTool, GitToolOptions } from '../git-tool.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js'

// Initialize tool instances
const appRepo = new AppRepository()

/**
 * Git Operation Tool for AI-Lib
 * Perform git operations like status, add, commit, diff, log, branch management, etc.
 */
export const gitOperationAITool: Tool = createTool(
  'Perform git operations like status, add, commit, diff, log, branch management, etc. Provides comprehensive git functionality.',
  z.object({
    operation: z.enum(['status', 'add', 'commit', 'diff', 'log', 'branch', 'checkout', 'merge', 'pull', 'push', 'stash', 'reset', 'revert']).describe('The git operation to perform'),
    files: z.array(z.string()).optional().describe('Files to operate on (for add, diff, etc.)'),
    message: z.string().optional().describe('Commit message (for commit operation)'),
    branch: z.string().optional().describe('Branch name (for checkout, merge, etc.)'),
    options: z.object({
      all: z.boolean().optional().describe('Include all files (for add, commit)'),
      amend: z.boolean().optional().describe('Amend last commit (for commit)'),
      force: z.boolean().optional().describe('Force operation (for push, checkout)'),
      mode: z.enum(['soft', 'mixed', 'hard']).optional().describe('Reset mode (for reset operation)'),
      count: z.number().optional().describe('Number of commits (for log, reset)'),
      createBranch: z.boolean().optional().describe('Create new branch (for checkout)'),
      includeUntracked: z.boolean().optional().describe('Include untracked files (for stash)'),
      verbose: z.boolean().optional().describe('Verbose output'),
      hash: z.string().optional().describe('Commit hash (for revert, restore operations)')
    }).optional(),
    autoMessage: z.boolean().default(false).describe('Auto-generate commit message from recent file changes'),
    dryRun: z.boolean().default(false).describe('Preview operation without executing')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for git operations')
    }

    const app = appRepo.findById(appId)
    if (!app) {
      throw new Error(`App '${appId}' not found`)
    }

    // Create git tool with dev-supervisor for this specific app
    const devSupervisor = DevSupervisorClientFactory.createForApp(appId)
    const gitTool = new GitTool(devSupervisor || undefined)

    const result = await gitTool.executeGitOperation(app.path, input as GitToolOptions)
    return gitTool.formatResult(result)
  }
)
