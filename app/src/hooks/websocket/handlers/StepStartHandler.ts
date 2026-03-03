/**
 * Step Start Handler
 *
 * Handles step_start messages indicating a new reasoning step has begun.
 * Updates UI state and clears any retrying/error states from recovery.
 */

import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class StepStartHandler implements MessageHandler {
  readonly type = 'step_start'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    // Send tool impression for analytics
    context.helpers.sendToolImpression('start')

    // Machine should already be in streaming state when step starts
    // Adapter syncs streamingState and webSocketState from machine

    // Clear store-based retry state when streaming data arrives (recovery scenario)
    const store = useStreamingConversationStore.getState()
    if (store.connectionRetry.isRetrying) {
      store.clearConnectionRetry()
    }

    // Capture agent name from step_start and store it for ThinkingIndicator
    const agentNameRaw = data.data?.agentName
    const agentNameStr = agentNameRaw ? String(agentNameRaw) : null
    if (agentNameStr) {
      store.setCurrentAgentName(agentNameStr)
    }
  }
}
