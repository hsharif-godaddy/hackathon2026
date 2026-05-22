import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { TerminalTool, TerminalCommandOptions } from '../terminal.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { createForWorkspace } from '../../workspace/index.js'

const appRepo = new AppRepository()

export const terminalCommandAITool: Tool = createTool(
  'Run shell commands in the app directory (npm, git, build, test, etc.). ' +
  'Max 1000 chars. Blocked: system paths (/etc /bin /usr /var), sudo, rm -rf /, curl/wget in $() subshells. ' +
  'Use str_replace_based_edit_tool for file creation, not redirects. If blocked, try a different approach — no retries.',
  z.object({
    command: z.string().describe('Shell command to execute'),
    workingDir: z.string().default('').describe('Relative to app root'),
    timeout: z.number().min(1000).max(300000).default(30000).describe('Timeout in ms'),
    env: z.record(z.string(), z.string()).optional().describe('Extra environment variables')
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

    const workspace = createForWorkspace(appId, 'preview')
    if (!workspace) {
      throw new Error('dev-supervisor unavailable — cannot execute terminal commands')
    }

    const terminalTool = new TerminalTool(workspace.tasks)

    const result = await terminalTool.executeCommand(app.path, input as TerminalCommandOptions)
    return terminalTool.formatResult(result)
  }
)
