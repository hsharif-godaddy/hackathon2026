import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'

import { interactiveSubAgentManager } from '../../agents/interactive-sub-agent-manager.js'
import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'return-to-parent-tool' })

export const returnToParentAITool: Tool = createTool(
  `Signal that you have completed your task and return control to the orchestrator. Call this when your work is done — include a brief summary of what you accomplished and any artifacts created.`,
  z.object({
    summary: z.string().describe('Brief summary of what was accomplished (1-3 sentences)'),
  }),
  async (input, context) => {
    const sessionId: string | undefined =
      (context?.metadata?.sessionId as string | undefined) ??
      (context?.sessionId as string | undefined) ??
      ((context as Record<string, unknown> | undefined)?.socketId as string | undefined)

    if (!sessionId) {
      throw new Error('returnToParent requires a session context (sessionId or socketId)')
    }

    if (!interactiveSubAgentManager.hasActiveSession(sessionId)) {
      throw new Error('returnToParent can only be called by an interactive sub-agent')
    }

    logger.info('returnToParent.called', { sessionId, summary: input.summary.slice(0, 100) })

    await interactiveSubAgentManager.handleReturn(sessionId, input.summary)

    return { ok: true, returned: true }
  }
)
