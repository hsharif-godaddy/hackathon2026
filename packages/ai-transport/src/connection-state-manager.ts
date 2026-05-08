import type { ConversationContext, PersistenceStreamingEvent } from './interfaces.js'
import { createLogger } from '@airo/ai-common'

/**
 * Connection lifecycle states
 */
export type ConnectionState = 'connected' | 'disconnected' | 'recovering' | 'cleaned'

/**
 * Unified state data for a connection
 * Consolidates data from multiple Maps in the original WebSocketServer
 */
export interface ConnectionStateData {
  // Conversation metadata (from activeConversations)
  conversationId: string
  agentName: string
  context: ConversationContext
  streamingEvents: PersistenceStreamingEvent[]
  startTime: number
  pendingSegments: any[]
  pendingToolCalls: Map<string, any>
  accumulatedContent: string

  // Delivery tracking
  lastDeliveredSequence: number

  // Stream control (from activeStreams)
  abortController: AbortController | null

  // Recovery state (from disconnectedStreams)
  recoveryTimeoutId: NodeJS.Timeout | null

  // Setup tracking (from pendingSetup)
  setupTimeoutId: NodeJS.Timeout | null

  // User-initiated stop tracking
  userStopped: boolean

  // Timestamp when connection entered 'disconnected' state (for recovery duration)
  disconnectTime: number | null

  // Current state
  state: ConnectionState
}

/**
 * Parameters for creating a new connection
 */
export interface CreateConnectionParams {
  conversationId: string
  agentName: string
  context: ConversationContext
}

/**
 * Parameters for state transitions
 */
export interface TransitionParams {
  abortController?: AbortController | null
  // Note: | undefined is required due to exactOptionalPropertyTypes - allows passing undefined to clear
  recoveryTimeoutId?: NodeJS.Timeout | undefined
  setupTimeoutId?: NodeJS.Timeout | undefined
  lastDeliveredSequence?: number
}

/**
 * Configuration for ConnectionStateManager
 */
export interface ConnectionStateManagerConfig {
  recoveryWindow: number
  ackTimeout: number
  onCleanup?: (socketId: string, data: ConnectionStateData) => Promise<void>
}

/**
 * Logger interface for state manager
 */
export interface StateManagerLogger {
  debug(event: string, data: Record<string, unknown>): void
  info(event: string, data: Record<string, unknown>): void
  warn(event: string, data: Record<string, unknown>): void
  error(event: string, data: Record<string, unknown>): void
}

/**
 * Manages connection state with atomic transitions
 *
 * Consolidates 7 Maps/Sets from WebSocketServer into a single coherent state machine:
 * - activeStreams -> ConnectionStateData.abortController
 * - activeConversations -> ConnectionStateData (conversation fields)
 * - disconnectedStreams -> state === 'disconnected' + recoveryTimeoutId
 * - socketIdMigrations -> internal migration tracking
 * - socketMessageQueues -> queueMessage() method
 * - pendingSetup -> ConnectionStateData.setupTimeoutId
 * - cleanupInProgress -> isCleanupInProgress() method
 */
export class ConnectionStateManager {
  private readonly connections: Map<string, ConnectionStateData> = new Map()
  private readonly socketIdMigrations: Map<string, string> = new Map()
  private readonly socketMessageQueues: Map<string, Promise<void>> = new Map()
  private readonly cleanupInProgress: Set<string> = new Set()

  private readonly config: ConnectionStateManagerConfig
  private readonly logger: StateManagerLogger

  constructor(config: ConnectionStateManagerConfig, logger?: StateManagerLogger) {
    this.config = config
    this.logger = logger ?? createLogger('connection-state')
  }

  // ===== State Queries =====

  /**
   * Get the current state of a connection
   */
  getState(socketId: string): ConnectionState | undefined {
    const effectiveId = this.getEffectiveSocketId(socketId)
    return this.connections.get(effectiveId)?.state
  }

