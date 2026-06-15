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
import type { DisconnectDescription, Socket } from 'socket.io-client'
import type { BudgetUpdatePayload } from '@airo/shared/budget'
import { DEBUG_TURN_STATS_EVENT, type DebugTurnStatsEvent } from '@airo/shared/websocket'

import {
  AgentsAvailableHandler,
  BuildPhaseHandler,
  CatchupCompleteHandler,
  CatchupStatusHandler,
  ChunkHandler,
  ClientActionHandler,
  CompleteHandler,
  ConversationInfoHandler,
  ErrorHandler,
  HistoryCompleteHandler,
  HistoryLoadedHandler,
  HistoryMessageHandler,
  LogoHandler,
  MessageHandlerRegistry,
  RecoveryStatusHandler,
  ReplayCompleteHandler,
  ServerConfigHandler,
  StepCompleteHandler,
  StepStartHandler,
  StreamRetryHandler,
  ToolCallHandler,
  ToolInputDeltaHandler,
  ToolResultHandler,
  ToolStartHandler,
  ValidationMessageHandler,
  VideoHandler,
} from '@/hooks/websocket/handlers'
import {
  type MessageContext,
  type MessageHandlerActions,
  type MessageHandlerHelpers,
  RECOVERY_CONTROL_MESSAGE_TYPES,
  type RecoveryAck,
  type ServerConfig,
} from '@/hooks/websocket/handlers/types'
import {
  setConversationIdCookie,
} from '@/hooks/websocket/useWebSocketHelpers'
import { logger } from '@/lib/request-context'
import type { ConnectionCallbacks, ConnectionManager } from './ConnectionManager'
import type { NetworkQualityMonitor } from './NetworkQualityMonitor'
import type { WebSocketActor } from './stateMachineTypes'

/**
 * Events emitted by TransportSupervisor for controller/adapter to consume
 */
export interface TransportSupervisorEvents {
  'connection:established': { socket: Socket; recovered: boolean }
  'connection:failed': { error: Error }
  'connection:error': { error: Error }
  'disconnect': { reason: Socket.DisconnectReason; socket: Socket; wasStreaming: boolean; description?: DisconnectDescription }
  'reconnect:attempt': { socket: Socket }
  'reconnect:success': { socket: Socket }
  'reconnect:error': { error: Error }
  'reconnect:failed': { socket: Socket; wasStreaming: boolean }
  // Application-level events (not transport-level)
  'transport:retry-started': { socketId: string }
  'transport:retry-cleared': void
  'transport:escalation-timeout': { socketId: string }
  // Grant context events
  'grant:refresh-requested': void
  // Budget update events
  'budget:update': BudgetUpdatePayload
}

