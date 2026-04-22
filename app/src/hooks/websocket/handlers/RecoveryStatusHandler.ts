/**
 * Recovery Status Handler
 *
 * Handles recovery_status messages from server during connection recovery.
 * Manages three scenarios:
 * 1. Stream already completed - emit load_history and finalize
 * 2. Recovery complete - emit load_history
 * 3. Has buffered events - prepare for replay
 */

import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { emitLoadHistoryIfNeeded } from './historyHelpers'
import type { LifecycleHandlerContext, MessageHandler, WebSocketMessage } from './types'

const DATA_LOSS_ERROR_MESSAGE = 'Some earlier data could not be recovered due to buffer limits.'

export class RecoveryStatusHandler implements MessageHandler {
  readonly type = 'recovery_status'

  async handle(data: WebSocketMessage, context: LifecycleHandlerContext): Promise<void> {
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
   * Handle scenario where stream already completed before recovery.
   *
   * Reached from multiple server paths: runStaleReconnect (which falls through to
   * sendAvailableAgents), and early-exit failures in handleConversationRecovery /
   * handleInitialRecovery (no stream found, validation failed) where agents_available
   * is never sent. To cover all cases, emit load_history directly with a dedupe guard
   * so the client doesn't wait for the 15s safety timeout.
   */
  private async handleStreamCompleted(
    data: WebSocketMessage,
    context: LifecycleHandlerContext
  ): Promise<void> {
    // Reset history received flag for this recovery session
    if (context.refs.historyReceivedForRecovery) {
      context.refs.historyReceivedForRecovery.current = false
    }

    const store = useStreamingConversationStore.getState()
    if (store.activeStream) {
      store.clearActiveStream()
    }

    // Ensure stream state machine transitions to completed
    const snapshot = context.machine.getSnapshot()
    const isStreaming = snapshot.matches({ stream: { streaming: 'receiving' } }) ||
                       snapshot.matches({ stream: { streaming: 'completing' } })
    if (isStreaming) {
      context.machine.send({ type: 'STREAM_COMPLETE' })
    }

    // Clear connection retry if active
    if (store.connectionRetry.isRetrying) {
      store.clearConnectionRetry()
    }

    // Clear APP_NOT_FOUND retry state
    context.helpers.clearRetryState()

    // Emit load_history if not already requested. This covers recovery paths
    // where agents_available is never sent (conversation/initial recovery
    // early-exit failures). The historyLoadRequested guard prevents duplicates
    // when agents_available does follow (e.g. runStaleReconnect fall-through).
    emitLoadHistoryIfNeeded(context, 'stream_completed')
  }

  /**
   * Handle scenario where recovery is complete and stream is active again
   */
  private handleRecoveryFinalized(data: WebSocketMessage, context: LifecycleHandlerContext): void {
    context.machine.send({ type: 'CATCHUP_COMPLETE' })

    logger.info('websocket.recovery.finalized', {
      eventsReplayed: data.data?.eventsReplayed,
    })

    // pendingRecoveryAck is already cleared by maybeSendRecoveryAck in ReplayCompleteHandler
    // before this handler runs, so we read the conversationId from the cookie directly —
    // the same source of truth AgentsAvailableHandler uses.
    emitLoadHistoryIfNeeded(context, 'recovery_finalized')
  }

  /**
   * Handle scenario where there are buffered events to replay
   */
  private async handleBufferedEvents(
    data: WebSocketMessage,
    context: LifecycleHandlerContext
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
      if (context.refs.historyReceivedForRecovery) {
        context.refs.historyReceivedForRecovery.current = false
      }

      // Clear partial messages from any interrupted history load. Buffered events are
      // about to be replayed and will repopulate messages. After replay, load_history
      // will prepend older history to the replayed content.
      const storeForClear = useStreamingConversationStore.getState()
      if (!storeForClear.historyLoadingComplete && storeForClear.messages.length > 0 && !storeForClear.activeStream) {
        storeForClear.clearMessages()
      }

      context.refs.pendingRecoveryAck.current = {
        conversationId: recoveryId,
        lastSequence: data.data.lastSequence as number,
        expectedCount,
        receivedCount: 0,
        replayComplete: expectedCount === 0,
        ackEvent: 'recovery_ack',
        streamCompleted: data.data?.streamCompleted === true,
      }

      // Send RECOVERY_STATUS event to machine
      context.machine.send({
        type: 'RECOVERY_STATUS',
        recoveryId,
        expectedEvents: expectedCount
      })

      // Don't send ack immediately - wait for replay_complete
    }

    // Only skip recovery if there's an active stream (user just sent a new message)
    const store = useStreamingConversationStore.getState()

    if (store.activeStream) {
      return
    }

    // Create placeholder stream
    const conversationId = (data.data?.conversationId as string | undefined) || ''
    this.initializeRecoveryStream(context, conversationId)

    // Check if stream completed - clear placeholder to stop "thinking" indicator
    const currentStore = useStreamingConversationStore.getState()
    const lastAssistantMsg = this.findLastAssistantMessage(currentStore.messages)
    const streamIsComplete = lastAssistantMsg && !('isComplete' in lastAssistantMsg && !lastAssistantMsg.isComplete)

    if (streamIsComplete && currentStore.activeStream) {
      currentStore.clearActiveStream()

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
  private initializeRecoveryStream(context: LifecycleHandlerContext, conversationId: string): void {
    const store = useStreamingConversationStore.getState()
    if (!store.activeStream) {
      this.createRecoveredStream(context, conversationId)
    }
  }

  /**
   * Create a recovered stream message
   */
  private createRecoveredStream(context: LifecycleHandlerContext, conversationId: string): void {
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
      currentStep: 1,
    })

    context.machine.send({
      type: 'STREAM_STARTED',
      conversationId: conversationId,
      messageId: streamingMessage.id,
    })
  }

