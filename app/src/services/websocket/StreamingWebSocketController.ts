/**
 * StreamingWebSocketController
 *
 * Headless controller for WebSocket streaming logic.
 * Extracted from useStreamingWebSocket to improve testability and enable reuse outside React.
 *
 * Responsibilities:
 * - Connection lifecycle management via ConnectionManager
 * - Message handler registry setup and dispatch
 * - Recovery, retry, and tool delta state management
 * - Event emission for UI integration
 */

import { EventEmitter } from 'events'
import type { Socket } from 'socket.io-client'

import { logger } from '@/lib/request-context'
import type { AgentsAppChatMessage } from '@/types/websocket-context'
import type {
  MessageContext,
  MessageHandlerActions,
  MessageHandlerHelpers,
  MessageHandlerRefs,
  RecoveryAck,
  ServerConfig,
  WebSocketStateUpdate,
} from '@/hooks/websocket/handlers/types'
import {
  CatchupCompleteHandler,
  CatchupStatusHandler,
  ChunkHandler,
  CompleteHandler,
  ConversationInfoHandler,
  ErrorHandler,
  MessageHandlerRegistry,
  RecoveryStatusHandler,
  ReplayCompleteHandler,
  ServerConfigHandler,
  StepCompleteHandler,
  StepStartHandler,
  ToolCallHandler,
  ToolInputDeltaHandler,
  ToolResultHandler,
  ToolStartHandler,
} from '@/hooks/websocket/handlers'
import { ConnectionManager, type ConnectionCallbacks } from './ConnectionManager'
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
  setConversationIdCookie,
} from '@/hooks/websocket/useWebSocketHelpers'

const CONNECTION_RETRY_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export interface StreamingWebSocketControllerEvents {
  'connection:established': { socket: Socket; recovered: boolean }
  'connection:failed': { error: Error }
  'connection:error': { error: Error }
  'disconnect': { reason: Socket.DisconnectReason }
  'reconnect:attempt': void
  'reconnect:success': void
  'reconnect:error': { error: Error }
  'reconnect:failed': void
  'websocket:state': WebSocketStateUpdate
  'streaming:state': { state: string }
  'streaming:loading': { loading: boolean }
  'message:sent': { message: AgentsAppChatMessage }
  'message:error': { error: Error }
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
    connectionRetry: {
      isRetrying: boolean
      wasStreamingOnDisconnect: boolean
      retryStartedAt: number | null
    }
    buildErrorContext: unknown
    conversations: Array<{ appId: string; id: string }>
    startConnectionRetry: (socketId: string) => void
    clearConnectionRetry: () => void
    setEscalationTimeout: (timeoutId: NodeJS.Timeout) => void
    setWebSocketState: (state: WebSocketStateUpdate) => void
    setStreamingState: (state: string) => void
    setIsLoading: (loading: boolean) => void
    markUpstreamError: (error: { message: string; type?: string }) => void
    finalizeStream: () => void
  }
}

export class StreamingWebSocketController extends EventEmitter {
  private socket: Socket | null = null
  private currentAppId: string | null = null
  private socketsWithHandlers = new WeakSet<Socket>()

  // State refs - using objects with current property to match React ref behavior
  private serverConfigRef: { current: ServerConfig | null } = { current: null }
  private pendingRecoveryAckRef: { current: RecoveryAck | null } = { current: null }
  private retryStateRef: { current: { pendingMessage?: { chatMessage: AgentsAppChatMessage; startTime: number }; retryCount: number; retryTimer?: NodeJS.Timeout } } = { current: { retryCount: 0 } }
  private wasRecoveredRef = false

  constructor(private deps: StreamingWebSocketControllerDeps) {
    super()
  }

