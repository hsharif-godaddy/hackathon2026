import type { Socket } from 'socket.io'
import type { StreamingEvent } from './interfaces.js'
import type { ConversationEventChannel } from './conversation-event-channel.js'
import type { ConnectionStateManager, ConnectionStateData } from './connection-state-manager.js'
import { WebSocketSubscriber } from './subscribers/websocket-subscriber.js'
import { createLogger } from '../utils/logger.js'

/**
 * Recovery modes for connection recovery
 */
export type RecoveryMode = 'automatic' | 'manual' | 'conversation'

/**
 * Context for a recovery operation
 */
export interface RecoveryContext {
  mode: RecoveryMode
  newSocketId: string
  oldSocketId: string
  conversationId: string
  lastDeliveredSequence: number
  abortController: AbortController
  agentName?: string
}

/**
 * WebSocket message format for recovery events
 */
interface WebSocketMessage {
  type: string
  content: string
  data: Record<string, unknown>
}

/**
 * Configuration for ConnectionRecoveryManager
 */
export interface ConnectionRecoveryManagerConfig {
  ackTimeout: number
  recoveryWindow: number
  apmAgent?: any
}

/**
 * Logger interface for recovery manager
 */
export interface RecoveryManagerLogger {
  debug(event: string, data: Record<string, unknown>): void
  info(event: string, data: Record<string, unknown>): void
  warn(event: string, data: Record<string, unknown>): void
  error(event: string, data: Record<string, unknown>): void
}

/**
 * Dependencies for ConnectionRecoveryManager
 */
export interface ConnectionRecoveryManagerDependencies {
  stateManager: ConnectionStateManager
  eventChannel: ConversationEventChannel
  logger?: RecoveryManagerLogger
}

/**
 * Handles all connection recovery scenarios for WebSocket connections
 *
 * Extracts recovery logic from WebSocketServer to reduce complexity:
 * - Automatic recovery (Socket.IO CSR)
 * - Manual recovery (previousSocketId from sessionStorage)
 * - Conversation-based recovery (conversationId cookie)
 * - Catch-up handshake for events arriving during ACK wait
 */
export class ConnectionRecoveryManager {
  private readonly stateManager: ConnectionStateManager
  private readonly eventChannel: ConversationEventChannel
  private readonly config: ConnectionRecoveryManagerConfig
  private readonly logger: RecoveryManagerLogger

  constructor(
    dependencies: ConnectionRecoveryManagerDependencies,
    config: ConnectionRecoveryManagerConfig
  ) {
    this.stateManager = dependencies.stateManager
    this.eventChannel = dependencies.eventChannel
    this.config = config
    this.logger = dependencies.logger ?? createLogger('recovery')
  }

  // ===== Public Recovery Methods =====

  /**
   * Attempt recovery for a new connection
   * Returns true if recovery was initiated, false if fresh connection
   */
  attemptRecovery(socket: Socket): RecoveryMode | null {
    const socketId = socket.id
    const auth = socket.handshake.auth || {}
    const previousSocketId = auth.previousSocketId

    // Check automatic recovery (Socket.IO CSR)
    if (socket.recovered && this.stateManager.isDisconnected(socketId)) {
      return 'automatic'
    }

    // Check manual recovery (previousSocketId in auth)
    if (previousSocketId && this.stateManager.isDisconnected(previousSocketId)) {
      return 'manual'
    }

    // Check conversation-based recovery (conversationId cookie)
    if (auth.conversationId && !previousSocketId) {
      const entry = this.stateManager.findDisconnectedByConversationId(auth.conversationId)
      if (entry) {
        return 'conversation'
      }
    }

    return null
  }

