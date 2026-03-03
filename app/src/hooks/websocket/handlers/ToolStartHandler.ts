/**
 * Tool Start Handler
 *
 * Handles tool_start messages indicating a tool execution has begun.
 * Creates a new tool call segment in the active stream.
 */

import type { ToolCall } from '@/stores/useStreamingConversationStore'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class ToolStartHandler implements MessageHandler {
  readonly type = 'tool_start'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    if (data.data?.tool) {
      const tool = data.data.tool as any

      const toolCall: ToolCall = {
        id: tool.id || `tool_${Date.now()}`,
        name: tool.name,
        input: tool.input || {},
        status: 'running',
        startTime: Date.now(),
      }
      context.actions.addToolStartSegment(toolCall)
    }
  }
}
