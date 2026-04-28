import { createValidationToolCall, parseValidationStatus } from '@/stores/validationToolCall'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class ValidationMessageHandler implements MessageHandler {
  readonly type = 'validation_message'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    const metadata = typeof data.data?.metadata === 'object' && data.data.metadata
      ? data.data.metadata as Record<string, unknown>
      : {}
    const validationStatus = parseValidationStatus(metadata.validationStatus)
    const toolCall = createValidationToolCall({
      id: typeof data.data?.validationId === 'string'
        ? data.data.validationId
        : typeof data.data?.messageId === 'string'
          ? data.data.messageId
          : `validation_${Date.now()}`,
      status: validationStatus,
      diagnostics: data.content
    })

    context.actions.addToolStartSegment(toolCall)
    if (validationStatus !== 'running') {
      context.actions.addToolResultSegment(toolCall)
    }
  }
}
