/**
 * Catchup Complete Handler
 *
 * Handles catchup_complete messages indicating all catch-up events have been delivered.
 * Sends catch-up acknowledgement to server.
 */

import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { LifecycleHandlerContext, MessageHandler, WebSocketMessage } from './types'

export class CatchupCompleteHandler implements MessageHandler {
  readonly type = 'catchup_complete'

  async handle(data: WebSocketMessage, context: LifecycleHandlerContext): Promise<void> {
    // Guard: Clear stale recovery state if app has changed to prevent
    // stale ack from leaking into new app's recovery attempt
    if (useStreamingConversationStore.getState().currentAppId !== context.currentAppId) {
      context.refs.pendingRecoveryAck.current = null
      return
    }

    if (data.data?.conversationId && data.data?.lastSequence !== undefined) {
      const pending = context.refs.pendingRecoveryAck.current

      if (
        pending &&
        pending.ackEvent === 'catchup_ack' &&
        pending.conversationId === data.data.conversationId
      ) {
        pending.lastSequence = data.data.lastSequence as number
        pending.replayComplete = true

        // Log count mismatch for telemetry
        if (pending.expectedCount > 0 && pending.receivedCount !== pending.expectedCount) {
          logger.warn('websocket.catchup.count_mismatch', {
            conversationId: data.data.conversationId,
            expectedCount: pending.expectedCount,
            receivedCount: pending.receivedCount,
            serverReported: data.data.eventsReplayed,
          })
        }

        // Send CATCHUP_COMPLETE event to machine
        context.machine.send({ type: 'CATCHUP_COMPLETE' })

        // Force send ack - server is authoritative on catchup completion
        context.helpers.maybeSendRecoveryAck(context.socket, true)
      } else if (!pending) {
        // No pending ack - create one and send immediately (late catchup_complete)
        context.refs.pendingRecoveryAck.current = {
          conversationId: data.data.conversationId as string,
          lastSequence: data.data.lastSequence as number,
          expectedCount: (data.data?.eventsReplayed as number) ?? 0,
          receivedCount: (data.data?.eventsReplayed as number) ?? 0,
          replayComplete: true,
          ackEvent: 'catchup_ack',
        }

        // Send CATCHUP_COMPLETE event to machine
        context.machine.send({ type: 'CATCHUP_COMPLETE' })

        context.helpers.maybeSendRecoveryAck(context.socket, true)
      }
    }
  }
}
