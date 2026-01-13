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

    // Check if stream should be completed
    // HistoryMessageHandler already sent STREAM_STARTED if in-progress message detected
    // We just need to send STREAM_COMPLETE if recovery is done (no buffered events)
    if (store.activeStream) {
      const pendingAck = context.refs.pendingRecoveryAck?.current
      const recoveryComplete = pendingAck && pendingAck.replayComplete && pendingAck.expectedCount === 0

      if (recoveryComplete) {
        // Stream already completed on server - finalize and close it
        // Machine is in streaming.receiving (set by HistoryMessageHandler)
        logger.debug('websocket.history.stream_already_complete', {
          messageId: store.activeStream.id,
          conversationId: pendingAck.conversationId
        })

        // Finalize the stream first (Tier 2): moves activeStream to messages, persists to DB
        // Then transition machine (Tier 1): streaming.receiving → streaming.completing → completed
        context.actions.finalizeStream({})
        context.machine.send({ type: 'STREAM_COMPLETE' })
      }
      // If not recoveryComplete, stream is still active and will receive more events
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
}
