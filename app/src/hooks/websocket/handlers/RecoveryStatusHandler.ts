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
import { AgentService } from '@/services/AgentService'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { MessageContext, MessageHandler, WebSocketMessage } from './types'

const DATA_LOSS_ERROR_MESSAGE = 'Some earlier data could not be recovered due to buffer limits.'

export class RecoveryStatusHandler implements MessageHandler {
  readonly type = 'recovery_status'

  async handle(data: WebSocketMessage, context: MessageContext): Promise<void> {
    // Guard: Clear stale recovery state if app has changed since this event was sent
    if (useStreamingConversationStore.getState().currentAppId !== context.currentAppId) {
      context.refs.pendingRecoveryAck.current = null
      return
    }

    if (data.data?.streamCompleted) {
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
      this.handleRequiresAck(data, context)
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
    // Stream already completed - load history and finalize properly
    // Load conversation history to get the final assistant message
    if (data.data?.conversationId && context.currentAppId) {
      try {
        const agentService = AgentService.getInstance()
        const conversation = await agentService.getConversation(
          context.currentAppId,
          data.data.conversationId as string
        )

        if (conversation.messages && conversation.messages.length > 0) {
          // Set messages in store - they're already complete from DB
          useStreamingConversationStore.setState({ messages: conversation.messages as any[] })
        }
      } catch (error) {
        logger.error('websocket.recovery.history_load_failed', {
          conversationId: data.data.conversationId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Finalize any active stream to move it to message history
    const store = useStreamingConversationStore.getState()
    if (store.activeStream) {
      context.actions.finalizeStream({})
    }

    // Clear connection retry if active
    if (store.connectionRetry.isRetrying) {
      store.clearConnectionRetry()
    }

    // Clear APP_NOT_FOUND retry state
    context.helpers.clearRetryState()

    // Machine handles UI state transitions via STREAM_COMPLETE event
    // (Already sent by CompleteHandler when stream was completed before recovery)

    context.helpers.clearStoredSocketId()
  }

  /**
   * Handle scenario where recovery is complete and stream is active again
   */
  private handleRecoveryFinalized(data: WebSocketMessage, context: MessageContext): void {
    // Recovery complete, stream is active again
    // Machine already in streaming state, adapter handles UI sync
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

      logger.info('websocket.recovery.ack_pending', {
        conversationId: recoveryId,
        expectedCount,
      })
      if (expectedCount === 0) {
        context.helpers.maybeSendRecoveryAck(context.socket)
      }
    }

    // Stream is still active - load history then prepare for replay
    if (data.data?.conversationId && context.currentAppId) {
      await this.loadConversationHistory(data, context)
    } else {
      // No conversation history - still initialize stream for buffered events
      this.initializeRecoveryStream(context)
    }

    // Machine should already be in streaming state during recovery
    // Adapter syncs streamingState from machine
  }

  /**
   * Load conversation history for recovery
   */
  private async loadConversationHistory(
    data: WebSocketMessage,
    context: MessageContext
  ): Promise<void> {
    try {
      const agentService = AgentService.getInstance()
      const conversation = await agentService.getConversation(
        context.currentAppId!,
        data.data!.conversationId as string
      )

      // Add messages to store if we have them
      if (conversation.messages && conversation.messages.length > 0) {
        // Set messages directly in the store (they're already complete messages from DB)
        useStreamingConversationStore.setState({ messages: conversation.messages as any[] })

        // Initialize an empty activeStream to receive buffered events
        // Guard: only create if not already streaming (avoid overwriting on duplicate recovery)
        const store = useStreamingConversationStore.getState()
        if (!store.activeStream) {
          this.createRecoveredStream(context)
        }
      }
    } catch (error) {
      logger.error('websocket.recovery.history_failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Initialize stream for recovery when no history available
   */
  private initializeRecoveryStream(context: MessageContext): void {
    // Guard: only create if not already streaming (avoid overwriting on duplicate recovery)
    const store = useStreamingConversationStore.getState()
    if (!store.activeStream) {
      this.createRecoveredStream(context)
    }
  }

  /**
   * Create a recovered stream message
   */
  private createRecoveredStream(_context: MessageContext): void {
    const streamingMessage = {
      id: `recovered_${Date.now()}`,
      role: 'assistant' as const,
      content: '',
      segments: [],
      toolCalls: [],
      timestamp: new Date(),
      isComplete: false,
    }

    useStreamingConversationStore.setState({
      activeStream: streamingMessage,
      streamingState: 'streaming',
      currentStep: 1,
      isLoading: true,
    })
  }

  /**
   * Handle requiresAck for other recovery scenarios
   */
  private handleRequiresAck(data: WebSocketMessage, context: MessageContext): void {
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

    // Send RECOVERY_STATUS event to machine
    context.machine.send({
      type: 'RECOVERY_STATUS',
      recoveryId,
      expectedEvents: expectedCount
    })

    logger.info('websocket.recovery.ack_pending', {
      conversationId: recoveryId,
      expectedCount,
    })

    // Restore UI state for recovery with no buffered events
    // Machine should already be in recovering/streaming state
    // Adapter syncs isLoading and streamingState from machine
    const store = useStreamingConversationStore.getState()
    if (store.activeStream || data.data?.isRecovering) {
      logger.info('websocket.recovery.ui_restored', {
        conversationId: data.data!.conversationId,
        hasActiveStream: !!store.activeStream,
      })
    }

    if (expectedCount === 0) {
      context.helpers.maybeSendRecoveryAck(context.socket)
    }
  }
}
