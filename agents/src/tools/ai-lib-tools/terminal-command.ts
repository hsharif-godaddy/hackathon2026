import { createTool } from '@airo/ai-lib'
import { z } from 'zod'
import { TerminalTool, TerminalCommandOptions } from '../terminal.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js'

// Initialize tool instances
const appRepo = new AppRepository()

/**
 * Terminal Command Tool for AI-Lib
 * Execute shell commands within the app directory
 */
export const terminalCommandAITool = createTool(
  'Execute shell commands within the app directory. Use for development tasks like npm install, git operations, building, testing, etc.',
  z.object({
    command: z.string().describe('The shell command to execute (e.g., "npm install", "git status", "ls -la")'),
    workingDir: z.string().default('').describe('Working directory relative to app root (default: app root)'),
    timeout: z.number().min(1000).max(300000).default(30000).describe('Maximum execution time in milliseconds'),
    env: z.record(z.string()).optional().describe('Environment variables to set for the command')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for terminal commands')
    }

    const app = appRepo.findById(appId)
    if (!app) {
      throw new Error(`App '${appId}' not found`)
    }

    // Create DevSupervisorClient for the app
    const devSupervisorClient = DevSupervisorClientFactory.createForApp(appId)
    if (!devSupervisorClient) {
      throw new Error('Terminal tool requires dev-supervisor to be available for command execution. This typically means the system is not running in a containerized environment with dev-supervisor installed, or the dev-supervisor socket is not accessible. For security reasons, direct command execution has been disabled.')
    }

    // Create terminal tool instance with the dev-supervisor client
    const terminalTool = new TerminalTool(devSupervisorClient)
    
    const result = await terminalTool.executeCommand(app.path, input as TerminalCommandOptions)
    return terminalTool.formatResult(result)
  }
)
