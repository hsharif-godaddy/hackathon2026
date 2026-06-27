import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { getKvMemoryStore } from '../../memory/adapters/index.js'
import { customerIdFromContext, workspaceScopeFromAppId } from '../../memory/interfaces/scope.js'
import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'set-agent-mode-tool' })
const memoryStore = getKvMemoryStore()
const MEMORY_KEY = 'app.agent_mode'

export const AgentModeSchema = z.object({
  mode: z.enum(['deep-build']).describe('The agent mode to persist.'),
})

export const setAgentModeAITool: Tool = createTool(
  "Set the app's default agent mode. Call this once on first activation to persist the agent selection for future sessions.",
  AgentModeSchema,
  async (input, context) => {
    const appId: string | undefined = context?.metadata?.appId as string | undefined
    if (!appId) {
      return '**Error:** No app ID available in context'
    }

    const scope = workspaceScopeFromAppId(appId, customerIdFromContext(context))
    const writeResult = await memoryStore.set(scope, MEMORY_KEY, { mode: input.mode })
    if (!writeResult.success) {
      logger.warn('setAgentMode.write.failed', { appId, error: writeResult.error ?? 'Unknown error' })
      return `**Error:** Failed to save agent mode: ${writeResult.error ?? 'Unknown error'}`
    }

    logger.info('setAgentMode.success', { appId, mode: input.mode })
    return `Agent mode set to ${input.mode}.`
  },
)
