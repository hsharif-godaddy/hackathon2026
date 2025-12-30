/**
 * Conversation Info Handler
 *
 * Handles conversation_info messages for durable conversationId delivery.
 * Persists conversationId to cookie and acknowledges receipt to server.
 */

import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

export class ConversationInfoHandler implements MessageHandler {
  readonly type = 'conversation_info'

  async handle(
    data: WebSocketMessage,
    context: MessageContext,
    ack?: () => void
  ): Promise<void> {
    // Control-plane message for durable conversationId delivery
    // Persists cookie BEFORE acknowledging so server knows cookie was written
    if (data.data?.conversationId && context.currentAppId) {
      context.helpers.setConversationIdCookie(
        context.currentAppId,
        data.data.conversationId as string
      )
    }

    // Acknowledge receipt so server knows cookie was written
    // Guard: some transports may not supply ack callback
    if (typeof ack === 'function') {
      ack()
    }
  }
}
