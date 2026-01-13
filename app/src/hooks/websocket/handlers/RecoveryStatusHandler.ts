/**
 * Recovery Status Handler
 *
 * Handles recovery_status messages from server during connection recovery.
 * Manages three scenarios:
 * 1. Stream already completed - load history and finalize
 * 2. Recovery complete - stream is active again
 * 3. Has buffered events - prepare for replay
 */

import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

const DATA_LOSS_ERROR_MESSAGE = 'Some earlier data could not be recovered due to buffer limits.'

export class RecoveryStatusHandler implements MessageHandler {
  readonly type = 'recovery_status'

  async handle(data: WebSocketMessage, context: MessageContext): Promise<void> {
    const storeAppId = useStreamingConversationStore.getState().currentAppId;

    // Guard: Clear stale recovery state if app has changed since this event was sent
    if (storeAppId !== context.currentAppId) {
      logger.warn('websocket.recovery.app_mismatch', {
        storeAppId,
        contextAppId: context.currentAppId,
      });
      context.refs.pendingRecoveryAck.current = null
      return
    }

    if (data.data?.streamCompleted && !data.data?.hasBufferedEvents) {
      // Stream completed with no buffered events - just load history
      await this.handleStreamCompleted(data, context)
    } else if (data.data?.isRecovering === false) {
      this.handleRecoveryFinalized(data, context)
    } else if (data.data?.hasBufferedEvents) {
      await this.handleBufferedEvents(data, context)
    } else if (
      data.data?.requiresAck &&
      data.data?.conversationId &&
      data.data?.lastSequence !== undefined
    ) {
      await this.handleRequiresAck(data, context)
    } else {
      context.refs.pendingRecoveryAck.current = null
    }

    if (data.data?.lossDetected) {
      context.actions.markUpstreamError({
        message: DATA_LOSS_ERROR_MESSAGE,
        type: 'DATA_LOSS',
      })

      context.machine.send({
        type: 'STREAM_ERROR',
        error: new Error(DATA_LOSS_ERROR_MESSAGE),
        retryable: false
      })
    }
  }

  /**
   * Handle scenario where stream already completed before recovery
   */
  private async handleStreamCompleted(
    data: WebSocketMessage,
    context: MessageContext
  ): Promise<void> {
    const conversationId = data.data?.conversationId as string | undefined

    let historyLoadSucceeded = false

    // Reset history received flag for this recovery session
    if (context.refs.historyReceivedForRecovery) {
      context.refs.historyReceivedForRecovery.current = false
    }

    // Check if history is being streamed
    if (data.data?.historyStreaming) {
      // History will arrive via history_message events
      // history_complete will be sent when done (even if no messages)
      logger.debug('websocket.recovery.history_streaming', {
        conversationId,
        expectedMessages: data.data.historyMessageCount
      })
      historyLoadSucceeded = true // History handler will populate messages
    } else if (conversationId && context.currentAppId) {
      // No history available
      // Server will still send history_complete for consistency
      logger.warn('websocket.recovery.no_history', {
        conversationId,
        appId: context.currentAppId
      })
    }

    // Handle activeStream based on whether history load succeeded
    const store = useStreamingConversationStore.getState()
    if (store.activeStream) {
      if (historyLoadSucceeded) {
        // History loaded successfully - server data is authoritative, clear activeStream
        store.clearActiveStream()
      } else {
        // History load failed - preserve in-memory response by finalizing it
        // This promotes activeStream to a completed message so user doesn't lose data
        context.actions.finalizeStream({})
        logger.info('websocket.recovery.finalized_on_history_failure', {
          messageId: store.activeStream.id,
          contentLength: store.activeStream.content?.length || 0,
        })
      }
    }

    // Ensure stream state machine transitions to completed
    // Check machine state (Tier 1), not store state (Tier 2) to avoid race conditions during retry
    const snapshot = context.machine.getSnapshot()
    const isStreaming = snapshot.matches({ stream: { streaming: 'receiving' } }) ||
                       snapshot.matches({ stream: { streaming: 'completing' } })
    if (isStreaming) {
      context.machine.send({ type: 'STREAM_COMPLETE' })
    }
    // Otherwise machine is already in completed/error state, adapter will sync

    // Clear connection retry if active
    if (store.connectionRetry.isRetrying) {
      store.clearConnectionRetry()
    }

    // Clear APP_NOT_FOUND retry state
    context.helpers.clearRetryState()
    // Note: We no longer clear the stored socket ID to enable recovery on page reload
  }

