/**
 * Replay Complete Handler
 *
 * Handles replay_complete messages indicating all buffered events have been replayed.
 * Sends recovery acknowledgement to server.
 */

import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { LifecycleHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class ReplayCompleteHandler implements MessageHandler {
  readonly type = 'replay_complete'

  async handle(data: WebSocketMessage, context: LifecycleHandlerContext): Promise<void> {
    // Guard: Clear stale recovery state if app has changed to prevent
    // stale ack from leaking into new app's recovery attempt
    if (useStreamingConversationStore.getState().currentAppId !== context.currentAppId) {
      context.refs.pendingRecoveryAck.current = null
      return
    }

    // Server finished replaying all buffered events, send acknowledgement
    if (data.data?.conversationId && data.data?.lastSequence !== undefined) {
      const pending = context.refs.pendingRecoveryAck.current

      if (pending) {
        pending.lastSequence = data.data.lastSequence as number
        pending.replayComplete = true

        // Log count mismatch for telemetry
        if (pending.receivedCount !== pending.expectedCount) {
          logger.warn('websocket.recovery.count_mismatch', {
            conversationId: data.data.conversationId,
            expectedCount: pending.expectedCount,
            receivedCount: pending.receivedCount,
            serverReported: data.data.eventsReplayed,
          })
        }
      } else {
        // No pending ack - create one (late replay_complete)
        context.refs.pendingRecoveryAck.current = {
          conversationId: data.data.conversationId as string,
          lastSequence: data.data.lastSequence as number,
          expectedCount: (data.data?.eventsReplayed as number) ?? 0,
          receivedCount: (data.data?.eventsReplayed as number) ?? 0,
          replayComplete: true,
          ackEvent: 'recovery_ack',
        }
      }

      // Send REPLAY_COMPLETE event to machine
      context.machine.send({ type: 'REPLAY_COMPLETE' })

      // NEW: Clear deduplication tracking via controller
      if (context.refs.controller) {
        context.refs.controller.clearReplayDeduplication()
      }

      // Force send ack - server is authoritative on replay completion
      context.helpers.maybeSendRecoveryAck(context.socket, true)

      // Check if the stream should be finalized now that replay is complete.
      // HistoryCompleteHandler may have already run but couldn't finalize because
      // replayComplete was false at that time. Now that replay is done, re-evaluate.
      const updatedPending = context.refs.pendingRecoveryAck.current
      if (!updatedPending) {
        // Ack was already sent and cleared — check if stream needs finalization
        const store = useStreamingConversationStore.getState()
        if (store.activeStream) {
          const serverSaysCompleted = pending?.streamCompleted === true
          if (serverSaysCompleted) {
            logger.debug('websocket.replay_complete.finalizing_stream', {
              messageId: store.activeStream.id,
              conversationId: data.data.conversationId,
            })
            context.actions.flushToolDeltaBufferImmediate()
            context.actions.finalizeStream({})
            context.machine.send({ type: 'STREAM_COMPLETE' })
          }
        }
      }
    }
  }
}