export interface TransportSupervisorDeps {
  connectionManager: ConnectionManager
  machine: WebSocketActor
  getActions: () => MessageHandlerActions
  getHelpers: () => Omit<MessageHandlerHelpers, 'maybeSendRecoveryAck' | 'trackReplayEventReceipt' | 'clearRetryState'>
  t?: (id: string, values?: Record<string, any>) => string
  qualityMonitor?: NetworkQualityMonitor
  refs: {
    serverConfig: { current: ServerConfig | null }
    pendingRecoveryAck: { current: RecoveryAck | null }
    toolDeltaBuffer: { current: Map<string, { name: string; delta: string; hasExplicitName: boolean }> }
    retryState: { current: { pendingMessage?: { chatMessage: unknown; startTime: number }; retryCount: number; retryTimer?: NodeJS.Timeout } }
    /**
     * Controller reference for deduplication during recovery replay
     * Optional to maintain backwards compatibility with tests
     */
    controller?: {
      isInReplayMode(): boolean
      startReplayDeduplication(): void
      clearReplayDeduplication(): void
      hasSeenEvent(eventKey: string | undefined): boolean
      markEventSeen(eventKey: string | undefined): void
    }
    /**
     * Batch buffer for incremental history loading
     */
    historyBatch?: { current: any[] }
    /**
     * Timer for flushing history batch
     */
    historyBatchTimer?: { current: NodeJS.Timeout | null }
    /**
     * Tracks if we've received history for current recovery session
     */
    historyReceivedForRecovery?: { current: boolean }
  }
  getStreamingState: () => {
    streamingState: string
    activeStream: unknown
  }
  // Dynamic app ID getter for validating incoming messages
  getCurrentAppId?: () => string | null
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
      onSocketReady: (socket) => {
        this.handleSocketReady(socket)
      },
      onConnect: (params) => this.handleConnectionEstablished(params),
      onAuthenticated: (params) => this.handleAuthenticated(params),
      onAuthFailed: (error) => this.handleAuthFailed(error),
      onConnectionFailed: (error) => this.handleConnectionFailed(error),
      onConnectError: (error) => this.handleConnectError(error),
      onConnectionPhases: (phases) => this.deps.qualityMonitor?.setConnectionPhases(phases),
      onDisconnect: (params) => this.handleDisconnect(params),
      onReconnectAttempt: (params) => this.handleReconnectAttempt(params),
      onReconnect: (params) => this.handleReconnect(params),
      onReconnectError: (params) => this.handleReconnectError(params),
      onReconnectFailed: (params) => this.handleReconnectFailed(params),
    }

    // Share server config ref so ConnectionManager can read capability flags and timeouts
    this.deps.connectionManager.setServerConfigRef(this.deps.refs.serverConfig)

    await this.deps.connectionManager.connect(appId, callbacks)
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    this.clearEscalationTimeout()
    if (this.socket) {
      this.deps.qualityMonitor?.detachFromSocket(this.socket)
    }
    this.deps.connectionManager.disconnect()
    this.socket = null
    this.deps.refs.pendingRecoveryAck.current = null
  }

  /**
   * Get current socket for direct access
   */
  getSocket(): Socket | null {
    return this.socket
  }

  /**
   * Emit grant context to the agent
   * Used by grant synchronization to send grants without exposing raw socket
   */
  emitGrantContext(payload: { grants: unknown[]; timestamp: number }): boolean {
    if (!this.socket?.connected) return false
    this.socket.emit('grant_context', payload)
    return true
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

  private handleSocketReady(socket: Socket): void {
    this.socket = socket

    if (!this.socketsWithHandlers.has(socket)) {
      this.setupEventHandlers(socket)
      this.socketsWithHandlers.add(socket)
    }
  }

  private handleConnectionEstablished({ socket, recovered }: { socket: Socket; recovered: boolean }): void {
    // Send CONNECTION_ESTABLISHED event to machine
    this.deps.machine.send({ type: 'CONNECTION_ESTABLISHED', socketId: socket.id })

    // Quality monitoring: log slow connects and attach engine listeners
    this.deps.qualityMonitor?.markConnectEstablished(socket.id)
    if (this.currentAppId) {
      this.deps.qualityMonitor?.attachToSocket(socket, this.currentAppId)
    }

    // Log connection establishment with transport details
    const transportName = socket.io?.engine?.transport?.name
    logger.info('websocket.connection.established', {
      appId: this.currentAppId,
      socketId: socket.id,
      recovered,
      ...(transportName && { transport: transportName }),
    })

    this.emit('connection:established', { socket, recovered })
  }

  private handleAuthenticated({ socket }: { socket: Socket }): void {
    this.deps.machine.send({ type: 'AUTH_SUCCESS', socketId: socket.id })

    logger.info('websocket.auth.success', {
      appId: this.currentAppId,
      socketId: socket.id,
    })
  }

  private handleAuthFailed(error: Error): void {
    logger.error('websocket.auth.failed', {
      appId: this.currentAppId,
      errorMessage: error.message,
      errorName: error.name,
      errorStack: error.stack,
    })

    this.deps.machine.send({ type: 'AUTH_FAILED', error })
  }

  private handleConnectionFailed(error: Error): void {
    logger.error('websocket.connection.init_failed', {
      message: 'Failed to initialize persistent connection',
      appId: this.currentAppId,
      errorMessage: error?.message ?? 'Unknown error',
      errorName: error?.name,
      errorStack: error?.stack,
    })

    this.deps.machine.send({ type: 'CONNECTION_FAILED', error })

    this.emit('connection:failed', { error })
  }

  private handleConnectError(error: Error): void {
    const errorData: Record<string, unknown> = {
      appId: this.currentAppId,
      message: error.message,
      errorName: error.name,
      errorType: error.constructor.name,
      errorStack: error.stack,
    }

    // Capture Socket.IO-specific error properties if they exist
    // Socket.IO can attach additional fields like 'type', 'description', 'context'
    if ('type' in error && typeof error.type === 'string') {
      errorData.socketIoType = error.type
    }
    if ('description' in error && error.description) {
      errorData.description = error.description
    }
    if ('context' in error && error.context) {
      // Safely serialize context to avoid JSON.stringify issues
      try {
        errorData.context = typeof error.context === 'object'
          ? JSON.parse(JSON.stringify(error.context))
          : error.context
      } catch {
        errorData.context = String(error.context)
      }
    }

    logger.error('websocket.connect.error', errorData)

    this.emit('connection:error', { error })
  }

  private handleDisconnect({ reason, socket, description }: { reason: Socket.DisconnectReason; socket: Socket; description?: DisconnectDescription }): void {
    this.deps.refs.pendingRecoveryAck.current = null

    // Send DISCONNECT event to machine (machine action will log it)
    this.deps.machine.send({ type: 'DISCONNECT', reason: reason || 'unknown' })

    const { streamingState, activeStream } = this.deps.getStreamingState()
    const isStreaming =
      streamingState === 'streaming' || streamingState === 'retrying' || activeStream !== null

    // Emit event for adapter/controller to handle retry tracking
    if (isStreaming) {
      this.emit('transport:retry-started', { socketId: socket.id })

      // Set escalation timeout
      this.escalationTimeoutId = setTimeout(() => {
        logger.warn('websocket.escalation.timeout-fired', {
          socketId: socket.id,
        })

        this.deps.machine.send({
          type: 'STREAM_ERROR',
          error: new Error('Connection lost - retry timeout exceeded'),
          retryable: false,
        })
        this.emit('transport:escalation-timeout', { socketId: socket.id })
      }, this.deps.refs.serverConfig.current?.streamRecoveryWindow ?? CONNECTION_RETRY_TIMEOUT_MS)
    }

    this.emit('disconnect', { reason, socket, wasStreaming: isStreaming, description })
  }

  private handleReconnectAttempt({ socket, attempt }: { socket: Socket; attempt: number }): void {
    logger.info('websocket.reconnect.attempt', {
      appId: this.currentAppId,
      socketId: socket.id,
      attemptNumber: attempt,
    })

    this.emit('reconnect:attempt', { socket })
  }

  private handleReconnect({ socket, attempt }: { socket: Socket; attempt: number }): void {
    this.clearEscalationTimeout()

    const transportName = socket.io?.engine?.transport?.name
    logger.info('websocket.reconnect.success', {
      appId: this.currentAppId,
      socketId: socket.id,
      attemptNumber: attempt,
      ...(transportName && { transport: transportName }),
    })

    this.emit('reconnect:success', { socket })
  }

  private handleReconnectError({ socket, error }: { socket: Socket; error: Error }): void {
    logger.warn('websocket.reconnect.error', {
      appId: this.currentAppId,
      socketId: socket.id,
      errorMessage: error.message,
      errorName: error.name,
      errorStack: error.stack,
    })
    this.emit('reconnect:error', { error })
  }

  private handleReconnectFailed({ socket }: { socket: Socket }): void {
    this.clearEscalationTimeout()

    const { streamingState, activeStream } = this.deps.getStreamingState()
    const isStreaming =
      streamingState === 'streaming' || streamingState === 'retrying' || activeStream !== null

    logger.error('websocket.reconnect.failed', {
      appId: this.currentAppId,
      socketId: socket.id,
      wasStreaming: isStreaming,
    })

    if (isStreaming && activeStream) {
      this.deps.machine.send({
        type: 'STREAM_ERROR',
        error: new Error('Failed to reconnect after multiple attempts'),
        retryable: false,
      })
    }

    this.emit('reconnect:failed', { socket, wasStreaming: isStreaming })
  }

  private setupEventHandlers(socket: Socket): void {
    const registry = new MessageHandlerRegistry()

    registry.register(new AgentsAvailableHandler())
    registry.register(new ServerConfigHandler())
    registry.register(new ConversationInfoHandler())
    registry.register(new RecoveryStatusHandler())
    registry.register(new HistoryMessageHandler())
    registry.register(new HistoryLoadedHandler())
    registry.register(new HistoryCompleteHandler())
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
    registry.register(new StreamRetryHandler())
    registry.register(new CompleteHandler())
    registry.register(new ErrorHandler())
    registry.register(new ClientActionHandler())
    registry.register(new ValidationMessageHandler())
    registry.register(new VideoHandler())
    registry.register(new BuildPhaseHandler())
    registry.register(new LogoHandler())

    const messageContext: MessageContext = {
      socket,
      currentAppId: this.deps.getCurrentAppId?.() ?? this.currentAppId,
      actions: this.deps.getActions(),
      helpers: {
        ...this.deps.getHelpers(),
        maybeSendRecoveryAck: (socket, force) => this.maybeSendRecoveryAck(socket, force),
        trackReplayEventReceipt: (socket, eventType) => this.trackReplayEventReceipt(socket, eventType),
        clearRetryState: () => this.clearRetryState(),
      },
      refs: this.deps.refs,
      machine: this.deps.machine,
      t: this.deps.t ?? ((id: string) => id),
      // WS reverse channel for the transport-agnostic timeout-reset signal.
      // Mirrors how client_action results are emitted back on this same socket.
      // Sends only requestId — the agent reuses the action's original timeout.
      resetActionTimeout: (requestId: string) =>
        socket.emit('client_action_reset_timeout', { requestId }),
    };

    socket.on('status', (data) => {
      if (data.data?.status === 'thinking') {
        logger.debug('websocket.status.thinking', {
          appId: messageContext.currentAppId,
        });
      }
    });

    // Grant refresh requests from agent
    socket.on('request_grant_refresh', () => {
      logger.info('websocket.grant.refresh_requested', {
        appId: messageContext.currentAppId,
      });
      this.emit('grant:refresh-requested');
    });

    // Budget update events from agent
    socket.on('budget_update', (data: BudgetUpdatePayload) => {
      logger.info('websocket.budget.update_received', {
        appId: messageContext.currentAppId,
        refreshRequired: data.refreshRequired,
      });
      this.emit('budget:update', data);
    });

    // OAuth result from the agents service. Normalized into a window
    // CustomEvent so listeners work the same under WS and SSE transports.
    // SSETransport dispatches the same event for the SSE path.
    socket.on('oauth:result', (data: Record<string, unknown>) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('oauth:result', { detail: data }))
      }
    })

    // Debug turn stats — bridged to React via window CustomEvent so the
    // DebugStatsDrawer can consume them without coupling to this supervisor.
    socket.on(DEBUG_TURN_STATS_EVENT, (data: DebugTurnStatsEvent) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('airo:debug-turn-stats', { detail: data }))
      }
    })

    socket.on('message', async (data: { type: string; content: string; data?: any }, ack?: () => void) => {
      if (data.data?.conversationId && messageContext.currentAppId && typeof data.data.conversationId === 'string') {
        setConversationIdCookie(messageContext.currentAppId, data.data.conversationId)
      }

      // Event deduplication during recovery replay
      // Generate event key from sequence number or fallback to type:messageId
      const controller = this.deps.refs.controller
      if (controller?.isInReplayMode()) {
        const eventKey = data.data?.sequence !== undefined
          ? `seq:${data.data.sequence}`
          : data.data?.messageId
            ? `${data.type}:${data.data.messageId}`
            : undefined

        if (eventKey && controller.hasSeenEvent(eventKey)) {
          logger.debug('websocket.transport.duplicate_event_skipped', {
            eventType: data.type,
            eventKey,
            sequence: data.data?.sequence,
            messageId: data.data?.messageId
          })
          return // Skip duplicate event
        }

        // Mark as seen before processing
        if (eventKey) {
          controller.markEventSeen(eventKey)
        }
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

    // Notify the state machine that the recovery ack was sent so it can exit
    // transport.connected.recovering.sendingAck → transport.connected.idle.
    if (pending.ackEvent === 'recovery_ack') {
      this.deps.machine.send({ type: 'RECOVERY_ACK_SENT' })
    }

    this.deps.refs.pendingRecoveryAck.current = null
  }

  private trackReplayEventReceipt(socket: Socket | null, eventType: string): void {
    const pending = this.deps.refs.pendingRecoveryAck.current;
    if (!pending || !socket) return;

    // Skip recovery control messages - they don't count toward replay
    if (RECOVERY_CONTROL_MESSAGE_TYPES.includes(eventType as typeof RECOVERY_CONTROL_MESSAGE_TYPES[number])) {
      return;
    }

    pending.receivedCount++;
    this.deps.machine.send({ type: 'REPLAY_EVENT_RECEIVED' })
    this.maybeSendRecoveryAck(socket);
  }

  private clearEscalationTimeout(): void {
    if (this.escalationTimeoutId) {
      clearTimeout(this.escalationTimeoutId)
      this.escalationTimeoutId = null
    }
  }
}