  /**
   * Handle requiresAck for other recovery scenarios
   */
  private async handleRequiresAck(data: WebSocketMessage, context: LifecycleHandlerContext): Promise<void> {
    const expectedCount = (data.data?.bufferedEventCount as number) ?? 0
    const recoveryId = data.data!.conversationId as string

    context.refs.pendingRecoveryAck.current = {
      conversationId: recoveryId,
      lastSequence: data.data!.lastSequence as number,
      expectedCount,
      receivedCount: 0,
      replayComplete: expectedCount === 0,
      ackEvent: 'recovery_ack',
      streamCompleted: data.data?.streamCompleted === true,
    }

    // Reset history received flag for this recovery session
    if (context.refs.historyReceivedForRecovery) {
      context.refs.historyReceivedForRecovery.current = false
    }

    // Clear partial messages from any interrupted history load. No buffered events
    // will repopulate messages here (expectedCount === 0), so history can use replace.
    const storeForClear = useStreamingConversationStore.getState()
    if (!storeForClear.historyLoadingComplete && storeForClear.messages.length > 0 && !storeForClear.activeStream) {
      storeForClear.clearMessages()
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

      if (store.messages.length > 0) {
        const lastMsg = this.findLastAssistantMessage(store.messages)
        const wasStreaming = lastMsg && 'isComplete' in lastMsg && lastMsg.isComplete === false

        if (wasStreaming) {
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

          context.machine.send({
            type: 'STREAM_STARTED',
            conversationId: recoveryId,
            messageId: lastMsg.id,
          })
        } else {
          const currentStore = useStreamingConversationStore.getState()
          if (currentStore.activeStream) {
            currentStore.clearActiveStream()
          }

          const snapshot = context.machine.getSnapshot()
          const isStreaming = snapshot.matches({ stream: { streaming: 'receiving' } }) ||
                             snapshot.matches({ stream: { streaming: 'completing' } })
          if (isStreaming) {
            context.machine.send({ type: 'STREAM_COMPLETE' })
          }
        }
      } else {
        logger.warn('websocket.recovery.no_history_available', {
          conversationId: recoveryId,
          appId: context.currentAppId
        })

        const currentStore = useStreamingConversationStore.getState()
        if (currentStore.activeStream) {
          currentStore.clearActiveStream()
        }

        const snapshot = context.machine.getSnapshot()
        const isStreaming = snapshot.matches({ stream: { streaming: 'receiving' } }) ||
                           snapshot.matches({ stream: { streaming: 'completing' } })
        if (isStreaming) {
          context.machine.send({ type: 'STREAM_COMPLETE' })
        }
      }
    }

    // Don't send ack immediately - wait for replay_complete
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
