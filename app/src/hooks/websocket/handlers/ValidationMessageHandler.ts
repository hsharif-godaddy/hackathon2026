import { ensureFreshToken } from '@/hooks/github/useGitHubTokenHealth'
import { buildValidationToolCallFromEvent } from '@/hooks/shared/validationToolCallBuilder'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class ValidationMessageHandler implements MessageHandler {
  readonly type = 'validation_message'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    const { toolCall, isTerminal } = buildValidationToolCallFromEvent(data.data, data.content)
    context.actions.addToolStartSegment(toolCall)
    if (isTerminal) {
      context.actions.addToolResultSegment(toolCall)
      if (context.currentAppId) {
        ensureFreshToken(context.currentAppId, 'commit');
      }
    }
  }
}
