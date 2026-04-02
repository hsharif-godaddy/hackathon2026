/**
 * History Loaded Handler
 *
 * Handles history_loaded events — the completion signal for the initial load_history request
 * (no cursor). Sets historyLoadingComplete and updates pagination state.
 *
 * Arrives after replay_complete + ack cycle, so pendingRecoveryAck is always null here.
 * Stream finalization is handled upstream: by ReplayCompleteHandler (buffered-events path)
 * and by RecoveryStatusHandler.handleStreamCompleted (stream-already-complete path).
 * Stale inProgress clearing is handled server-side in the load_history handler.
 *
 * Pagination completion is handled by HistoryCompleteHandler (history_complete event).
 */

import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { HistoryMessageHandler } from './HistoryMessageHandler'
import type { LifecycleHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class HistoryLoadedHandler implements MessageHandler {
  readonly type = 'history_loaded'

  async handle(data: WebSocketMessage, context: LifecycleHandlerContext): Promise<void> {
    // Flush any remaining batched messages
    new HistoryMessageHandler().flushBatch(context)

    const store = useStreamingConversationStore.getState()
    const error = data.data?.error

    if (error) {
      // Server-side failure (DB error, missing provider, etc). Leave historyLoadingComplete
      // false so the client-side safety timeout can retry the request.
      // Reset historyLoadRequested so reconnect handlers can re-emit load_history.
      store.setHistoryLoadRequested(false)
      logger.warn('websocket.history.loaded.error', {
        error,
        messageCount: data.data?.messageCount,
      })
      return
    }

    logger.debug('websocket.history.loaded', {
      messageCount: data.data?.messageCount,
      hasMore: data.data?.hasMore,
      nextCursor: data.data?.nextCursor,
    })

    store.setHistoryPagination({
      hasMore: typeof data.data?.hasMore === 'boolean' ? data.data.hasMore : false,
      nextCursor: data.data?.nextCursor !== undefined ? data.data.nextCursor as string | null : null
    })

    // Mark initial history as loaded — used by reconnect guard to avoid re-fetching
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