  /**
   * Get full state data for a connection
   */
  getStateData(socketId: string): ConnectionStateData | undefined {
    const effectiveId = this.getEffectiveSocketId(socketId)
    return this.connections.get(effectiveId)
  }

  /**
   * Check if a socket has an active stream (AbortController)
   */
  hasActiveStream(socketId: string): boolean {
    const effectiveId = this.getEffectiveSocketId(socketId)
    const data = this.connections.get(effectiveId)
    return data?.abortController !== null && data?.state === 'connected'
  }

  /**
   * Check if a socket has a conversation (may be disconnected)
   */
  hasConversation(socketId: string): boolean {
    const effectiveId = this.getEffectiveSocketId(socketId)
    return this.connections.has(effectiveId)
  }

  /**
   * Check if a socket is in the recovery window
   */
  isInRecoveryWindow(socketId: string): boolean {
    const effectiveId = this.getEffectiveSocketId(socketId)
    const data = this.connections.get(effectiveId)
    return data?.state === 'disconnected' && data.recoveryTimeoutId !== null
  }

  /**
   * Get the conversation ID for a socket
   */
  getConversationId(socketId: string): string | undefined {
    const effectiveId = this.getEffectiveSocketId(socketId)
    return this.connections.get(effectiveId)?.conversationId
  }

  /**
   * Get AbortController for a socket
   */
  getAbortController(socketId: string): AbortController | null {
    const effectiveId = this.getEffectiveSocketId(socketId)
    return this.connections.get(effectiveId)?.abortController ?? null
  }

  // ===== State Transitions =====

  /**
   * Create a new connection in 'connected' state
   */
  createConnection(socketId: string, params: CreateConnectionParams): ConnectionStateData {
    const data: ConnectionStateData = {
      conversationId: params.conversationId,
      agentName: params.agentName,
      context: params.context,
      streamingEvents: [],
      startTime: Date.now(),
      pendingSegments: [],
      pendingToolCalls: new Map(),
      accumulatedContent: '',
      lastDeliveredSequence: -1,
      abortController: null,
      recoveryTimeoutId: null,
      setupTimeoutId: null,
      userStopped: false,
      disconnectTime: null,
      state: 'connected'
    }

    this.connections.set(socketId, data)

    this.logger.debug('connection.created', {
      socketId,
      conversationId: params.conversationId,
      agentName: params.agentName
    })

    return data
  }

  /**
   * Transition a connection to a new state
   * Returns true if transition was successful, false if invalid
   * Note: Idempotent transitions (same state -> same state) are no-ops and return true immediately.
   * Use updateConnection() if you need to update params without changing state.
   */
  transitionTo(socketId: string, newState: ConnectionState, params: TransitionParams = {}): boolean {
    const effectiveId = this.getEffectiveSocketId(socketId)
    const data = this.connections.get(effectiveId)

    if (!data) {
      this.logger.warn('connection.transition.not_found', { socketId, effectiveId, newState })
      return false
    }

    const oldState = data.state

    // Idempotent transition - return immediately as no-op
    // If params need updating, use updateConnection() instead
    if (oldState === newState) {
      return true
    }

    // Validate transition
    if (!this.isValidTransition(oldState, newState)) {
      this.logger.warn('connection.transition.invalid', {
        socketId,
        oldState,
        newState
      })
      return false
    }

    // Update state
    data.state = newState
    if (newState === 'disconnected') {
      data.disconnectTime = Date.now()
    } else if (newState === 'connected') {
      data.disconnectTime = null
    }

    // Apply params
    if (params.abortController !== undefined) {
      data.abortController = params.abortController
    }
    if (params.recoveryTimeoutId !== undefined) {
      data.recoveryTimeoutId = params.recoveryTimeoutId
    }
    if (params.setupTimeoutId !== undefined) {
      data.setupTimeoutId = params.setupTimeoutId
    }
    if (params.lastDeliveredSequence !== undefined) {
      data.lastDeliveredSequence = params.lastDeliveredSequence
    }

    this.logger.debug('connection.transition', {
      socketId,
      effectiveId,
      oldState,
      newState,
      conversationId: data.conversationId
    })

    return true
  }

