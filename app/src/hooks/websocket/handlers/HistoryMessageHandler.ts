/**
 * History Message Handler
 *
 * Handles history_message events during recovery.
 * Batches messages to reduce re-renders (10 messages per batch or 50ms timeout).
 */

import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

const HISTORY_BATCH_SIZE = 10 // Messages per batch
const HISTORY_BATCH_TIMEOUT_MS = 50 // Max wait time before flush

export class HistoryMessageHandler implements MessageHandler {
  readonly type = 'history_message'

  async handle(data: WebSocketMessage, context: MessageContext): Promise<void> {
    // Initialize batch buffer if needed
    if (!context.refs.historyBatch) {
      logger.warn('websocket.history.no_batch_ref', {
        message: 'historyBatch ref not initialized, skipping'
      })
      return
    }

    if (!context.refs.historyBatch.current) {
      context.refs.historyBatch.current = []
    }

    // Add message to batch
    context.refs.historyBatch.current.push(data.data)

    const batchSize = context.refs.historyBatch.current.length

    logger.debug('websocket.history.message_received', {
      batchSize,
      messageId: data.data?.id,
      sequence: data.data?.sequence
    })

    // Flush if batch size reached
    if (batchSize >= HISTORY_BATCH_SIZE) {
      this.flushBatch(context)
    } else {
      // Schedule flush if not already scheduled
      if (context.refs.historyBatchTimer && !context.refs.historyBatchTimer.current) {
        context.refs.historyBatchTimer.current = setTimeout(() => {
          this.flushBatch(context)
        }, HISTORY_BATCH_TIMEOUT_MS)
      }
    }
  }

  /**
   * Flush accumulated batch to store
   * Made public so HistoryCompleteHandler can call it
   */
  flushBatch(context: MessageContext): void {
    if (!context.refs.historyBatch || !context.refs.historyBatch.current) {
      return
    }

    const batch = context.refs.historyBatch.current
    if (batch.length === 0) return

    const store = useStreamingConversationStore.getState()

    // CRITICAL: Check if this is the first batch of THIS recovery session
    // Use explicit flag instead of messages.length, because the store may be
    // pre-populated by initialization or previous app visits
    const historyReceivedRef = context.refs.historyReceivedForRecovery
    const isFirstBatch = historyReceivedRef ? !historyReceivedRef.current : store.messages.length === 0
    const mode = isFirstBatch ? 'replace' : 'append'

    // Use unified history persistence action
    // This handles normalization, in-progress detection, activeStream rehydration, and appChatHistory persistence
    if (store.currentAppId) {
      store.loadAndPersistHistory({
        appId: store.currentAppId,
        rawMessages: batch,
        mode,
        detectInProgress: true
      })

      logger.debug(`websocket.history.batch_flushed_${mode}`, {
        batchSize: batch.length,
        totalMessages: store.messages.length
      })

      // Mark that we've received history for this recovery session
      if (historyReceivedRef && isFirstBatch) {
        historyReceivedRef.current = true
      }
    }

    // Clear batch
    context.refs.historyBatch.current = []

    // Clear timer
    if (context.refs.historyBatchTimer?.current) {
      clearTimeout(context.refs.historyBatchTimer.current)
      context.refs.historyBatchTimer.current = null
    }
  }
}
