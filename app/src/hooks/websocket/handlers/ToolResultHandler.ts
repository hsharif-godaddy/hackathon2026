/**
 * Tool Result Handler
 *
 * Handles tool_result messages containing tool execution results.
 * Updates tool call segment with result and updates persistent todo list if applicable.
 */

import { logger } from '@/lib/request-context'
import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { useTodoListStore } from '@/stores/useTodoListStore'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

export class ToolResultHandler implements MessageHandler {
  readonly type = 'tool_result'

  async handle(data: WebSocketMessage, context: MessageContext): Promise<void> {
    if (data.data?.tool) {
      // Flush any buffered deltas before processing result
      context.actions.flushToolDeltaBufferImmediate()

      const tool = data.data.tool as any
      const hasError = tool.error || tool.is_error

      const toolCall: ToolCall = {
        id: tool.id,
        name: tool.name,
        input: tool.input || {},
        result: tool.output || tool.result,
        error: tool.error,
        status: hasError ? 'error' : 'completed',
        startTime: tool.startTime,
        endTime: Date.now(),
      }

      context.helpers.sendToolImpression(tool.name)
      context.actions.addToolResultSegment(toolCall)

      // Update persistent todo list if this is a todoList tool
      if (tool.name === 'todoList' && !hasError) {
        try {
          const { updateFromToolCall } = useTodoListStore.getState()
          updateFromToolCall(toolCall.result)
        } catch (error) {
          logger.error('websocket.todo-list.update.failure', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
  }
}
