/**
 * Tool Input Delta Handler
 *
 * Handles tool_input_delta messages for streaming tool input.
 * Accumulates partial input deltas in a buffer for batched UI updates.
 */

import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class ToolInputDeltaHandler implements MessageHandler {
  readonly type = 'tool_input_delta'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    // Tool input streaming delta - update partial input accumulation
    // Only require toolId and delta - toolName can be looked up from existing tool calls
    // Skip empty deltas (they don't add any information)
    if (data.data?.toolId && data.data?.delta !== undefined && (data.data.delta as string).length > 0) {
      const toolId = data.data.toolId as string
      const delta = data.data.delta as string
      const incomingName = data.data.toolName as string | undefined
      const normalizedName = incomingName || 'unknown-tool'
      const hasExplicitName = !!incomingName && incomingName !== 'unknown-tool'
      const existingDelta = context.refs.toolDeltaBuffer.current.get(toolId)

      if (existingDelta) {
        existingDelta.delta += delta
        if (hasExplicitName) {
          existingDelta.name = normalizedName
          existingDelta.hasExplicitName = true
        }
      } else {
        context.refs.toolDeltaBuffer.current.set(toolId, {
          name: normalizedName,
          delta,
          hasExplicitName,
        })
      }

      context.actions.scheduleToolDeltaFlush()
    }
  }
}