  /**
   * Update connection data without changing state
   */
  updateConnection(socketId: string, updates: Partial<Pick<ConnectionStateData,
    'abortController' | 'lastDeliveredSequence' | 'recoveryTimeoutId' | 'setupTimeoutId' |
    'streamingEvents' | 'pendingSegments' | 'pendingToolCalls' | 'accumulatedContent' |
    'agentName' | 'context' | 'userStopped'
  >>): boolean {
    const effectiveId = this.getEffectiveSocketId(socketId)
    const data = this.connections.get(effectiveId)

    if (!data) {
      return false
    }

    if (updates.abortController !== undefined) data.abortController = updates.abortController
    if (updates.lastDeliveredSequence !== undefined) data.lastDeliveredSequence = updates.lastDeliveredSequence
    if (updates.recoveryTimeoutId !== undefined) data.recoveryTimeoutId = updates.recoveryTimeoutId
    if (updates.setupTimeoutId !== undefined) data.setupTimeoutId = updates.setupTimeoutId
    if (updates.streamingEvents !== undefined) data.streamingEvents = updates.streamingEvents
    if (updates.pendingSegments !== undefined) data.pendingSegments = updates.pendingSegments
    if (updates.pendingToolCalls !== undefined) data.pendingToolCalls = updates.pendingToolCalls
    if (updates.accumulatedContent !== undefined) data.accumulatedContent = updates.accumulatedContent
    if (updates.agentName !== undefined) data.agentName = updates.agentName
    if (updates.context !== undefined) data.context = updates.context
    if (updates.userStopped !== undefined) data.userStopped = updates.userStopped

    return true
  }

  /**
   * Check if a state transition is valid
   * Note: This is called after idempotent check in transitionTo(), so from !== to here
   */
  private isValidTransition(from: ConnectionState, to: ConnectionState): boolean {
    // Define valid transitions
    const validTransitions: Record<ConnectionState, ConnectionState[]> = {
      connected: ['recovering', 'disconnected', 'cleaned'], // Allow recovering for initial recovery
      disconnected: ['recovering', 'connected', 'cleaned'],
      recovering: ['connected', 'cleaned'],
      cleaned: [] // Terminal state
    }

    return validTransitions[from]?.includes(to) ?? false
  }

  // ===== Socket ID Migration =====

  /**
   * Record a socket ID migration (old -> new)
   */
  migrateSocketId(oldSocketId: string, newSocketId: string): void {
    // Skip migration if socket IDs are the same (e.g., initial recovery with no previous socket)
    if (oldSocketId === newSocketId) {
      this.logger.debug('connection.migrate.skipped_same_id', {
        socketId: oldSocketId
      })
      return
    }

    // Get the data for the old socket
    const data = this.connections.get(oldSocketId)
    if (!data) {
      this.logger.warn('connection.migrate.not_found', { oldSocketId, newSocketId })
      return
    }

    // Move data to new socket ID
    this.connections.set(newSocketId, data)
    this.connections.delete(oldSocketId)

    // Track migration for in-flight operations
    this.socketIdMigrations.set(oldSocketId, newSocketId)

    this.logger.info('connection.migrated', {
      oldSocketId,
      newSocketId,
      conversationId: data.conversationId
    })
  }

  /**
   * Get the effective socket ID by following migration chain
   * Detects and breaks cycles
   */
  getEffectiveSocketId(socketId: string): string {
    const visited = new Set<string>()
    let currentId = socketId

    while (this.socketIdMigrations.has(currentId)) {
      if (visited.has(currentId)) {
        // Cycle detected - break it by deleting all visited entries
        this.logger.warn('connection.migration.cycle_detected', {
          socketId,
          cycle: Array.from(visited)
        })
        for (const id of visited) {
          this.socketIdMigrations.delete(id)
        }
        return currentId
      }

      visited.add(currentId)
      currentId = this.socketIdMigrations.get(currentId)!
    }

    return currentId
  }

