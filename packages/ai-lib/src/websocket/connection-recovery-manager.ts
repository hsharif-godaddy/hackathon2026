import type { Socket } from 'socket.io'
import type {
  StreamingEvent,
  HistoryProvider,
  PersistedMessage,
  ConversationContext,
  EventMetadata
} from './interfaces.js'
import type { ConversationEventChannel } from './conversation-event-channel.js'
import type { ConnectionStateManager, ConnectionStateData } from './connection-state-manager.js'
import { WebSocketSubscriber } from './subscribers/websocket-subscriber.js'
import { createLogger } from '../utils/logger.js'

/**
 * Default agent name used when no agent is specified
 * Used for initial recovery when agent context doesn't exist yet
 */
const DEFAULT_AGENT_NAME = 'develop'

/**
 * Helper to safely extract appId from auth object
 * Auth can have appId in various locations depending on auth mode:
 * - Direct: auth.appId (most common)
 * - AgentContext: auth.agentContext.appId (JWT auth)
 * - Decoded: auth.decoded.appId (JWT auth fallback)
 */
function extractAppId(auth: unknown): string | undefined {
  if (!auth || typeof auth !== 'object') {
    return undefined
  }
  const authRecord = auth as Record<string, unknown>

  // Try direct appId first (most common)
  if (typeof authRecord.appId === 'string') {
    return authRecord.appId
  }

  // Try agentContext.appId (JWT auth)
  const agentContext = authRecord.agentContext as Record<string, unknown> | undefined
  if (agentContext && typeof agentContext.appId === 'string') {
    return agentContext.appId
  }

  // Try decoded.appId (JWT auth fallback)
  const decoded = authRecord.decoded as Record<string, unknown> | undefined
  if (decoded && typeof decoded.appId === 'string') {
    return decoded.appId
  }

  return undefined
}

/**
 * Recovery modes for connection recovery
 */
export type RecoveryMode = 'automatic' | 'manual' | 'conversation' | 'initial'

/**
 * Context for a recovery operation
 */
export interface RecoveryContext {
  mode: RecoveryMode
  newSocketId: string
  oldSocketId: string
  conversationId: string
  lastDeliveredSequence: number
  abortController: AbortController | null
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
  historyProvider?: HistoryProvider
  getLatestConversationForApp?: (appId: string) => Promise<string | null>
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
  private readonly historyProvider?: HistoryProvider
  private readonly getLatestConversationForApp?: (appId: string) => Promise<string | null>

  constructor(
    dependencies: ConnectionRecoveryManagerDependencies,
    config: ConnectionRecoveryManagerConfig
  ) {
    this.stateManager = dependencies.stateManager
    this.eventChannel = dependencies.eventChannel
    this.config = config
    this.logger = dependencies.logger ?? createLogger('recovery')
    if (dependencies.historyProvider) {
      this.historyProvider = dependencies.historyProvider
    }
    if (dependencies.getLatestConversationForApp) {
      this.getLatestConversationForApp = dependencies.getLatestConversationForApp
    }
  }

  // ===== Public Recovery Methods =====

