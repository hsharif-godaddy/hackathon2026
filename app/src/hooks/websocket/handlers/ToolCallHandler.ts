/**
 * Tool Call Handler
 *
 * Handles tool_call messages with complete tool input.
 * Updates existing tool start segment with full input data.
 */

import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { fileOperationHandler } from './FileOperationHandler'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

export class ToolCallHandler implements MessageHandler {
  readonly type = 'tool_call'

  async handle(data: WebSocketMessage, context: MessageContext): Promise<void> {
    if (data.data?.tool) {
      // Flush any buffered deltas before processing complete tool call
      context.actions.flushToolDeltaBufferImmediate()

      const tool = data.data.tool as any

      const toolCall: ToolCall = {
        id: tool.id,
        name: tool.name,
        input: tool.input || {},
        status: 'running',
      }
      context.actions.addToolCallSegment(toolCall)

      // Track file operations for Code view synchronization
      await fileOperationHandler.handle(data)
    }
  }
}