  /**
   * Handle automatic recovery (Socket.IO built-in CSR)
   */
  async handleAutomaticRecovery(
    socket: Socket,
    callbacks: {
      onRecoveryComplete: (socketId: string, events: StreamingEvent[], finalSequence: number) => void
      onRecoveryFailed: (socketId: string, reason: string) => void
      createWebSocketSubscriber: (socket: Socket) => WebSocketSubscriber
    }
  ): Promise<void> {
    const socketId = socket.id
    const stateData = this.stateManager.getStateData(socketId)

    if (!stateData || stateData.state !== 'disconnected') {
      this.logger.warn('recovery.automatic.no_stream_data', { socketId })
      return
    }

    this.logger.info('recovery.automatic.started', {
      socketId,
      conversationId: stateData.conversationId
    })

    // Cancel the original abort timeout
    if (stateData.recoveryTimeoutId) {
      clearTimeout(stateData.recoveryTimeoutId)
      this.stateManager.updateConnection(socketId, { recoveryTimeoutId: null })
    }

    const context: RecoveryContext = {
      mode: 'automatic',
      newSocketId: socketId,
      oldSocketId: socketId, // Same for automatic recovery
      conversationId: stateData.conversationId,
      lastDeliveredSequence: stateData.lastDeliveredSequence,
      abortController: stateData.abortController!
    }

    await this.executeRecoveryFlow(socket, context, stateData, callbacks)
  }

  /**
   * Handle manual recovery (previousSocketId from sessionStorage)
   */
  async handleManualRecovery(
    socket: Socket,
    previousSocketId: string,
    callbacks: {
      onRecoveryComplete: (socketId: string, events: StreamingEvent[], finalSequence: number) => void
      onRecoveryFailed: (socketId: string, reason: string) => void
      createWebSocketSubscriber: (socket: Socket) => WebSocketSubscriber
    }
  ): Promise<void> {
    const socketId = socket.id
    const stateData = this.stateManager.getStateData(previousSocketId)

    if (!stateData || stateData.state !== 'disconnected') {
      this.logger.warn('recovery.manual.no_stream_data', {
        socketId,
        previousSocketId
      })
      return
    }

    this.logger.info('recovery.manual.started', {
      socketId,
      previousSocketId,
      conversationId: stateData.conversationId
    })

    // Cancel the abort timeout
    if (stateData.recoveryTimeoutId) {
      clearTimeout(stateData.recoveryTimeoutId)
      this.stateManager.updateConnection(previousSocketId, { recoveryTimeoutId: null })
    }

    const context: RecoveryContext = {
      mode: 'manual',
      newSocketId: socketId,
      oldSocketId: previousSocketId,
      conversationId: stateData.conversationId,
      lastDeliveredSequence: stateData.lastDeliveredSequence,
      abortController: stateData.abortController!
    }

    await this.executeRecoveryFlow(socket, context, stateData, callbacks)
  }

  /**
   * Handle conversation-based recovery (conversationId cookie)
   */
  async handleConversationRecovery(
    socket: Socket,
    conversationId: string,
    validateAppId: (conversationId: string, auth: Record<string, unknown>) => boolean,
    callbacks: {
      onRecoveryComplete: (socketId: string, events: StreamingEvent[], finalSequence: number) => void
      onRecoveryFailed: (socketId: string, reason: string) => void
      createWebSocketSubscriber: (socket: Socket) => WebSocketSubscriber
    }
  ): Promise<void> {
    const socketId = socket.id
    const auth = socket.handshake.auth || {}

    // Find disconnected stream by conversationId
    const entry = this.stateManager.findDisconnectedByConversationId(conversationId)

    if (!entry) {
      this.logger.warn('recovery.conversation.no_stream_found', {
        socketId,
        conversationId
      })
      this.sendStreamCompletedStatus(socket)
      return
    }

    const [oldSocketId, stateData] = entry

    // Security validation
    if (!validateAppId(conversationId, auth)) {
      this.logger.warn('recovery.conversation.app_mismatch', {
        socketId,
        conversationId
      })
      this.sendStreamCompletedStatus(socket)
      return
    }

    this.logger.info('recovery.conversation.started', {
      socketId,
      oldSocketId,
      conversationId
    })

    // Cancel the abort timeout
    if (stateData.recoveryTimeoutId) {
      clearTimeout(stateData.recoveryTimeoutId)
      this.stateManager.updateConnection(oldSocketId, { recoveryTimeoutId: null })
    }

    const context: RecoveryContext = {
      mode: 'conversation',
      newSocketId: socketId,
      oldSocketId,
      conversationId,
      lastDeliveredSequence: stateData.lastDeliveredSequence,
      abortController: stateData.abortController!
    }

    await this.executeRecoveryFlow(socket, context, stateData, callbacks)
  }

