import { mapToolCall } from '@/hooks/shared/toolMappers'
import { handleToolCallSideEffects } from '@/hooks/shared/toolSideEffects'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class ToolCallHandler implements MessageHandler {
  readonly type = 'tool_call'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    if (data.data?.tool) {
      context.actions.flushToolDeltaBufferImmediate()
      const tool = data.data.tool as any
      context.actions.addToolCallSegment(mapToolCall(tool))
      handleToolCallSideEffects(tool, context.currentAppId)
    }
  }
}
