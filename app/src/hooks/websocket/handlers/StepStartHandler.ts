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

    // Machine should already be in streaming state when step starts
    // Adapter syncs streamingState and webSocketState from machine

    // Clear store-based retry state when streaming data arrives (recovery scenario)
    const store = useStreamingConversationStore.getState()
    if (store.connectionRetry.isRetrying) {
      store.clearConnectionRetry()
    }
  }
}
