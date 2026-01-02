/**
 * StreamingWebSocketController
 *
 * Headless controller for WebSocket streaming logic.
 * Extracted from useStreamingWebSocket to improve testability and enable reuse outside React.
 *
 * Responsibilities:
 * - Coordinate TransportSupervisor and XState machine
 * - Message building and sending
 * - State machine integration via StoreSyncAdapter
 * - Event emission for UI integration (no direct store writes)
 */

import { EventEmitter } from 'events'
import type { Socket } from 'socket.io-client'
import { createActor } from 'xstate'

import { logger } from '@/lib/request-context'
import type { AgentsAppChatMessage } from '@/types/websocket-context'
import { webSocketMachine, type WebSocketMachine } from './webSocketMachine'
import { StoreSyncAdapter } from './StoreSyncAdapter'
import { TransportSupervisor } from './TransportSupervisor'
import type { Actor } from 'xstate'
import type {
  MessageHandlerActions,
  MessageHandlerHelpers,
  RecoveryAck,
  ServerConfig,
  WebSocketStateUpdate,
} from '@/hooks/websocket/handlers/types'
import { ConnectionManager } from './ConnectionManager'
import {
  ChatMessageBuilder,
  type BuildMessageParams,
  type AIEditContext,
  type Asset,
  type TodoContext,
  type BuildError,
  type CustomContext,
} from './ChatMessageBuilder'
import type { VisualContext } from '@/app/develop/components/visualContextCapture'
import {
  clearConversationIdCookie,
  getConversationIdFromCookie,
} from '@/hooks/websocket/useWebSocketHelpers'

export interface StreamingWebSocketControllerEvents {
  'connection:established': { socket: Socket; recovered: boolean }
  'connection:failed': { error: Error }
  'connection:error': { error: Error }
  'disconnect': { reason: Socket.DisconnectReason }
  'reconnect:attempt': void
  'reconnect:success': void
  'reconnect:error': { error: Error }
  'reconnect:failed': void
  'message:sent': { message: AgentsAppChatMessage }
  'message:error': { error: Error }
  // Application-level state events (for adapter to consume)
  'stream:error': { error: Error; shouldFinalize: boolean }
  'transport:retry-started': { socketId: string }
  'transport:retry-cleared': void
  'transport:escalation-timeout': { socketId: string }
}

export interface StreamingWebSocketControllerDeps {
  connectionManager: ConnectionManager
  messageBuilder: ChatMessageBuilder
  actions: MessageHandlerActions
  getHelpers: () => Omit<MessageHandlerHelpers, 'maybeSendRecoveryAck' | 'trackReplayEventReceipt' | 'clearRetryState'>
  toolDeltaBufferRef: { current: Map<string, { name: string; delta: string; hasExplicitName: boolean }> }
  getStoreState: () => {
    streamingState: string
    activeStream: unknown
    buildErrorContext: unknown
    conversations: Array<{ appId: string; id: string }>
    // Lifecycle actions - called by adapter via events
    setWebSocketState: (state: WebSocketStateUpdate) => void
    setStreamingState: (state: string) => void
    setIsLoading: (loading: boolean) => void
    markUpstreamError: (error: { message: string; type?: string }) => void
    finalizeStream: () => void
    startStream: (conversationId: string, messageId: string) => void
    setError: (error: Error) => void
    setRecoveryState: (state: { isRecovering: boolean; expectedEvents: number; receivedEvents: number }) => void
    setRetryState: (state: { isRetrying: boolean; retryCount: number; nextRetryMs?: number; exhausted?: boolean }) => void
  }
}

export class StreamingWebSocketController extends EventEmitter {
  private currentAppId: string | null = null

  // XState machine and adapter
  private machine: Actor<WebSocketMachine>
  private adapter: StoreSyncAdapter
  private supervisor: TransportSupervisor

  // Refs for handler-specific state management
  // Note: These refs manage implementation-specific state (recovery ACK protocol, APP_NOT_FOUND retry, server config)
  // that is too granular for the state machine. Machine handles high-level lifecycle state.
  private serverConfigRef: { current: ServerConfig | null } = { current: null }
  private pendingRecoveryAckRef: { current: RecoveryAck | null } = { current: null }
  private retryStateRef: { current: { pendingMessage?: { chatMessage: AgentsAppChatMessage; startTime: number }; retryCount: number; retryTimer?: NodeJS.Timeout } } = { current: { retryCount: 0 } }

