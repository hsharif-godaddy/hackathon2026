import { mapToolStart } from '@/hooks/shared/toolMappers'
import { handleToolStartSideEffects } from '@/hooks/shared/toolStartSideEffects'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class ToolStartHandler implements MessageHandler {
  readonly type = 'tool_start'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    if (data.data?.tool) {
      const tool = data.data.tool as {
        id?: string
        name: string
        input?: Record<string, unknown>
        skillName?: string
      }
      context.actions.addToolStartSegment(mapToolStart(tool as any))
      handleToolStartSideEffects(tool)
    }
  }
}
