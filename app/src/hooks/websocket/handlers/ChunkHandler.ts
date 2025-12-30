/**
 * Chunk Handler
 *
 * Handles text chunk messages from the AI streaming response.
 * Accumulates streamed text content and updates UI state.
 */

import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

export class ChunkHandler implements MessageHandler {
  readonly type = 'chunk'

  async handle(data: WebSocketMessage, context: MessageContext): Promise<void> {
    const store = useStreamingConversationStore.getState()

    // Ensure we're in streaming state (important for recovery scenarios)
    // If we were in 'retrying' or 'error' state and chunks start arriving,
    // it means the connection was successfully recovered
    if (store.streamingState === 'retrying' || store.streamingState === 'error') {
      context.actions.setStreamingState('streaming')
      context.actions.setWebSocketState({
        connected: true,
        status: 'streaming'
      })

      // Clear store-based retry state when streaming data arrives
      if (store.connectionRetry.isRetrying) {
        store.clearConnectionRetry()
      }
    }

    // Append the text chunk to the active stream
    context.actions.appendTextSegment(data.content)
  }
}
