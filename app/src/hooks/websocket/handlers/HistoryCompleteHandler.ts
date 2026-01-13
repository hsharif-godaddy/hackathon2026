/**
 * History Complete Handler
 *
 * Handles history_complete event to finalize history loading.
 * Flushes any remaining batched messages and cleans up refs.
 * Signals to the store that history loading is complete for initialization to proceed.
 */

import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'
import { HistoryMessageHandler } from './HistoryMessageHandler'

export class HistoryCompleteHandler implements MessageHandler {
  readonly type = 'history_complete'

  async handle(data: WebSocketMessage, context: MessageContext): Promise<void> {
    // Flush any remaining batched messages
    const historyHandler = new HistoryMessageHandler()
    historyHandler.flushBatch(context)

    logger.info('websocket.history.complete', {
      totalMessageCount: data.data?.messageCount
    })

    // Signal that history loading is complete
    // This allows initialization to proceed without HTTP calls
    const store = useStreamingConversationStore.getState()
    store.setHistoryLoadingComplete(true)

    // Clear refs
    if (context.refs.historyBatch) {
      context.refs.historyBatch.current = null
    }
    if (context.refs.historyBatchTimer?.current) {
      clearTimeout(context.refs.historyBatchTimer.current)
      context.refs.historyBatchTimer.current = null
    }
  }
}
