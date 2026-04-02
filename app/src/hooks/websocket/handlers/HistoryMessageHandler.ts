/**
 * History Message Handler
 *
 * Handles history_message events during recovery.
 * Batches messages to reduce re-renders (10 messages per batch or 50ms timeout).
 */

import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { LifecycleHandlerContext, MessageHandler, WebSocketMessage } from './types'

const HISTORY_BATCH_SIZE = 10 // Messages per batch
const HISTORY_BATCH_TIMEOUT_MS = 50 // Max wait time before flush

export class HistoryMessageHandler implements MessageHandler {
  readonly type = 'history_message'

  async handle(data: WebSocketMessage, context: LifecycleHandlerContext): Promise<void> {
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
  flushBatch(context: LifecycleHandlerContext): void {
    if (!context.refs.historyBatch || !context.refs.historyBatch.current) {
      return
    }

    const batch = context.refs.historyBatch.current
    if (batch.length === 0) return

    const store = useStreamingConversationStore.getState()

    // Detect if this is a pagination batch (server stamps isPagination on history_message events)
    const isPagination = batch[0]?.isPagination === true

    // Determine mode based on whether this is pagination or initial/recovery
    let mode: 'replace' | 'append' | 'prepend'
    if (isPagination) {
      mode = 'prepend' // Pagination: prepend older messages above existing ones
    } else {
      // Initial history load (via load_history event):
      // - If no messages and no activeStream: replace (first load, empty chat)
      // - If messages exist OR activeStream is set: prepend (history slots in above current content)
      //   This handles the case where a user sent a message before history arrived
      const hasExistingContent = store.messages.length > 0 || !!store.activeStream
      const historyReceivedRef = context.refs.historyReceivedForRecovery
      const alreadyReceivedHistory = historyReceivedRef ? historyReceivedRef.current : false

      if (hasExistingContent || alreadyReceivedHistory) {
        mode = 'prepend'
      } else {
        mode = 'replace'
      }
    }

    // Use unified history persistence action
    // This handles normalization, in-progress detection, activeStream rehydration, and appChatHistory persistence
    if (store.currentAppId) {
      const prevActiveStream = store.activeStream

      store.loadAndPersistHistory({
        appId: store.currentAppId,
        rawMessages: batch,
        mode,
        detectInProgress: !isPagination // Only detect in-progress for initial load
      })

      // Check if an in-progress message was detected and activeStream was set
      // Send STREAM_STARTED to transition machine to streaming state (Tier 1 lifecycle)
      // Only for non-pagination batches (in-progress detection is disabled for pagination)
      if (!isPagination) {
        const currentStore = useStreamingConversationStore.getState()
        if (!prevActiveStream && currentStore.activeStream) {
          const conversationId = context.refs.pendingRecoveryAck?.current?.conversationId

          if (conversationId) {
            logger.debug('websocket.history.in_progress_detected', {
              messageId: currentStore.activeStream.id,
              conversationId
            })

            context.machine.send({
              type: 'STREAM_STARTED',
              conversationId,
              messageId: currentStore.activeStream.id,
            })
          }
        }

        // Mark that we've received history for this recovery session
        const historyReceivedRef = context.refs.historyReceivedForRecovery
        if (historyReceivedRef && mode === 'replace') {
          historyReceivedRef.current = true
        }
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
