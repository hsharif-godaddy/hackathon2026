/**
 * Complete Handler
 *
 * Handles stream completion messages.
 * Finalizes the stream, clears state, and triggers post-completion actions.
 */

import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

export class CompleteHandler implements MessageHandler {
  readonly type = 'complete'

  async handle(data: WebSocketMessage, context: MessageContext): Promise<void> {
    // Flush any buffered tool input deltas
    context.actions.flushToolDeltaBufferImmediate()

    // Clear store-based retry state on successful completion
    const completeStore = useStreamingConversationStore.getState()
    if (completeStore.connectionRetry.isRetrying) {
      completeStore.clearConnectionRetry()
    }

    // Clear APP_NOT_FOUND retry state
    context.helpers.clearRetryState()

    // Finalize the stream with metadata
    context.actions.finalizeStream({
      agentId: data.data?.agentId as string | undefined,
      usage: data.data?.usage,
      totalSteps: data.data?.step as number | undefined,
    })

    // Send analytics
    context.helpers.sendToolImpression('complete')

    // Update UI state
    context.actions.setWebSocketState({ status: 'idle' })
    context.actions.setStreamingState('idle')
    context.actions.setIsLoading(false)

    // Handle commit selection and preview refresh
    await context.helpers.handleCommitComplete(data.data?.commitHash as string | undefined)

    // Clean up recovery state
    context.helpers.clearStoredSocketId()
    context.helpers.clearConversationIdCookie(context.currentAppId)
  }
}