  /**
   * Clear migration chain starting from a socket ID
   */
  clearMigrationChain(startingSocketId: string): void {
    let current = startingSocketId
    const toDelete: string[] = []

    while (this.socketIdMigrations.has(current)) {
      toDelete.push(current)
      current = this.socketIdMigrations.get(current)!
    }

    for (const id of toDelete) {
      this.socketIdMigrations.delete(id)
    }

    if (toDelete.length > 0) {
      this.logger.debug('connection.migration.chain_cleared', {
        startingSocketId,
        clearedCount: toDelete.length
      })
    }
  }

  // ===== Cleanup =====

  /**
   * Check if cleanup is in progress for a socket
   */
  isCleanupInProgress(socketId: string): boolean {
    const effectiveId = this.getEffectiveSocketId(socketId)
    return this.cleanupInProgress.has(effectiveId)
  }

  /**
   * Clean up a connection and all associated resources
   */
  async cleanup(socketId: string): Promise<void> {
    const effectiveId = this.getEffectiveSocketId(socketId)

    // Guard against duplicate cleanup
    if (this.cleanupInProgress.has(effectiveId)) {
      this.logger.debug('connection.cleanup.already_in_progress', { socketId, effectiveId })
      return
    }

    this.cleanupInProgress.add(effectiveId)

    try {
      const data = this.connections.get(effectiveId)
      if (!data) {
        this.logger.debug('connection.cleanup.not_found', { socketId, effectiveId })
        return
      }

      // Clear any pending timeouts
      if (data.recoveryTimeoutId) {
        clearTimeout(data.recoveryTimeoutId)
        data.recoveryTimeoutId = null
      }
      if (data.setupTimeoutId) {
        clearTimeout(data.setupTimeoutId)
        data.setupTimeoutId = null
      }

      // Call cleanup hook if provided
      if (this.config.onCleanup) {
        await this.config.onCleanup(effectiveId, data)
      }

      // Remove connection
      this.connections.delete(effectiveId)

      // Clean up migrations pointing to this socket
      for (const [oldId, newId] of this.socketIdMigrations) {
        if (newId === effectiveId) {
          this.socketIdMigrations.delete(oldId)
        }
      }

      // Clear migration chain from this socket
      this.clearMigrationChain(effectiveId)

      // Clean up message queue
      this.socketMessageQueues.delete(effectiveId)

      this.logger.info('connection.cleanup.complete', {
        socketId,
        effectiveId,
        conversationId: data.conversationId
      })

    } finally {
      this.cleanupInProgress.delete(effectiveId)
    }
  }

  // ===== Message Queue =====