  /**
   * Handle scenario where recovery is complete and stream is active again
   */
  private handleRecoveryFinalized(data: WebSocketMessage, context: MessageContext): void {
    // Recovery complete, stream is active again
    // Send CATCHUP_COMPLETE to transition machine back to idle state
    context.machine.send({ type: 'CATCHUP_COMPLETE' })

    logger.info('websocket.recovery.finalized', {
      eventsReplayed: data.data?.eventsReplayed,
    })
  }

  /**
   * Handle scenario where there are buffered events to replay
   */
  private async handleBufferedEvents(
    data: WebSocketMessage,
    context: MessageContext
  ): Promise<void> {
    // CRITICAL: Set up ack tracking BEFORE any async operations
    // Buffered events arrive during the async history load, and trackReplayEventReceipt
    // needs pendingRecoveryAckRef to be set to count them
    if (
      data.data?.requiresAck &&
      data.data?.conversationId &&
      data.data?.lastSequence !== undefined
    ) {
      const expectedCount = (data.data?.bufferedEventCount as number) ?? 0
      const recoveryId = data.data.conversationId as string

      // Initialize deduplication BEFORE ACK tracking so transport can drop duplicates immediately
      if (expectedCount > 0 && context.refs.controller) {
        context.refs.controller.startReplayDeduplication()
        logger.debug('websocket.recovery.deduplication_enabled', {
          conversationId: recoveryId,
          expectedCount
        })
      }

      // Reset history received flag for this new recovery session
      // This ensures first batch replaces instead of appends, preventing duplicates
      if (context.refs.historyReceivedForRecovery) {
        context.refs.historyReceivedForRecovery.current = false
      }

      context.refs.pendingRecoveryAck.current = {
        conversationId: recoveryId,
        lastSequence: data.data.lastSequence as number,
        expectedCount,
        receivedCount: 0,
        replayComplete: expectedCount === 0,
        ackEvent: 'recovery_ack',
      }

      // Send RECOVERY_STATUS event to machine
      context.machine.send({
        type: 'RECOVERY_STATUS',
        recoveryId,
        expectedEvents: expectedCount
      })

      // Don't send ack immediately - wait for replay_complete
      // Server ALWAYS sends replay_complete after recovery_status,
      // which is the authoritative signal that replay is done
    }

    // Only skip recovery if there's an active stream (user just sent a new message)
    // Don't interfere with new messages being sent
    const store = useStreamingConversationStore.getState()

    if (store.activeStream) {
      // Active stream exists - user just sent a message, don't interfere
      return
    }

    // Create placeholder stream and load history from WebSocket
    const conversationId = (data.data?.conversationId as string | undefined) || ''
    this.initializeRecoveryStream(context, conversationId)

    // Check if history is being streamed
    if (data.data?.historyStreaming) {
      // History will arrive via history_message events
      // history_complete will be sent when done (even if no messages)
      logger.debug('websocket.recovery.history_streaming_buffered', {
        conversationId: data.data.conversationId,
        expectedMessages: data.data.historyMessageCount
      })
    } else if (data.data?.conversationId && context.currentAppId) {
      // No history available
      // Server will still send history_complete for consistency
      logger.warn('websocket.recovery.no_history_buffered', {
        conversationId: data.data.conversationId,
        appId: context.currentAppId
      })
    }

    // Check if stream completed - clear placeholder to stop "thinking" indicator
    const currentStore = useStreamingConversationStore.getState()
    const lastAssistantMsg = this.findLastAssistantMessage(currentStore.messages)
    const streamIsComplete = lastAssistantMsg && !('isComplete' in lastAssistantMsg && !lastAssistantMsg.isComplete)

    if (streamIsComplete && currentStore.activeStream) {
      currentStore.clearActiveStream()

      // Ensure stream state machine transitions to completed
      // Check machine state (Tier 1), not store state (Tier 2) to avoid race conditions during retry
      const snapshot = context.machine.getSnapshot()
      const isStreaming = snapshot.matches({ stream: { streaming: 'receiving' } }) ||
                         snapshot.matches({ stream: { streaming: 'completing' } })
      if (isStreaming) {
        context.machine.send({ type: 'STREAM_COMPLETE' })
      }
    }
  }

  /**
   * Initialize stream for recovery when no history available
   */
  private initializeRecoveryStream(context: MessageContext, conversationId: string): void {
    // Guard: only create if not already streaming (avoid overwriting on duplicate recovery)
    const store = useStreamingConversationStore.getState()
    if (!store.activeStream) {
      this.createRecoveredStream(context, conversationId)
    }
  }