  /**
   * Send "stream completed" message when recovery attempted but no buffered events
   */
  sendStreamCompletedStatus(socket: Socket): void {
    socket.emit('message', {
      type: 'recovery_status',
      content: '',
      data: {
        isRecovering: true,
        hasBufferedEvents: false,
        bufferedEventCount: 0,
        streamCompleted: true
      }
    } as WebSocketMessage)
  }

  // ===== Private Recovery Flow =====

  /**
   * Execute the recovery flow (shared across all recovery modes)
   */
  private async executeRecoveryFlow(
    socket: Socket,
    context: RecoveryContext,
    stateData: ConnectionStateData,
    callbacks: {
      onRecoveryComplete: (socketId: string, events: StreamingEvent[], finalSequence: number) => void
      onRecoveryFailed: (socketId: string, reason: string) => void
      createWebSocketSubscriber: (socket: Socket) => WebSocketSubscriber
    }
  ): Promise<void> {
    const preReplaySequence = context.lastDeliveredSequence

    // Get events to replay
    const events = this.eventChannel.getEventsSince(
      context.conversationId,
      context.lastDeliveredSequence
    )

    // Check for buffer loss
    const expectedNextSequence = context.lastDeliveredSequence + 1
    const { lossDetected, lostEventCount } = this.getBufferLossInfo(
      context.conversationId,
      expectedNextSequence
    )

    if (lossDetected) {
      this.logger.warn('recovery.buffer_loss_detected', {
        socketId: context.newSocketId,
        conversationId: context.conversationId,
        lostEventCount
      })
    }

    const replayLastSequence = events.length > 0
      ? events[events.length - 1]!.sequence
      : preReplaySequence

    // Send recovery status (use stateData parameter for agent name)
    socket.emit('message', {
      type: 'recovery_status',
      content: 'Recovering connection...',
      data: {
        isRecovering: true,
        hasBufferedEvents: events.length > 0,
        bufferedEventCount: events.length,
        conversationId: context.conversationId,
        agentName: stateData?.agentName ?? context.agentName,
        recoveryMode: context.mode,
        requiresAck: true,
        lastSequence: replayLastSequence,
        lossDetected,
        lostEventCount
      }
    } as WebSocketMessage)

    // Replay events
    for (const event of events) {
      socket.emit('message', {
        type: event.type,
        content: event.content,
        data: event.data
      } as WebSocketMessage)
    }

    // Send replay complete
    socket.emit('message', {
      type: 'replay_complete',
      content: 'All buffered events replayed',
      data: {
        lastSequence: replayLastSequence,
        conversationId: context.conversationId,
        eventsReplayed: events.length
      }
    } as WebSocketMessage)

    // Set up ACK handling
    await this.setupRecoveryAckHandling(
      socket,
      context,
      preReplaySequence,
      events,
      callbacks
    )
  }

