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

    // Machine should already be in streaming state when chunks arrive
    // Adapter syncs streamingState and webSocketState from machine

    // Clear store-based retry state when streaming data arrives (recovery scenario)
    if (store.connectionRetry.isRetrying) {
      store.clearConnectionRetry()
    }

    // Append the text chunk to the active stream (Tier 2 - transcript data)
    context.actions.appendTextSegment(data.content)
  }
}
