/**
 * Step Start Handler
 *
 * Handles step_start messages indicating a new reasoning step has begun.
 * Updates UI state and clears any retrying/error states from recovery.
 */

import { trackStepStart } from '@/hooks/shared/completionSideEffects'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class StepStartHandler implements MessageHandler {
  readonly type = 'step_start'

  async handle(data: WebSocketMessage, _context: DataHandlerContext): Promise<void> {
    trackStepStart()

    const store = useStreamingConversationStore.getState()
    if (store.connectionRetry.isRetrying) {
      store.clearConnectionRetry()
    }

    const agentNameRaw = data.data?.agentName
    if (agentNameRaw) {
      store.setCurrentAgentName(String(agentNameRaw))
    }
  }
}