  /**
   * Set up ACK timeout and listener for recovery acknowledgment
   */
  private async setupRecoveryAckHandling(
    socket: Socket,
    context: RecoveryContext,
    preReplaySequence: number,
    replayedEvents: StreamingEvent[],
    callbacks: {
      onRecoveryComplete: (socketId: string, events: StreamingEvent[], finalSequence: number) => void
      onRecoveryFailed: (socketId: string, reason: string) => void
      createWebSocketSubscriber: (socket: Socket) => WebSocketSubscriber
    }
  ): Promise<void> {
    let handleRecoveryAck: ((ackData: { conversationId: string; lastSequence: number }) => void) | null = null

    const handleAckTimeout = () => {
      // Remove listener first to prevent firing after cleanup
      if (handleRecoveryAck) {
        socket.off('recovery_ack', handleRecoveryAck)
      }

      this.logger.warn('recovery.ack_timeout', {
        socketId: context.newSocketId,
        oldSocketId: context.oldSocketId,
        recoveryMode: context.mode,
        timeout: this.config.ackTimeout
      })

      // Cleanup and abort
      this.cleanupAfterRecoveryFailure(context)
      callbacks.onRecoveryFailed(context.newSocketId, 'ack_timeout')
    }

    const ackTimeoutId = setTimeout(handleAckTimeout, this.config.ackTimeout)

    // Update state with new timeout
    this.stateManager.updateConnection(context.oldSocketId, {
      recoveryTimeoutId: ackTimeoutId,
      lastDeliveredSequence: preReplaySequence
    })

    const finalizeRecovery = (finalSequence: number, catchUpCount = 0) => {
      // Transition state
      if (context.mode !== 'automatic') {
        // For manual/conversation recovery, migrate socket ID
        this.stateManager.migrateSocketId(context.oldSocketId, context.newSocketId)
      }

      this.stateManager.transitionTo(context.newSocketId, 'connected', {
        lastDeliveredSequence: finalSequence,
        recoveryTimeoutId: undefined // Clear the recovery timeout
      })

      // Re-subscribe WebSocket subscriber with new socket
      this.eventChannel.unsubscribe(context.conversationId, `websocket-${context.oldSocketId}`)
      this.eventChannel.subscribe(
        context.conversationId,
        callbacks.createWebSocketSubscriber(socket)
      )

      // Send recovery complete status
      socket.emit('message', {
        type: 'recovery_status',
        content: 'Connection restored',
        data: {
          isRecovering: false,
          eventsReplayed: replayedEvents.length + catchUpCount,
          streamStatus: 'active'
        }
      } as WebSocketMessage)

      // Note: We intentionally do NOT call onDisconnection here.
      // The disconnect handler already called it when the socket dropped.
      // Calling it again after successful recovery would cause duplicate
      // telemetry, double cleanup of session maps, and misleading audit logs.

      this.logger.info('recovery.complete', {
        socketId: context.newSocketId,
        oldSocketId: context.oldSocketId,
        mode: context.mode,
        eventsReplayed: replayedEvents.length + catchUpCount,
        fromSequence: preReplaySequence,
        toSequence: finalSequence
      })

      callbacks.onRecoveryComplete(context.newSocketId, replayedEvents, finalSequence)
    }

    handleRecoveryAck = (ackData: { conversationId: string; lastSequence: number }) => {
      if (ackData.conversationId !== context.conversationId) {
        this.logger.warn('recovery.ack_mismatch', {
          socketId: context.newSocketId,
          expectedConversationId: context.conversationId,
          receivedConversationId: ackData.conversationId
        })
        return
      }

      clearTimeout(ackTimeoutId)

      this.logger.info('recovery.ack_received', {
        socketId: context.newSocketId,
        oldSocketId: context.oldSocketId,
        lastSequence: ackData.lastSequence
      })

      // Check for catch-up events (arrived during ACK wait)
      const catchUpEvents = this.eventChannel.getEventsSince(
        context.conversationId,
        ackData.lastSequence
      )

      if (catchUpEvents.length === 0) {
        finalizeRecovery(ackData.lastSequence)
        return
      }

      // Begin catch-up handshake
      this.beginCatchUpHandshake(socket, {
        conversationId: context.conversationId,
        events: catchUpEvents,
        onComplete: (finalSequence) => finalizeRecovery(finalSequence, catchUpEvents.length),
        onTimeout: () => {
          this.cleanupAfterRecoveryFailure(context)
          callbacks.onRecoveryFailed(context.newSocketId, 'catchup_timeout')
        }
      })
    }

    socket.once('recovery_ack', handleRecoveryAck)
  }

  // ===== Helper Methods =====

