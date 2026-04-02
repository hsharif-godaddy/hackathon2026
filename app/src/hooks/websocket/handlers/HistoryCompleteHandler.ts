/**
 * History Complete Handler
 *
 * Handles history_complete events — pagination responses only.
 * Updates pagination state and clears the loading-more indicator.
 *
 * Initial history load completion is handled by HistoryLoadedHandler (history_loaded event).
 */

import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { HistoryMessageHandler } from './HistoryMessageHandler'
import type { LifecycleHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class HistoryCompleteHandler implements MessageHandler {
  readonly type = 'history_complete'

  async handle(data: WebSocketMessage, context: LifecycleHandlerContext): Promise<void> {
    // Flush any remaining batched messages
    new HistoryMessageHandler().flushBatch(context)

    const store = useStreamingConversationStore.getState()

    logger.debug('websocket.history.page_complete', {
      messageCount: data.data?.messageCount,
      hasMore: data.data?.hasMore,
      nextCursor: data.data?.nextCursor,
      error: data.data?.error,
    })

    // Skip updating pagination state on error — preserves historyNextCursor so the
    // client can retry with the same cursor. Error values (hasMore:false, nextCursor:null)
    // from the server are meaningless; the cursor is still valid for retry.
    if (!data.data?.error) {
      store.setHistoryPagination({
        hasMore: typeof data.data?.hasMore === 'boolean' ? data.data.hasMore : false,
        nextCursor: data.data?.nextCursor !== undefined ? data.data.nextCursor as string | null : null
      })
    }

    // Always clear pagination loading state — covers error cases too
    store.setHistoryLoadingMore(false)

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