  constructor(private deps: StreamingWebSocketControllerDeps) {
    super()

    // Initialize XState machine
    this.machine = createActor(webSocketMachine)
    this.machine.start()

    // Initialize adapter to sync machine → store
    // Pass full store state for adapter to access application-level actions
    this.adapter = new StoreSyncAdapter(this.machine, this, this.deps.getStoreState)

    // Initialize supervisor for connection lifecycle
    this.supervisor = new TransportSupervisor({
      connectionManager: this.deps.connectionManager,
      machine: this.machine,
      actions: this.deps.actions,
      getHelpers: this.deps.getHelpers,
      refs: {
        serverConfig: this.serverConfigRef,
        pendingRecoveryAck: this.pendingRecoveryAckRef,
        toolDeltaBuffer: this.deps.toolDeltaBufferRef,
        retryState: this.retryStateRef,
      },
      getStreamingState: () => {
        const store = this.deps.getStoreState()
        return {
          streamingState: store.streamingState,
          activeStream: store.activeStream,
        }
      },
    })

    // Forward supervisor events to controller events (for adapter consumption)
    this.supervisor.on('connection:established', (data) => {
      this.emit('connection:established', data)
    })
    this.supervisor.on('connection:failed', (data) => {
      this.emit('connection:failed', data)
    })
    this.supervisor.on('connection:error', (data) => {
      this.emit('connection:error', data)
    })
    this.supervisor.on('disconnect', (data) => {
      this.emit('disconnect', { reason: data.reason })
    })
    this.supervisor.on('reconnect:attempt', () => {
      this.emit('reconnect:attempt')
    })
    this.supervisor.on('reconnect:success', () => {
      this.emit('reconnect:success')
    })
    this.supervisor.on('reconnect:error', (data) => {
      this.emit('reconnect:error', data)
    })
    this.supervisor.on('reconnect:failed', () => {
      this.emit('reconnect:failed')
    })

    // Forward transport-level events for adapter to consume
    this.supervisor.on('transport:retry-started', (data) => {
      this.emit('transport:retry-started', data)
    })
    this.supervisor.on('transport:retry-cleared', () => {
      this.emit('transport:retry-cleared')
    })
    this.supervisor.on('transport:escalation-timeout', (data) => {
      this.emit('transport:escalation-timeout', data)
    })
  }

  /**
   * Connect to WebSocket for the given appId
   */
  async connect(appId: string): Promise<void> {
    this.currentAppId = appId

    // Send CONNECT event to machine
    this.machine.send({ type: 'CONNECT', appId })

    // Delegate to supervisor
    await this.supervisor.connect(appId)
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    this.supervisor.disconnect()
    this.supervisor.clearRetryState()
  }

  /**
   * Cleanup - stop machine, adapter, and supervisor
   */
  destroy(): void {
    this.adapter.destroy()
    this.machine.stop()
    this.disconnect()
  }

  /**
   * Send a message through the WebSocket
   */
  async sendMessage(params: {
    content: string
    visualContext?: VisualContext | null
    aiEditContext?: AIEditContext
    selectedAsset?: Asset
    todoListContext?: TodoContext
    isActionRequest?: boolean
    customContext?: CustomContext
  }): Promise<void> {
    const { content } = params

    if (!content.trim() || !this.currentAppId) return

    try {
      const socket = this.supervisor.getSocket()

      if (!socket) {
        throw new Error('WebSocket connection not initialized. Please wait for connection to establish.')
      }

      if (!socket.connected) {
        throw new Error('WebSocket not connected. Connection may be reconnecting...')
      }

      // Create user message in store (Tier 2 - transcript data)
      this.deps.actions.startNewStream(content)

      const store = this.deps.getStoreState()
      const { conversations, buildErrorContext } = store

      const currentConversation = conversations.find((conv: { appId: string }) => conv.appId === this.currentAppId)
      let conversationId = currentConversation?.id

      if (!conversationId) {
        conversationId = getConversationIdFromCookie(this.currentAppId)
        if (conversationId) {
          clearConversationIdCookie(this.currentAppId)
        }
      }

      const messageParams: BuildMessageParams = {
        content,
        appId: this.currentAppId,
        sessionId: socket.id,
        conversationId,
        visualContext: params.visualContext,
        aiEditContext: params.aiEditContext,
        selectedAsset: params.selectedAsset,
        todoListContext: params.todoListContext,
        buildErrorContext: buildErrorContext as BuildError | null,
        isActionRequest: params.isActionRequest,
        customContext: params.customContext,
      }

      const chatMessage = this.deps.messageBuilder.build(messageParams)

      if (this.retryStateRef.current.retryTimer) {
        clearTimeout(this.retryStateRef.current.retryTimer)
      }

      this.retryStateRef.current = {
        pendingMessage: { chatMessage, startTime: Date.now() },
        retryCount: 0,
      }

      // Send SEND_MESSAGE event to machine (Tier 1 - lifecycle)
      // Machine will transition to streaming state, adapter will update UI
      // Note: conversationId may be undefined for new conversations - server will create one
      this.machine.send({
        type: 'SEND_MESSAGE',
        message: chatMessage,
        conversationId: conversationId ?? ''
      })

      socket.emit('chat_message', chatMessage, (response: any) => {
        if (response?.error) {
          logger.error('websocket.message.ack_error', { error: response.error })
        }
      })

      this.emit('message:sent', { message: chatMessage })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('websocket.message.failure', { error: errorMessage })

      const errorObj = error instanceof Error ? error : new Error(errorMessage)

      // Send STREAM_ERROR event to machine (non-retryable)
      this.machine.send({
        type: 'STREAM_ERROR',
        error: errorObj,
        retryable: false
      })

      // Emit stream:error so adapter can update store (markUpstreamError + finalizeStream)
      this.emit('stream:error', { error: errorObj, shouldFinalize: true })

      this.emit('message:error', { error: errorObj })
    }
  }

  /**
   * Flush tool delta buffer immediately
   */
  flushToolDeltaBufferImmediate(): void {
    this.deps.actions.flushToolDeltaBufferImmediate()
  }

  /**
   * Schedule tool delta flush
   */
  scheduleToolDeltaFlush(): void {
    this.deps.actions.scheduleToolDeltaFlush()
  }
}