  /**
   * Attempt recovery for a new connection
   * Returns recovery mode if recovery should be attempted, null for fresh connection
   */
  async attemptRecovery(socket: Socket): Promise<RecoveryMode | null> {
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
    if (auth.conversationId) {
      const entry = this.stateManager.findDisconnectedByConversationId(auth.conversationId)

      // If state exists in memory and no previousSocketId, use conversation recovery
      if (entry && !previousSocketId) {
        return 'conversation'  // State exists in memory
      }

      // If state exists but previousSocketId was provided, prefer manual recovery
      // (already handled above, this is just documentation)

      // No disconnected state (or previousSocketId state expired)
      // Trigger initial recovery to load persisted history from database
      // This handles:
      // 1. Initial connection with existing conversationId
      // 2. Page reload after recovery window expired (previousSocketId + conversationId but no state)
      if (!entry || (previousSocketId && !this.stateManager.isDisconnected(previousSocketId))) {
        return 'initial'
      }
    }

    // Cookie-less recovery: try to find latest conversation for app
    // This handles when user loses cookie but app has conversation history
    if (!auth.conversationId && this.getLatestConversationForApp) {
      const appId = extractAppId(auth)
      if (appId) {
        const latestConversationId = await this.getLatestConversationForApp(appId)
        if (latestConversationId) {
          // Store resolved conversationId in auth for handleInitialRecovery
          auth.conversationId = latestConversationId
          this.logger.info('recovery.cookie_less.resolved', {
            socketId,
            appId,
            conversationId: latestConversationId
          })
          return 'initial'
        }
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
      abortController: stateData.abortController
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
      abortController: stateData.abortController
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

    // Extract appId from auth for sendStreamCompletedStatus
    const appId = extractAppId(auth)

    if (!entry) {
      this.logger.warn('recovery.conversation.no_stream_found', {
        socketId,
        conversationId
      })
      await this.sendStreamCompletedStatus(socket, conversationId, appId)
      return
    }

    const [oldSocketId, stateData] = entry

    // Security validation
    if (!validateAppId(conversationId, auth)) {
      this.logger.warn('recovery.conversation.app_mismatch', {
        socketId,
        conversationId
      })
      await this.sendStreamCompletedStatus(socket, conversationId, appId)
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
      abortController: stateData.abortController
    }

    await this.executeRecoveryFlow(socket, context, stateData, callbacks)
  }

  /**
   * Handle initial recovery (conversationId exists but no previous socket state)
   * Triggered on: initial load with existing conversation OR page reload after recovery window
   */
  async handleInitialRecovery(
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

    // Extract appId for history loading (needed for sendStreamCompletedStatus on validation failure)
    const appId = extractAppId(auth)

    // Security validation
    if (!validateAppId(conversationId, auth)) {
      this.logger.warn('recovery.initial.app_mismatch', {
        socketId,
        conversationId
      })
      // Send stream completed status to unblock client initialization
      // Even though validation failed, we still send history_complete to prevent hanging
      await this.sendStreamCompletedStatus(socket, conversationId, appId)
      return
    }

    this.logger.info('recovery.initial.started', {
      socketId,
      conversationId
    })

    // Determine lastDeliveredSequence based on event buffer state
    // ConnectionStateManager treats -1 as "no events delivered yet"
    // Use actual buffer watermark, not sentinel values that break future recoveries
    const metadata = this.eventChannel.getMetadata(conversationId)
    const lastDeliveredSequence = metadata?.lastSequence ?? -1

    if (!metadata || metadata.totalEvents === 0) {
      // No buffered events - all messages are complete and persisted
      // Use -1 to indicate "replay all" (getEventsSince handles negative sentinels)
      this.logger.debug('recovery.initial.no_buffered_events', {
        socketId,
        conversationId,
        hasMetadata: !!metadata,
        lastDeliveredSequence
      })
    } else {
      // Buffered events exist - use actual lastSequence from buffer
      // This ensures subsequent recoveries have a real watermark
      this.logger.debug('recovery.initial.has_buffered_events', {
        socketId,
        conversationId,
        bufferedEventCount: metadata.totalEvents,
        firstSequence: metadata.firstSequence,
        lastSequence: metadata.lastSequence,
        lastDeliveredSequence
      })
    }

    // appId already extracted above for validation failure handling

    const abortController = new AbortController()

    // Create full state data
    // ConnectionStateData has no index signature - must provide all required fields
    const conversationContext: ConversationContext = {
      socketId,
      agentName: DEFAULT_AGENT_NAME,
      ...auth,  // Include auth data
      ...(appId && { appId })  // Only include appId if it exists
    }

    const stateData: ConnectionStateData = {
      conversationId,
      agentName: DEFAULT_AGENT_NAME,
      context: conversationContext,
      streamingEvents: [],
      startTime: Date.now(),
      pendingSegments: [],
      pendingToolCalls: new Map(),
      accumulatedContent: '',
      lastDeliveredSequence,
      abortController,
      recoveryTimeoutId: null,
      setupTimeoutId: null,
      state: 'connected'
    }

    const context: RecoveryContext = {
      mode: 'initial',
      newSocketId: socketId,
      oldSocketId: socketId,  // No previous socket
      conversationId,
      lastDeliveredSequence,
      abortController
    }

    let stateRegistered = false

    try {
      // Register state with ConnectionStateManager before executing recovery flow.
      // This MUST be wrapped in the try/catch so failures don't leave orphaned state.
      // Initial recovery: connected → recovering (loading history from DB)
      // Other modes: disconnected → recovering (replaying from buffer)
      this.stateManager.createConnection(socketId, stateData)
      this.stateManager.transitionTo(socketId, 'recovering')
      stateRegistered = true

      this.logger.debug('recovery.initial.state_registered', {
        socketId,
        conversationId,
        lastDeliveredSequence
      })

      // Emit conversation_info immediately so client cookie is reseeded
      // This is critical for cookie-less recovery to persist the conversationId
      socket.emit('message', {
        type: 'conversation_info',
        content: '',
        data: {
          conversationId,
          agentId: DEFAULT_AGENT_NAME
        }
      } as WebSocketMessage, (ackError?: string) => {
        if (ackError) {
          this.logger.warn('recovery.initial.conversation_info_ack_failed', {
            socketId,
            conversationId,
            error: ackError
          })
        }
      })

      await this.executeRecoveryFlow(socket, context, stateData, callbacks)
    } catch (error) {
      // If recovery fails after state registration, clean up to prevent leaks
      if (stateRegistered) {
        this.stateManager.cleanup(socketId).catch((err) => {
          this.logger.error('recovery.initial.cleanup_failed', {
            socketId,
            error: err instanceof Error ? err.message : String(err)
          })
        })
      }
      throw error
    }
  }

  /**
   * Send "stream completed" message when recovery attempted but no buffered events
   */
  async sendStreamCompletedStatus(
    socket: Socket,
    conversationId?: string,
    appId?: string
  ): Promise<void> {
    let fullHistory: PersistedMessage[] = []
    let historyStreaming = false
    let paginationInfo = { hasMore: false, nextCursor: null as string | null, total: 0 }

    if (conversationId && appId && this.historyProvider) {
      try {
        // Load raw database messages (not summarized LLM context)
        // Initial load: most recent 5 messages
        const historyResult = await this.historyProvider.loadHistory(
          conversationId,
          appId,
          { limit: 20 }
        )
        // Handle both paginated and legacy array responses
        fullHistory = Array.isArray(historyResult) ? historyResult : historyResult.messages
        paginationInfo = Array.isArray(historyResult)
          ? { hasMore: false, nextCursor: null, total: fullHistory.length }
          : { hasMore: historyResult.hasMore, nextCursor: historyResult.nextCursor, total: historyResult.total ?? fullHistory.length }
        historyStreaming = fullHistory.length > 0

        this.logger.debug('recovery.history_fetched_completed', {
          conversationId,
          appId,
          messageCount: fullHistory.length,
          hasMore: paginationInfo.hasMore,
          total: paginationInfo.total
        })
      } catch (error) {
        this.logger.warn('recovery.history_fetch_failed_completed', {
          conversationId,
          appId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    // Send recovery status
    socket.emit('message', {
      type: 'recovery_status',
      content: '',
      data: {
        isRecovering: true,
        hasBufferedEvents: false,
        bufferedEventCount: 0,
        streamCompleted: true,
        conversationId,
        historyStreaming,
        historyMessageCount: fullHistory.length
      }
    } as WebSocketMessage)

    // Stream history messages
    if (historyStreaming && fullHistory.length > 0) {
      let historySequence = -1000 // Use negative sequences for history to avoid collision
      for (const msg of fullHistory) {
        socket.emit('message', {
          type: 'history_message',
          content: '',
          data: {
            ...msg,
            sequence: historySequence-- // Assign sequence for deduplication
          }
        } as WebSocketMessage)
      }
    }

    // Always send history_complete (even when empty) for consistent client-side handling
    socket.emit('message', {
      type: 'history_complete',
      content: '',
      data: {
        messageCount: fullHistory.length,
        hasMore: paginationInfo.hasMore,
        nextCursor: paginationInfo.nextCursor,
        total: paginationInfo.total
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
    const replayMetadata = this.eventChannel.getMetadata(context.conversationId)

    // NEW: Fetch full conversation history via historyProvider
    let fullHistory: PersistedMessage[] = []
    let historyIncluded = false
    let paginationInfo = { hasMore: false, nextCursor: null as string | null, total: 0 }

    // Extract appId from stateData context
    const appId = stateData?.context?.appId

    if (this.historyProvider && appId) {
      try {
        // Load raw messages from database (not summarized LLM context)
        // Initial load: most recent 5 messages
        const historyResult = await this.historyProvider.loadHistory(
          context.conversationId,
          appId,
          { limit: 20 }
        )
        // Handle both paginated and legacy array responses
        const rawMessages = Array.isArray(historyResult) ? historyResult : historyResult.messages
        paginationInfo = Array.isArray(historyResult)
          ? { hasMore: false, nextCursor: null, total: rawMessages.length }
          : { hasMore: historyResult.hasMore, nextCursor: historyResult.nextCursor, total: historyResult.total ?? rawMessages.length }

        // Use messages directly - they're already in the correct format.
        // IMPORTANT: Derive in-progress message IDs from event metadata so we only
        // strip content for messages that are actually pending in the buffer.
        const pendingMessageIdsFromMetadata = replayMetadata?.pendingMessageIds ?? []
        const inProgressMessageIds = new Set<string>(pendingMessageIdsFromMetadata)

        fullHistory = rawMessages.map((msg: PersistedMessage) => {
          // Strip content/segments for ANY message being rebuilt by buffered events
          if (inProgressMessageIds.has(msg.id)) {
            this.logger.debug('recovery.strip_in_progress_message_content', {
              messageId: msg.id,
              sender: msg.sender,
              originalContentLength: msg.content?.length || 0,
              bufferedEventCount: events.length,
              totalInProgressMessages: inProgressMessageIds.size
            })

            // Return copy with empty content/segments
            return {
              ...msg,
              content: '',
              segments: [],
              toolCalls: []  // Also strip tool calls to prevent duplication
            }
          }

          return msg
        })

        historyIncluded = true

        this.logger.debug('recovery.history_fetched', {
          conversationId: context.conversationId,
          appId,
          messageCount: fullHistory.length,
          willReplayEvents: events.length > 0,
          strippedMessageCount: inProgressMessageIds.size,
          pendingMetadataCount: pendingMessageIdsFromMetadata.length,
          hasMore: paginationInfo.hasMore,
          total: paginationInfo.total
        })
      } catch (error) {
        this.logger.warn('recovery.history_fetch_failed', {
          conversationId: context.conversationId,
          appId,
          error: error instanceof Error ? error.message : String(error)
        })
        // Continue without history - client can still work with buffered events
      }
    } else {
      this.logger.debug('recovery.no_history_provider', {
        conversationId: context.conversationId,
        hasProvider: !!this.historyProvider,
        hasAppId: !!appId
      })
    }

    // Check for buffer loss
    const expectedNextSequence = context.lastDeliveredSequence + 1
    const { lossDetected, lostEventCount } = this.getBufferLossInfo(
      context.conversationId,
      expectedNextSequence,
      replayMetadata
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

    // Send recovery status - history will be streamed separately
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
        lostEventCount,
        // NEW: Indicate history will be streamed
        historyStreaming: historyIncluded && fullHistory.length > 0,
        historyMessageCount: fullHistory.length
      }
    } as WebSocketMessage)

    // Stream history messages
    if (historyIncluded && fullHistory.length > 0) {
      let historySequence = -1000 // Use negative sequences for history to avoid collision
      for (const msg of fullHistory) {
        socket.emit('message', {
          type: 'history_message',
          content: '',
          data: {
            ...msg,
            sequence: historySequence-- // Assign sequence for deduplication
          }
        } as WebSocketMessage)
      }
    }

    // Always send history_complete (even when empty) for consistent client-side handling
    // This simplifies client logic - can just wait for one event type instead of three scenarios
    socket.emit('message', {
      type: 'history_complete',
      content: '',
      data: {
        messageCount: fullHistory.length,
        hasMore: paginationInfo.hasMore,
        nextCursor: paginationInfo.nextCursor,
        total: paginationInfo.total
      }
    } as WebSocketMessage)

    // Replay buffered events
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
    expectedNextSequence: number,
    metadataOverride?: EventMetadata | null
  ): { lossDetected: boolean; lostEventCount: number } {
    const metadata = metadataOverride ?? this.eventChannel.getMetadata(conversationId)
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
    // Abort the stream (only if abortController exists)
    if (context.abortController) {
      context.abortController.abort()
    } else {
      this.logger.warn('recovery.cleanup.missing_abort_controller', {
        socketId: context.oldSocketId,
        conversationId: context.conversationId,
        recoveryMode: context.mode
      })
    }

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
