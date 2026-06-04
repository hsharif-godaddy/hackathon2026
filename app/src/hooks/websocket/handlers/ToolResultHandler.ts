/**
 * Tool Result Handler
 *
 * Handles tool_result messages containing tool execution results.
 * Updates tool call segment with result and updates persistent todo list if applicable.
 */

import { trackToolResult } from '@/hooks/shared/completionSideEffects'
import { mapToolResult } from '@/hooks/shared/toolMappers'
import { handleToolResultSideEffects } from '@/hooks/shared/toolSideEffects'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class ToolResultHandler implements MessageHandler {
  readonly type = 'tool_result'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    if (data.data?.tool) {
      context.actions.flushToolDeltaBufferImmediate()
      const tool = data.data.tool as any
      trackToolResult(tool)
      context.actions.addToolResultSegment(mapToolResult(tool))
      await handleToolResultSideEffects(tool, context.currentAppId)
    }
  }
}