  /**
   * Connect to WebSocket for the given appId
   */
  async connect(appId: string): Promise<void> {
    this.currentAppId = appId

    const callbacks: ConnectionCallbacks = {
      onSocketReady: (socket, meta) => this.handleSocketReady(socket, meta),
      onConnect: (params) => this.handleConnectionEstablished(params),
      onConnectionFailed: (error) => this.handleConnectionFailed(error),
      onConnectError: (error) => this.handleConnectError(error),
      onDisconnect: (params) => this.handleDisconnect(params),
      onReconnectAttempt: () => this.handleReconnectAttempt(),
      onReconnect: (params) => this.handleReconnect(params),
      onReconnectError: (params) => this.handleReconnectError(params),
      onReconnectFailed: (params) => this.handleReconnectFailed(params),
    }

    await this.deps.connectionManager.connect(appId, callbacks)
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    this.deps.connectionManager.disconnect()
    this.socket = null
    this.clearRetryState()
    this.pendingRecoveryAckRef.current = null
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
      const socket = this.socket

      if (!socket) {
        throw new Error('WebSocket connection not initialized. Please wait for connection to establish.')
      }

      if (!socket.connected) {
        throw new Error('WebSocket not connected. Connection may be reconnecting...')
      }

      this.deps.actions.setIsLoading(true)
      this.deps.actions.setStreamingState('streaming')
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

      socket.emit('chat_message', chatMessage, (response: any) => {
        if (response?.error) {
          logger.error('websocket.message.ack_error', { error: response.error })
        }
      })

      this.emit('message:sent', { message: chatMessage })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('websocket.message.failure', { error: errorMessage })

      this.deps.actions.setWebSocketState({
        status: 'error',
        error: { message: errorMessage },
      })
      this.deps.actions.setStreamingState('error')
      this.deps.actions.setIsLoading(false)

      this.emit('message:error', { error: error instanceof Error ? error : new Error(errorMessage) })
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

  private handleSocketReady(socket: Socket, meta: { isNew: boolean }): void {
    this.socket = socket
    if (!this.socketsWithHandlers.has(socket)) {
      this.setupEventHandlers(socket)
      this.socketsWithHandlers.add(socket)
    }
  }

  private handleConnectionEstablished({ socket, recovered }: { socket: Socket; recovered: boolean }): void {
    this.wasRecoveredRef = recovered
    this.deps.actions.setWebSocketState({ connected: true, status: 'idle' })
    this.emit('connection:established', { socket, recovered })

    const store = this.deps.getStoreState()
    if (store.connectionRetry.isRetrying) {
      logger.info('websocket.connect.clearing-stale-retry', {
        socketId: socket.id,
        elapsedMs: store.connectionRetry.retryStartedAt ? Date.now() - store.connectionRetry.retryStartedAt : null,
      })

      if (store.streamingState === 'retrying') {
        this.deps.actions.setStreamingState('streaming')
        this.deps.actions.setIsLoading(true)
        logger.info('websocket.stream.recovered-on-connect', { socketId: socket.id })
      } else {
        logger.info('websocket.connect.retry-already-cleared', {
          socketId: socket.id,
          currentStreamingState: store.streamingState,
        })
      }

      store.clearConnectionRetry()
    }
  }

  private handleConnectionFailed(error: Error): void {
    const errorMessage = error?.message ?? 'Unknown error'
    logger.error('websocket.connection.init_failed', {
      message: 'Failed to initialize persistent connection',
      error: errorMessage,
      appId: this.currentAppId,
    })

    this.deps.actions.setWebSocketState({
      connected: false,
      status: 'error',
      error: { message: errorMessage },
    })

    this.emit('connection:failed', { error })
  }

  private handleConnectError(error: Error): void {
    const errorMessage = error?.message ?? 'Unknown error'
    logger.error('websocket.connection.error', {
      message: errorMessage,
      appId: this.currentAppId,
    })

    this.deps.actions.setWebSocketState({
      connected: false,
      status: 'error',
      error: { message: errorMessage },
    })

    this.emit('connection:error', { error })
  }

  private handleDisconnect({ reason, socket }: { reason: Socket.DisconnectReason; socket: Socket }): void {
    this.pendingRecoveryAckRef.current = null
    const store = this.deps.getStoreState()
    const isStreaming =
      store.streamingState === 'streaming' || store.streamingState === 'retrying' || store.activeStream !== null

    if (isStreaming) {
      store.startConnectionRetry(socket.id)

      this.deps.actions.setWebSocketState({
        connected: false,
        status: 'connecting',
        error: {
          message: reason ? `Connection lost (${reason}), retrying...` : 'Connection lost, retrying...',
          type: 'NETWORK_ERROR',
        },
      })

      const escalationTimeoutId = setTimeout(() => {
        const currentStore = this.deps.getStoreState()
        if (currentStore.connectionRetry.isRetrying) {
          logger.warn('websocket.escalation.timeout-fired', {
            socketId: socket.id,
            elapsedMs: currentStore.connectionRetry.retryStartedAt
              ? Date.now() - currentStore.connectionRetry.retryStartedAt
              : null,
          })

          const { activeStream } = currentStore
          if (activeStream) {
            currentStore.markUpstreamError({
              message: 'Connection lost - retry timeout exceeded',
              type: 'NETWORK_ERROR',
            })
            currentStore.finalizeStream()
          }

          currentStore.setWebSocketState({
            connected: false,
            status: 'error',
            error: { message: 'Connection lost - retry timeout exceeded' },
          })
          currentStore.setStreamingState('idle')
          currentStore.setIsLoading(false)
          currentStore.clearConnectionRetry()
        }
      }, this.serverConfigRef.current?.streamRecoveryWindow ?? CONNECTION_RETRY_TIMEOUT_MS)

      store.setEscalationTimeout(escalationTimeoutId)
    } else {
      this.deps.actions.setWebSocketState({ connected: false, status: 'idle' })
    }

    this.emit('disconnect', { reason })
  }

  private handleReconnectAttempt(): void {
    this.deps.actions.setWebSocketState({ connected: false, status: 'connecting' })
    this.emit('reconnect:attempt')
  }

  private handleReconnect({ socket }: { socket: Socket }): void {
    this.deps.actions.setWebSocketState({ connected: true, status: 'idle' })
    const store = this.deps.getStoreState()

    if (store.connectionRetry.isRetrying) {
      logger.info('websocket.reconnect.resuming-stream', {
        socketId: socket.id,
        elapsedMs: store.connectionRetry.retryStartedAt ? Date.now() - store.connectionRetry.retryStartedAt : null,
      })

      if (store.streamingState === 'retrying') {
        this.deps.actions.setStreamingState('streaming')
        this.deps.actions.setIsLoading(true)
        logger.info('websocket.stream.recovered', { socketId: socket.id })
      } else {
        this.deps.actions.setStreamingState('error')
        this.deps.actions.setIsLoading(false)
      }

      store.clearConnectionRetry()
    }

    this.emit('reconnect:success')
  }

  private handleReconnectError({ error }: { socket: Socket; error: Error }): void {
    this.deps.actions.setWebSocketState({ connected: false, status: 'connecting', error: { message: error.message } })
    this.emit('reconnect:error', { error })
  }

  private handleReconnectFailed(_: { socket: Socket }): void {
    const store = this.deps.getStoreState()
    const isStreaming =
      store.streamingState === 'streaming' || store.streamingState === 'retrying' || store.activeStream !== null
    const wasRetrying = store.connectionRetry.isRetrying || store.connectionRetry.wasStreamingOnDisconnect

    if (store.connectionRetry.isRetrying) {
      store.clearConnectionRetry()
    }

    this.deps.actions.setWebSocketState({ connected: false, status: 'error', error: { message: 'Failed to reconnect' } })

    if (isStreaming || wasRetrying) {
      const { activeStream } = store
      if (activeStream) {
        store.markUpstreamError({
          message: 'Failed to reconnect after multiple attempts',
          type: 'NETWORK_ERROR',
        })
        store.finalizeStream()
      }
      this.deps.actions.setStreamingState('idle')
      this.deps.actions.setIsLoading(false)
    }

    this.emit('reconnect:failed')
  }

  private setupEventHandlers(socket: Socket): void {
    const registry = new MessageHandlerRegistry()

    registry.register(new ServerConfigHandler())
    registry.register(new ConversationInfoHandler())
    registry.register(new RecoveryStatusHandler())
    registry.register(new ReplayCompleteHandler())
    registry.register(new CatchupStatusHandler())
    registry.register(new CatchupCompleteHandler())
    registry.register(new StepStartHandler())
    registry.register(new ChunkHandler())
    registry.register(new ToolStartHandler())
    registry.register(new ToolInputDeltaHandler())
    registry.register(new ToolCallHandler())
    registry.register(new ToolResultHandler())
    registry.register(new StepCompleteHandler())
    registry.register(new CompleteHandler())
    registry.register(new ErrorHandler())

    const messageContext: MessageContext = {
      socket,
      currentAppId: this.currentAppId,
      actions: this.deps.actions,
      helpers: {
        ...this.deps.getHelpers(),
        maybeSendRecoveryAck: (socket, force) => this.maybeSendRecoveryAck(socket, force),
        trackReplayEventReceipt: (socket, eventType) => this.trackReplayEventReceipt(socket, eventType),
        clearRetryState: () => this.clearRetryState(),
      },
      refs: {
        serverConfig: this.serverConfigRef,
        pendingRecoveryAck: this.pendingRecoveryAckRef,
        toolDeltaBuffer: this.deps.toolDeltaBufferRef,
        retryState: this.retryStateRef,
      },
    }

    socket.on('status', (data) => {
      if (data.data?.status === 'thinking') {
        this.deps.actions.setWebSocketState({ status: 'streaming' })
        this.deps.actions.setStreamingState('streaming')
      }
    })

    socket.on('message', async (data: { type: string; content: string; data?: any }, ack?: () => void) => {
      if (data.data?.conversationId && messageContext.currentAppId && typeof data.data.conversationId === 'string') {
        setConversationIdCookie(messageContext.currentAppId, data.data.conversationId)
      }

      messageContext.helpers.trackReplayEventReceipt(socket, data.type)

      await registry.dispatch(data.type, data, messageContext, ack)
    })
  }

  private maybeSendRecoveryAck(socket: Socket | null, force = false): void {
    const pending = this.pendingRecoveryAckRef.current
    if (!pending || !socket) return
    if (!pending.replayComplete) return

    if (!force && pending.expectedCount > 0 && pending.receivedCount < pending.expectedCount) {
      return
    }

    socket.emit(pending.ackEvent, {
      conversationId: pending.conversationId,
      lastSequence: pending.lastSequence,
    })
    logger.info('websocket.recovery.ack_sent', {
      conversationId: pending.conversationId,
      lastSequence: pending.lastSequence,
      expectedCount: pending.expectedCount,
      receivedCount: pending.receivedCount,
      forced: force,
    })
    this.pendingRecoveryAckRef.current = null
  }

  private trackReplayEventReceipt(socket: Socket | null, eventType: string): void {
    const pending = this.pendingRecoveryAckRef.current
    if (!pending || !socket) return

    if (
      eventType === 'recovery_status' ||
      eventType === 'replay_complete' ||
      eventType === 'catchup_status' ||
      eventType === 'catchup_complete'
    )
      return

    pending.receivedCount++
    this.maybeSendRecoveryAck(socket)
  }

  private clearRetryState(): void {
    if (this.retryStateRef.current.retryTimer) {
      clearTimeout(this.retryStateRef.current.retryTimer)
    }
    this.retryStateRef.current = { retryCount: 0 }
  }
}
