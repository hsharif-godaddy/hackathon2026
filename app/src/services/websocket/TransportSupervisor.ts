/**
 * TransportSupervisor
 *
 * Encapsulates WebSocket connection lifecycle and socket handler wiring.
 * Extracted from StreamingWebSocketController to reduce complexity and improve testability.
 *
 * Responsibilities:
 * - Socket event handler setup (message, status)
 * - Connection lifecycle event delegation
 * - Recovery protocol coordination (ACK tracking)
 * - Message handler registry integration
 */

import { EventEmitter } from 'events'
import type { Socket } from 'socket.io-client'

import { logger } from '@/lib/request-context'
import type { ConnectionManager, ConnectionCallbacks } from './ConnectionManager'
import type { WebSocketActor } from './stateMachineTypes'
import type {
  MessageHandlerActions,
  MessageHandlerHelpers,
  MessageHandlerRefs,
  MessageContext,
  RecoveryAck,
  ServerConfig,
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
import {
  setConversationIdCookie,
} from '@/hooks/websocket/useWebSocketHelpers'

/**
 * Events emitted by TransportSupervisor for controller/adapter to consume
 */
export interface TransportSupervisorEvents {
  'connection:established': { socket: Socket; recovered: boolean }
  'connection:failed': { error: Error }
  'connection:error': { error: Error }
  'disconnect': { reason: Socket.DisconnectReason; socket: Socket; wasStreaming: boolean }
  'reconnect:attempt': { socket: Socket }
  'reconnect:success': { socket: Socket }
  'reconnect:error': { error: Error }
  'reconnect:failed': { socket: Socket; wasStreaming: boolean }
  // Application-level events (not transport-level)
  'transport:retry-started': { socketId: string }
  'transport:retry-cleared': void
  'transport:escalation-timeout': { socketId: string }
}

export interface TransportSupervisorDeps {
  connectionManager: ConnectionManager
  machine: WebSocketActor
  actions: MessageHandlerActions
  getHelpers: () => Omit<MessageHandlerHelpers, 'maybeSendRecoveryAck' | 'trackReplayEventReceipt' | 'clearRetryState'>
  refs: {
    serverConfig: { current: ServerConfig | null }
    pendingRecoveryAck: { current: RecoveryAck | null }
    toolDeltaBuffer: { current: Map<string, { name: string; delta: string; hasExplicitName: boolean }> }
    retryState: { current: { pendingMessage?: { chatMessage: unknown; startTime: number }; retryCount: number; retryTimer?: NodeJS.Timeout } }
  }
  getStreamingState: () => {
    streamingState: string
    activeStream: unknown
  }
}

const CONNECTION_RETRY_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

/**
 * TransportSupervisor
 *
 * Manages Socket.IO connection lifecycle and message handler coordination
 */
export class TransportSupervisor extends EventEmitter {
  private socket: Socket | null = null
  private currentAppId: string | null = null
  private socketsWithHandlers = new WeakSet<Socket>()
  private escalationTimeoutId: NodeJS.Timeout | null = null

  constructor(private deps: TransportSupervisorDeps) {
    super()
  }

  /**
   * Connect to WebSocket for the given appId
   */
  async connect(appId: string): Promise<void> {
    this.currentAppId = appId

    const callbacks: ConnectionCallbacks = {
      onSocketReady: (socket, meta) => {
        this.handleSocketReady(socket, meta)
      },
      onConnect: (params) => this.handleConnectionEstablished(params),
      onConnectionFailed: (error) => this.handleConnectionFailed(error),
      onConnectError: (error) => this.handleConnectError(error),
      onDisconnect: (params) => this.handleDisconnect(params),
      onReconnectAttempt: (params) => this.handleReconnectAttempt(params),
      onReconnect: (params) => this.handleReconnect(params),
      onReconnectError: (params) => this.handleReconnectError(params),
      onReconnectFailed: (params) => this.handleReconnectFailed(params),
    }

    await this.deps.connectionManager.connect(appId, callbacks)
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    this.clearEscalationTimeout()
    this.deps.connectionManager.disconnect()
    this.socket = null
    this.deps.refs.pendingRecoveryAck.current = null
  }

  /**
   * Get current socket
   */
  getSocket(): Socket | null {
    return this.socket
  }

  /**
   * Clear retry state
   */
  clearRetryState(): void {
    if (this.deps.refs.retryState.current.retryTimer) {
      clearTimeout(this.deps.refs.retryState.current.retryTimer)
    }
    this.deps.refs.retryState.current = { retryCount: 0 }
  }

  private handleSocketReady(socket: Socket, meta: { isNew: boolean }): void {
    this.socket = socket

    // Send TOKEN_REFRESHED to machine (token was successfully fetched)
    this.deps.machine.send({ type: 'TOKEN_REFRESHED' })

    if (!this.socketsWithHandlers.has(socket)) {
      this.setupEventHandlers(socket)
      this.socketsWithHandlers.add(socket)
    }
  }

  private handleConnectionEstablished({ socket, recovered }: { socket: Socket; recovered: boolean }): void {
    // Send CONNECTION_ESTABLISHED event to machine
    this.deps.machine.send({ type: 'CONNECTION_ESTABLISHED', socketId: socket.id })

    this.emit('connection:established', { socket, recovered })
  }

  private handleConnectionFailed(error: Error): void {
    const errorMessage = error?.message ?? 'Unknown error'
    logger.error('websocket.connection.init_failed', {
      message: 'Failed to initialize persistent connection',
      error: errorMessage,
      appId: this.currentAppId,
    })

    // Send TOKEN_REFRESH_FAILED or CONNECTION_FAILED to machine
    this.deps.machine.send({ type: 'TOKEN_REFRESH_FAILED', error })
    this.deps.machine.send({ type: 'CONNECTION_FAILED', error })

    this.emit('connection:failed', { error })
  }

  private handleConnectError(error: Error): void {
    const errorMessage = error?.message ?? 'Unknown error'
    logger.error('websocket.connection.error', {
      message: errorMessage,
      appId: this.currentAppId,
    })

    this.emit('connection:error', { error })
  }

  private handleDisconnect({ reason, socket }: { reason: Socket.DisconnectReason; socket: Socket }): void {
    this.deps.refs.pendingRecoveryAck.current = null

    // Send DISCONNECT event to machine
    this.deps.machine.send({ type: 'DISCONNECT', reason: reason || 'unknown' })

    const { streamingState, activeStream } = this.deps.getStreamingState()
    const isStreaming =
      streamingState === 'streaming' || streamingState === 'retrying' || activeStream !== null

    // Emit event for adapter/controller to handle retry tracking
    if (isStreaming) {
      this.emit('transport:retry-started', { socketId: socket.id })

      // Set escalation timeout
      this.escalationTimeoutId = setTimeout(() => {
        const currentState = this.deps.getStreamingState()
        logger.warn('websocket.escalation.timeout-fired', {
          socketId: socket.id,
        })

        this.emit('transport:escalation-timeout', { socketId: socket.id })
      }, this.deps.refs.serverConfig.current?.streamRecoveryWindow ?? CONNECTION_RETRY_TIMEOUT_MS)
    }

    this.emit('disconnect', { reason, socket, wasStreaming: isStreaming })
  }

  private handleReconnectAttempt({ socket }: { socket: Socket; attempt: number }): void {
    this.emit('reconnect:attempt', { socket })
  }

  private handleReconnect({ socket }: { socket: Socket; attempt: number }): void {
    this.clearEscalationTimeout()
    this.emit('reconnect:success', { socket })
  }

  private handleReconnectError({ error }: { socket: Socket; error: Error }): void {
    logger.warn('websocket.reconnect.error', {
      error: error.message,
    })
    this.emit('reconnect:error', { error })
  }

  private handleReconnectFailed({ socket }: { socket: Socket }): void {
    this.clearEscalationTimeout()

    const { streamingState, activeStream } = this.deps.getStreamingState()
    const isStreaming =
      streamingState === 'streaming' || streamingState === 'retrying' || activeStream !== null

    this.emit('reconnect:failed', { socket, wasStreaming: isStreaming })
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
      refs: this.deps.refs,
      machine: this.deps.machine,
    }

    socket.on('status', (data) => {
      if (data.data?.status === 'thinking') {
        logger.debug('websocket.status.thinking', {
          appId: this.currentAppId,
        })
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
    const pending = this.deps.refs.pendingRecoveryAck.current
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
    this.deps.refs.pendingRecoveryAck.current = null
  }

  private trackReplayEventReceipt(socket: Socket | null, eventType: string): void {
    const pending = this.deps.refs.pendingRecoveryAck.current
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

  private clearEscalationTimeout(): void {
    if (this.escalationTimeoutId) {
      clearTimeout(this.escalationTimeoutId)
      this.escalationTimeoutId = null
    }
  }
}
