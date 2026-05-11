/**
 * History Loaded Handler
 *
 * Handles history_loaded events — the completion signal for the initial load_history request
 * (no cursor). Sets historyLoadingComplete and updates pagination state.
 *
 * Arrives after replay_complete + ack cycle, so pendingRecoveryAck is always null here.
 * Primary stream finalization is handled upstream: by ReplayCompleteHandler (buffered-events path)
 * and by RecoveryStatusHandler.handleStreamCompleted (stream-already-complete path).
 * Provides ambiguous recovery fallback to clear stale activeStream placeholders when history
 * confirms the turn finished (handles timing window where placeholder was created before history loaded).
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

    // Ambiguous recovery fallback: clear stale activeStream placeholder if:
    // 1. Placeholder exists but is empty (hasn't been populated by replay events)
    // 2. History confirms the last turn finished
    // Handles timing window where RecoveryStatusHandler created a placeholder before
    // history was available to verify completion. If the placeholder has content from
    // replay events, keep it (represents genuine in-progress turn). Mirrors SSE fix from #3507.
    if (store.activeStream) {
      const placeholderIsEmpty = store.activeStream.segments.length === 0 &&
                                 store.activeStream.toolCalls.length === 0 &&
                                 store.activeStream.content.trim().length === 0

      if (placeholderIsEmpty) {
        const lastMsg = this.findLastAssistantMessage(store.messages)
        // Persisted ChatMessage has no `isComplete` field; its presence (false)
        // only appears on recovered/streaming records. Absent → complete.
        const streamIsComplete = lastMsg && !('isComplete' in lastMsg && !lastMsg.isComplete)

        if (streamIsComplete) {
          const staleStreamId = store.activeStream.id
          store.clearActiveStream()

          const snapshot = context.machine.getSnapshot()
          const isStreaming = snapshot.matches({ stream: { streaming: 'receiving' } }) ||
                             snapshot.matches({ stream: { streaming: 'completing' } })
          if (isStreaming) {
            context.machine.send({ type: 'STREAM_COMPLETE' })
          }

          logger.info('websocket.recovery.fallback.cleared_stale_stream', {
            streamId: staleStreamId,
          })
        }
      }
    }

    // Clear refs
    if (context.refs.historyBatch) {
      context.refs.historyBatch.current = null
    }
    if (context.refs.historyBatchTimer?.current) {
      clearTimeout(context.refs.historyBatchTimer.current)
      context.refs.historyBatchTimer.current = null
    }
  }

  /**
   * Find the last assistant message by iterating backwards (avoids array copy)
   */
  private findLastAssistantMessage<T extends { role: string }>(messages: T[]): T | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        return messages[i]
      }
    }
    return undefined
  }
}
