/**
 * Catchup Status Handler
 *
 * Handles catchup_status messages for events that arrived during ACK wait.
 * Sets up tracking for catch-up event replay.
 */

import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

export class CatchupStatusHandler implements MessageHandler {
  readonly type = 'catchup_status'

  async handle(data: WebSocketMessage, context: MessageContext): Promise<void> {
    // Guard: Clear stale recovery state if app has changed to prevent
    // stale ack from leaking into new app's recovery attempt
    if (useStreamingConversationStore.getState().currentAppId !== context.currentAppId) {
      context.refs.pendingRecoveryAck.current = null
      return
    }

    if (
      data.data?.requiresAck &&
      data.data?.conversationId &&
      data.data?.lastSequence !== undefined
    ) {
      const expectedCount = (data.data?.pendingCount as number) ?? 0
      context.refs.pendingRecoveryAck.current = {
        conversationId: data.data.conversationId as string,
        lastSequence: data.data.lastSequence as number,
        expectedCount,
        receivedCount: 0,
        replayComplete: expectedCount === 0,
        ackEvent: 'catchup_ack',
      }

      if (expectedCount === 0) {
        context.helpers.maybeSendRecoveryAck(context.socket)
      }
    }
  }
}
