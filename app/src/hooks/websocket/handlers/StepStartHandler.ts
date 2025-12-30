/**
 * Step Start Handler
 *
 * Handles step_start messages indicating a new reasoning step has begun.
 * Updates UI state and clears any retrying/error states from recovery.
 */

import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

export class StepStartHandler implements MessageHandler {
  readonly type = 'step_start'

  async handle(_data: WebSocketMessage, context: MessageContext): Promise<void> {
    // Send tool impression for analytics
    context.helpers.sendToolImpression('start')

    // Clear any retrying/error state and resume streaming
    // This is important for recovery scenarios where we were in error/retrying state
    context.actions.setStreamingState('streaming')
    context.actions.setWebSocketState({
      connected: true,
      status: 'streaming'
    })

    // Clear store-based retry state when streaming data arrives
    const store = useStreamingConversationStore.getState()
    if (store.connectionRetry.isRetrying) {
      store.clearConnectionRetry()
    }
  }
}
