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
import { normalizeConversationMessages, useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
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
    let conversationId = data.data?.conversationId as string | undefined

    // If server didn't provide conversationId, try to get it from store's conversations
    if (!conversationId && context.currentAppId) {
      const store = useStreamingConversationStore.getState()
      const currentConversation = store.conversations.find(
        (conv: { appId: string; id: string }) => conv.appId === context.currentAppId
      )
      conversationId = currentConversation?.id
    }

    let historyLoadSucceeded = false

    // Load conversation history to get the final assistant message
    if (conversationId && context.currentAppId) {
      // Show loading state while fetching history
      useStreamingConversationStore.getState().setIsLoading(true)

      try {
        const agentService = AgentService.getInstance()
        const conversation = await agentService.getConversation(
          context.currentAppId,
          conversationId
        )

        if (conversation.messages && conversation.messages.length > 0) {
          // Normalize messages so the UI keeps segment metadata for formatting
          const normalized = normalizeConversationMessages(conversation.messages)
          useStreamingConversationStore.setState({ messages: normalized })
          historyLoadSucceeded = true
        }
      } catch (error) {
        logger.error('websocket.recovery.history_load_failed', {
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    } else {
      logger.warn('websocket.recovery.no_conversation_id', {
        hasServerConversationId: !!data.data?.conversationId,
        hasStoreConversationId: !!conversationId,
        appId: context.currentAppId,
      });
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
          contentLength: store.activeStream.content.length,
        })
      }
    }
    store.setStreamingState('idle')
    store.setIsLoading(false)

    // Clear connection retry if active
    if (store.connectionRetry.isRetrying) {
      store.clearConnectionRetry()
    }

    // Clear APP_NOT_FOUND retry state
    context.helpers.clearRetryState()
    context.helpers.clearStoredSocketId()
  }

  /**
   * Handle scenario where recovery is complete and stream is active again
   */
  private handleRecoveryFinalized(data: WebSocketMessage, _context: MessageContext): void {
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

      if (expectedCount === 0) {
        context.helpers.maybeSendRecoveryAck(context.socket)
      }
    }

    // Only skip recovery if there's an active stream (user just sent a new message)
    // Don't interfere with new messages being sent
    const store = useStreamingConversationStore.getState()

    if (store.activeStream) {
      // Active stream exists - user just sent a message, don't interfere
      return
    }

    // Create placeholder stream and load history from server
    // Server is source of truth - always fetch even if we have cached messages
    this.initializeRecoveryStream(context)

    if (data.data?.conversationId && context.currentAppId) {
      await this.loadConversationHistory(data, context)

      // Check if stream completed - clear placeholder to stop "thinking" indicator
      const currentStore = useStreamingConversationStore.getState()
      const lastAssistantMsg = this.findLastAssistantMessage(currentStore.messages)
      const streamIsComplete = lastAssistantMsg && !('isComplete' in lastAssistantMsg && !lastAssistantMsg.isComplete)

      if (streamIsComplete && currentStore.activeStream) {
        currentStore.clearActiveStream()
        currentStore.setStreamingState('idle')
        currentStore.setIsLoading(false)
      }
    }
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
        // Normalize messages before hydrating store so segment metadata survives replay
        const normalized = normalizeConversationMessages(conversation.messages)
        useStreamingConversationStore.setState({ messages: normalized })
        // Don't create activeStream here - already created by handleBufferedEvents
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

    // Send RECOVERY_STATUS event to machine
    context.machine.send({
      type: 'RECOVERY_STATUS',
      recoveryId,
      expectedEvents: expectedCount
    })

    // When there are no buffered events, ensure UI is in correct state
    if (expectedCount === 0 && recoveryId && context.currentAppId) {
      const store = useStreamingConversationStore.getState()

      // If we already have cached messages, DON'T replace them with API data.
      // The cache (from appChatHistory) contains segments/tool calls that may
      // not be in the API yet if the stream is still writing to the database.
      if (store.messages.length > 0) {
        // Check if the last assistant message was incomplete (stream was active)
        // If so, recreate the activeStream so new events can be processed
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
            streamingState: 'streaming',
            isLoading: true,
          })
        } else {
          // Stream was complete, clear loading states
          const currentStore = useStreamingConversationStore.getState()
          if (currentStore.activeStream) {
            currentStore.clearActiveStream()
          }
          currentStore.setStreamingState('idle')
          currentStore.setIsLoading(false)
        }
      } else {
        // No cached messages - load from API
        // Show loading state while fetching history
        useStreamingConversationStore.getState().setIsLoading(true)

        try {
          const agentService = AgentService.getInstance()
          const conversation = await agentService.getConversation(
            context.currentAppId,
            recoveryId
          )

          if (conversation.messages && conversation.messages.length > 0) {
            const normalized = normalizeConversationMessages(conversation.messages)
            useStreamingConversationStore.setState({ messages: normalized })
          }
        } catch (error) {
          logger.error('websocket.recovery.history_load_failed_no_buffer', {
            conversationId: recoveryId,
            error: error instanceof Error ? error.message : String(error),
          })
        }

        // Clear loading states since there are no buffered events and we loaded from API
        const currentStore = useStreamingConversationStore.getState()
        if (currentStore.activeStream) {
          currentStore.clearActiveStream()
        }
        currentStore.setStreamingState('idle')
        currentStore.setIsLoading(false)
      }
    }

    if (expectedCount === 0) {
      context.helpers.maybeSendRecoveryAck(context.socket)
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
