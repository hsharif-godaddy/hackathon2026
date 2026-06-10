import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'

import { getActionService } from '../../server/agent-runtime.js'

export const screenshotAITool: Tool = createTool(
  'Capture a screenshot of the customer preview iframe. Returns a base64 PNG. Use to verify a page loaded without errors — check the returned data length as a proxy for content presence.',
  z.object({
    type: z.enum(['viewport', 'full']).default('viewport').describe('"viewport" captures the visible area; "full" captures the entire page scrolled.'),
    route: z.string().optional().describe('Navigate to this route before capturing (e.g. "/about"). Omit to capture current page.'),
  }),
  async (input, context) => {
    const socketId: string | undefined =
      (context as Record<string, unknown> | undefined)?.socketId as string | undefined ??
      ((context?.metadata as Record<string, unknown> | undefined)?.sessionId as string | undefined)

    if (!socketId) {
      throw new Error('screenshot requires a client connection (no sessionId in context)')
    }

    const clientActionService = getActionService(socketId)
    if (!clientActionService) {
      throw new Error('No client connection available for screenshot capture')
    }

    const result = await clientActionService.executeAction({
      action: 'screenshot',
      params: { type: input.type, route: input.route },
      timeoutMs: 30000,
    }) as { screenshot?: string }

    if (!result.screenshot) {
      throw new Error('Screenshot capture returned no image data')
    }

    return {
      screenshot: result.screenshot,
      type: input.type,
      route: input.route ?? '(current page)',
    }
  }
)
