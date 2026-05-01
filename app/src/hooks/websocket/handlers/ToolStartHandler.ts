import { mapToolStart } from '@/hooks/shared/toolMappers'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class ToolStartHandler implements MessageHandler {
  readonly type = 'tool_start'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    if (data.data?.tool) {
      context.actions.addToolStartSegment(mapToolStart(data.data.tool as any))
    }
  }
}