  /**
   * Queue a message handler for serialized processing
   * Prevents concurrent handleChatMessage races
   */
  async queueMessage<T>(socketId: string, handler: () => Promise<T>): Promise<T> {
    const existingQueue = this.socketMessageQueues.get(socketId) ?? Promise.resolve()

    // Create promise that will hold the result
    let resolveResult: (value: T) => void
    let rejectResult: (error: unknown) => void
    const resultPromise = new Promise<T>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })

    // Chain the handler onto the queue
    const newQueue = existingQueue
      .catch(() => {}) // Ignore previous errors in chain
      .then(async () => {
        try {
          const result = await handler()
          resolveResult!(result)
        } catch (error) {
          rejectResult!(error)
        }
      })
      .finally(() => {
        // Clean up queue entry if this was the last message
        if (this.socketMessageQueues.get(socketId) === newQueue) {
          this.socketMessageQueues.delete(socketId)
        }
      })

    this.socketMessageQueues.set(socketId, newQueue as Promise<void>)

    return resultPromise
  }

  // ===== Disconnected Stream Tracking (for WebSocketSubscriber compatibility) =====

  /**
   * Get a reference to disconnected socket IDs for WebSocketSubscriber
   * This maintains backward compatibility with the subscriber pattern
   */
  getDisconnectedSocketIds(): Set<string> {
    const disconnected = new Set<string>()
    for (const [socketId, data] of this.connections) {
      if (data.state === 'disconnected') {
        disconnected.add(socketId)
      }
    }
    return disconnected
  }

  /**
   * Check if a socket is disconnected (for WebSocketSubscriber)
   */
  isDisconnected(socketId: string): boolean {
    const effectiveId = this.getEffectiveSocketId(socketId)
    const data = this.connections.get(effectiveId)
    return data?.state === 'disconnected'
  }

  /**
   * Find a connection by conversation ID
   * Used for conversation-based recovery when socket ID is unknown
   * @returns [socketId, stateData] tuple or null if not found
   */
  findByConversationId(conversationId: string): [string, ConnectionStateData] | null {
    for (const [socketId, data] of this.connections) {
      if (data.conversationId === conversationId) {
        return [socketId, data]
      }
    }
    return null
  }

  /**
   * Is there a producer still running for this conversation?
   *
   * Checks every tracked connection (including disconnected ones inside the
   * recovery window) for a non-aborted AbortController. True iff the agent
   * turn is genuinely still in flight on the server — the authoritative
   * "streamCompleted" signal for recovery.
   */
  hasActiveStreamForConversation(conversationId: string): boolean {
    for (const data of this.connections.values()) {
      if (data.conversationId !== conversationId) continue
      const ctrl = data.abortController
      if (ctrl && !ctrl.signal.aborted) return true
    }
    return false
  }

  /**
   * Find a disconnected connection by conversation ID
   * Used for conversation-based recovery
   * @returns [socketId, stateData] tuple or null if not found
   */
  findDisconnectedByConversationId(conversationId: string): [string, ConnectionStateData] | null {
    for (const [socketId, data] of this.connections) {
      if (data.conversationId === conversationId && data.state === 'disconnected') {
        return [socketId, data]
      }
    }
    return null
  }

  // ===== Utility Methods =====

  /**
   * Abort all active connections (for server shutdown)
   * @returns Number of connections aborted
   */
  abortAll(): number {
    let count = 0
    for (const [_socketId, data] of this.connections) {
      if (data.abortController) {
        data.abortController.abort()
        count++
      }
      // Clear timeouts
      if (data.recoveryTimeoutId) {
        clearTimeout(data.recoveryTimeoutId)
      }
      if (data.setupTimeoutId) {
        clearTimeout(data.setupTimeoutId)
      }
    }
    this.connections.clear()
    this.socketIdMigrations.clear()
    this.cleanupInProgress.clear()
    return count
  }

  /**
   * Get count of active connections
   */
  getActiveConnectionCount(): number {
    return this.connections.size
  }

  /**
   * Get count of disconnected connections (in recovery window)
   */
  getDisconnectedCount(): number {
    let count = 0
    for (const data of this.connections.values()) {
      if (data.state === 'disconnected') {
        count++
      }
    }
    return count
  }

  /**
   * Add a streaming event to a connection
   */
  addStreamingEvent(socketId: string, event: PersistenceStreamingEvent): boolean {
    const effectiveId = this.getEffectiveSocketId(socketId)
    const data = this.connections.get(effectiveId)
    if (!data) return false

    data.streamingEvents.push(event)
    return true
  }

  /**
   * Get all streaming events for a connection
   */
  getStreamingEvents(socketId: string): PersistenceStreamingEvent[] {
    const effectiveId = this.getEffectiveSocketId(socketId)
    return this.connections.get(effectiveId)?.streamingEvents ?? []
  }
}