  /**
   * Begin catch-up handshake for events that arrived during ACK wait
   */
  beginCatchUpHandshake(
    socket: Socket,
    params: {
      conversationId: string
      events: StreamingEvent[]
      onComplete: (finalSequence: number) => void
      onTimeout: () => void
    }
  ): void {
    const { conversationId, events, onComplete, onTimeout } = params
    const finalSequence = events[events.length - 1]!.sequence

    // Send catchup status
    socket.emit('message', {
      type: 'catchup_status',
      content: 'Delivering queued events',
      data: {
        conversationId,
        pendingCount: events.length,
        lastSequence: finalSequence,
        requiresAck: true
      }
    } as WebSocketMessage)

    // Replay catch-up events
    for (const event of events) {
      socket.emit('message', {
        type: event.type,
        content: event.content,
        data: event.data
      } as WebSocketMessage)
    }

    // Send catchup complete
    socket.emit('message', {
      type: 'catchup_complete',
      content: 'Catch-up events sent',
      data: {
        conversationId,
        eventsReplayed: events.length,
        lastSequence: finalSequence
      }
    } as WebSocketMessage)

    // Set up listeners
    const cleanupListeners = (handler: (...args: any[]) => void, timeoutId: NodeJS.Timeout) => {
      socket.off('catchup_ack', handler)
      socket.off('disconnect', handleDisconnect)
      clearTimeout(timeoutId)
    }

    const handleTimeout = () => {
      cleanupListeners(handleCatchUpAck, timeoutId)
      onTimeout()
    }

    const timeoutId = setTimeout(handleTimeout, this.config.ackTimeout)

    const handleCatchUpAck = (ackData: { conversationId: string; lastSequence: number }) => {
      if (ackData.conversationId !== conversationId) {
        this.logger.warn('recovery.catchup.ack_mismatch', {
          expectedConversationId: conversationId,
          receivedConversationId: ackData.conversationId
        })
        return
      }
      cleanupListeners(handleCatchUpAck, timeoutId)
      onComplete(ackData.lastSequence ?? finalSequence)
    }

    const handleDisconnect = () => {
      cleanupListeners(handleCatchUpAck, timeoutId)
      onTimeout()
    }

    socket.once('catchup_ack', handleCatchUpAck)
    socket.once('disconnect', handleDisconnect)
  }

  /**
   * Get buffer loss information
   */
  getBufferLossInfo(
    conversationId: string,
    expectedNextSequence: number
  ): { lossDetected: boolean; lostEventCount: number } {
    const metadata = this.eventChannel.getMetadata(conversationId)
    if (!metadata) {
      return { lossDetected: false, lostEventCount: 0 }
    }

    const missingEvents = metadata.firstSequence - expectedNextSequence
    if (missingEvents > 0) {
      return { lossDetected: true, lostEventCount: missingEvents }
    }

    return { lossDetected: false, lostEventCount: 0 }
  }

  /**
   * Clean up after recovery failure
   */
  private cleanupAfterRecoveryFailure(context: RecoveryContext): void {
    // Abort the stream
    context.abortController.abort()

    // Clean up event channel subscribers
    this.cleanupEventChannelSubscribers(context.oldSocketId, context.conversationId)

    // Clean up state (includes clearing timeouts)
    this.stateManager.cleanup(context.oldSocketId).catch((err) => {
      this.logger.error('recovery.cleanup_failed', {
        socketId: context.oldSocketId,
        error: err instanceof Error ? err.message : String(err)
      })
    })
  }

  /**
   * Clean up event channel subscribers for a conversation
   */
  cleanupEventChannelSubscribers(
    originalSocketId: string,
    conversationId: string
  ): void {
    // WebSocket subscriber migrates with socket - use effective ID
    const effectiveSocketId = this.stateManager.getEffectiveSocketId(originalSocketId)
    this.eventChannel.unsubscribe(conversationId, `websocket-${effectiveSocketId}`)

    // Persistence and APM subscribers stay with original socket ID
    this.eventChannel.unsubscribe(conversationId, `persistence-${originalSocketId}`)
    if (this.config.apmAgent) {
      this.eventChannel.unsubscribe(conversationId, `apm-${originalSocketId}`)
    }
  }
}