  /**
   * Create a recovered stream message
   */
  private createRecoveredStream(context: MessageContext, conversationId: string): void {
    const streamingMessage = {
      id: `recovered_${Date.now()}`,
      role: 'assistant' as const,
      content: '',
      segments: [],
      toolCalls: [],
      timestamp: new Date(),
      isComplete: false,
    }

    // Set activeStream directly (Tier 2 data operation)
    useStreamingConversationStore.setState({
      activeStream: streamingMessage,
      currentStep: 1,
    })

    // Transition machine to streaming state (Tier 1 lifecycle)
    // This will trigger adapter to sync streamingState and isLoading
    context.machine.send({
      type: 'STREAM_STARTED',
      conversationId: conversationId,
      messageId: streamingMessage.id,
    })
  }

  /**
   * Handle requiresAck for other recovery scenarios
   * When hasBufferedEvents: false and expectedCount: 0, this means the stream
   * completed but server didn't explicitly set streamCompleted: true.
   * We should load history to ensure UI is up to date.
   */
  private async handleRequiresAck(data: WebSocketMessage, context: MessageContext): Promise<void> {
    const expectedCount = (data.data?.bufferedEventCount as number) ?? 0
    const recoveryId = data.data!.conversationId as string

    context.refs.pendingRecoveryAck.current = {
      conversationId: recoveryId,
      lastSequence: data.data!.lastSequence as number,
      expectedCount,
      receivedCount: 0,
      replayComplete: expectedCount === 0,
      ackEvent: 'recovery_ack',
    }

    // Reset history received flag for this recovery session
    if (context.refs.historyReceivedForRecovery) {
      context.refs.historyReceivedForRecovery.current = false
    }

    // Send RECOVERY_STATUS event to machine
    context.machine.send({
      type: 'RECOVERY_STATUS',
      recoveryId,
      expectedEvents: expectedCount
    })

    // When there are no buffered events, ensure UI is in correct state
    if (expectedCount === 0 && recoveryId && context.currentAppId) {
      const store = useStreamingConversationStore.getState()

      // Check if history is being streamed
      if (data.data?.historyStreaming) {
        // History will arrive via history_message events
        // history_complete will be sent when done (even if no messages)
        logger.debug('websocket.recovery.history_streaming_requires_ack', {
          conversationId: recoveryId,
          expectedMessages: data.data.historyMessageCount
        })
        // History handler will populate messages and determine streaming state
      } else if (store.messages.length > 0) {
        // Use cached messages if available (existing logic)
        // Server will still send history_complete for consistency
        const lastMsg = this.findLastAssistantMessage(store.messages)
        const wasStreaming = lastMsg && 'isComplete' in lastMsg && lastMsg.isComplete === false

        if (wasStreaming) {
          // Recreate activeStream from the incomplete message so handlers can update it
          useStreamingConversationStore.setState({
            activeStream: {
              id: lastMsg.id,
              role: 'assistant',
              content: lastMsg.content || '',
              segments: lastMsg.segments || [],
              toolCalls: lastMsg.toolCalls || [],
              timestamp: lastMsg.timestamp,
              isComplete: false,
            },
          })

          // Transition machine to streaming state (Tier 1 lifecycle)
          context.machine.send({
            type: 'STREAM_STARTED',
            conversationId: recoveryId,
            messageId: lastMsg.id,
          })
        } else {
          // Stream was complete, clear loading states
          const currentStore = useStreamingConversationStore.getState()
          if (currentStore.activeStream) {
            currentStore.clearActiveStream()
          }

          // Ensure machine is in completed state
          // Check machine state (Tier 1), not store state (Tier 2) to avoid race conditions during retry
          const snapshot = context.machine.getSnapshot()
          const isStreaming = snapshot.matches({ stream: { streaming: 'receiving' } }) ||
                             snapshot.matches({ stream: { streaming: 'completing' } })
          if (isStreaming) {
            context.machine.send({ type: 'STREAM_COMPLETE' })
          }
        }
      } else {
        // No history from WebSocket, no cached messages
        // Server will still send history_complete for consistency
        logger.warn('websocket.recovery.no_history_available', {
          conversationId: recoveryId,
          appId: context.currentAppId
        })

        // Clear loading states
        const currentStore = useStreamingConversationStore.getState()
        if (currentStore.activeStream) {
          currentStore.clearActiveStream()
        }

        // Ensure machine is in completed state
        // Check machine state (Tier 1), not store state (Tier 2) to avoid race conditions during retry
        const snapshot = context.machine.getSnapshot()
        const isStreaming = snapshot.matches({ stream: { streaming: 'receiving' } }) ||
                           snapshot.matches({ stream: { streaming: 'completing' } })
        if (isStreaming) {
          context.machine.send({ type: 'STREAM_COMPLETE' })
        }
      }
    }

    // Don't send ack immediately - wait for replay_complete
    // Server ALWAYS sends replay_complete after recovery_status,
    // which is the authoritative signal that replay is done
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
