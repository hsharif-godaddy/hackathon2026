import { randomUUID } from 'node:crypto'
import {
  NON_TERMINAL_ERROR_TYPES,
  type StreamingEvent,
  type EventSubscriber,
  type EventMetadata,
  type CircularBufferConfig
} from './interfaces.js'

/**
 * Circular buffer for fixed-size event storage with automatic overflow handling
 * Implements a ring buffer data structure for memory-efficient event buffering
 *
 * @template T - The type of events to store (typically StreamingEvent)
 */
export class CircularBuffer<T extends StreamingEvent> {
  private readonly capacity: number
  private buffer: (T | null)[]
  private writeIndex: number = 0
  private readIndex: number = 0
  private count: number = 0

  /**
   * Creates a new circular buffer with specified capacity
   *
   * @param capacity - Maximum number of events to buffer
   * @throws Error if capacity is less than 1
   *
   * @example
   * ```typescript
   * const buffer = new CircularBuffer<StreamingEvent>(1000)
   * ```
   */
  constructor(capacity: number) {
    if (capacity < 1) {
      throw new Error('Circular buffer capacity must be at least 1')
    }
    this.capacity = capacity
    this.buffer = new Array(capacity).fill(null)
  }

  /**
   * Adds an event to the buffer
   * Automatically overwrites oldest event when buffer is full
   *
   * @param event - The event to add
   *
   * @example
   * ```typescript
   * buffer.push(event)
   * ```
   */
  push(event: T): void {
    this.buffer[this.writeIndex] = event
    this.writeIndex = (this.writeIndex + 1) % this.capacity

    if (this.count < this.capacity) {
      this.count++
    } else {
      // Buffer is full, oldest event was overwritten
      this.readIndex = (this.readIndex + 1) % this.capacity
    }
  }

  /**
   * Returns the current number of events in the buffer
   *
   * @returns Number of buffered events
   */
  size(): number {
    return this.count
  }

  /**
   * Retrieves an event by its sequence number
   *
   * @param sequence - The sequence number to find
   * @returns The event if found, null otherwise
   */
  get(sequence: number): T | null {
    for (let i = 0; i < this.count; i++) {
      const index = (this.readIndex + i) % this.capacity
      const event = this.buffer[index]
      if (event && event.sequence === sequence) {
        return event
      }
    }
    return null
  }

  /**
   * Returns all events in chronological order
   *
   * @returns Array of all buffered events (oldest to newest)
   */
  getAll(): T[] {
    const result: T[] = []
    for (let i = 0; i < this.count; i++) {
      const index = (this.readIndex + i) % this.capacity
      const event = this.buffer[index]
      if (event) {
        result.push(event)
      }
    }
    return result
  }

  /**
   * Returns events after a specified sequence number
   * Useful for replay scenarios where client needs events since last received
   *
   * @param afterSequence - Return events with sequence > this value
   * @returns Array of events after specified sequence
   *
   * @example
   * ```typescript
   * // Get all events after sequence 42
   * const newEvents = buffer.getEventsSince(42)
   * ```
   */
  getEventsSince(afterSequence: number): T[] {
    const result: T[] = []
    for (let i = 0; i < this.count; i++) {
      const index = (this.readIndex + i) % this.capacity
      const event = this.buffer[index]
      if (event && event.sequence > afterSequence) {
        result.push(event)
      }
    }
    return result
  }

  /**
   * Returns the timestamp of the oldest event in the buffer
   *
   * @returns Timestamp of oldest event, or null if buffer is empty
   */
  getOldestTimestamp(): Date | null {
    if (this.count === 0) {
      return null
    }
    const event = this.buffer[this.readIndex]
    return event ? event.timestamp : null
  }

  /**
   * Empties the buffer and resets all indices
   */
  clear(): void {
    this.buffer = new Array(this.capacity).fill(null)
    this.writeIndex = 0
    this.readIndex = 0
    this.count = 0
  }
}

/**
 * State tracking for a conversation's event buffer and subscribers
 */
interface ConversationState {
  /** Circular buffer for event storage */
  buffer: CircularBuffer<StreamingEvent>

  /** Registered subscribers for this conversation */
  subscribers: Set<EventSubscriber>

  /** Next sequence number for this conversation */
  nextSequence: number

  /** Last activity timestamp for TTL cleanup */
  lastActivity: Date
}

/**
 * Central event channel managing per-conversation event buffers
 * Provides pub/sub architecture for decoupling event transport from agent execution
 *
 * Key features:
 * - In-memory circular buffer with configurable capacity
 * - Per-conversation isolation
 * - Monotonic sequence numbering
 * - Multi-subscriber support
 * - TTL-based cleanup
 * - Fail-fast error handling
 */
/**
 * Logger interface for event channel error reporting
 */
export interface EventChannelLogger {
  warn(event: string, data: Record<string, unknown>): void
}

export class ConversationEventChannel {
  private conversations: Map<string, ConversationState> = new Map()
  private config: CircularBufferConfig
  private logger: EventChannelLogger | undefined
  // NEW: Track which messages are actively streaming (incomplete)
  private pendingMessages: Map<string, Set<string>> = new Map()  // conversationId → Set<messageId>

  /**
   * Creates a new conversation event channel
   *
   * @param config - Configuration for circular buffers
   * @param logger - Optional logger for error reporting
   *
   * @example
   * ```typescript
   * const channel = new ConversationEventChannel({
   *   capacity: 1000,        // Buffer up to 1000 events per conversation
   *   ttl: 5 * 60 * 1000     // 5-minute TTL for cleanup
   * }, logger)
   * ```
   */
  constructor(config: CircularBufferConfig = { capacity: 1000, ttl: 5 * 60 * 1000 }, logger?: EventChannelLogger) {
    this.config = config
    this.logger = logger
  }

  /**
   * Add a message ID to the pending set for a conversation
   * @private
   */
  private addPendingMessage(conversationId: string, messageId: string): void {
    if (!this.pendingMessages.has(conversationId)) {
      this.pendingMessages.set(conversationId, new Set())
    }
    this.pendingMessages.get(conversationId)!.add(messageId)
  }

  /**
   * Remove a message ID from the pending set for a conversation
   * @private
   */
  private removePendingMessage(conversationId: string, messageId: string): void {
    const pending = this.pendingMessages.get(conversationId)
    if (pending) {
      pending.delete(messageId)
      if (pending.size === 0) {
        this.pendingMessages.delete(conversationId)
      }
    }
  }

  /**
   * Get all pending message IDs for a conversation
   * @private
   */
  private getPendingMessageIds(conversationId: string): string[] {
    return Array.from(this.pendingMessages.get(conversationId) || [])
  }

  /**
   * Publishes an event to all subscribers of a conversation
   * Creates the event with sequence number and timestamp, buffers it, and notifies subscribers
   *
   * @param conversationId - The conversation to publish to
   * @param eventData - Event data without sequence/timestamp (will be added)
   * @returns The published event with sequence and timestamp
   * @throws Error if any subscriber fails (fail-fast behavior)
   *
   * @example
   * ```typescript
   * await channel.publish('conv_123', {
   *   type: 'chunk',
   *   content: 'Hello world',
   *   data: { source: 'ai_response' },
   *   agentName: 'develop'
   * })
   * ```
   */
  async publish(
    conversationId: string,
    eventData: Omit<StreamingEvent, 'id' | 'sequence' | 'timestamp' | 'deliveredTo' | 'persisted'>
  ): Promise<StreamingEvent> {
    // Get or create conversation state
    let state = this.conversations.get(conversationId)
    if (!state) {
      state = {
        buffer: new CircularBuffer<StreamingEvent>(this.config.capacity),
        subscribers: new Set(),
        nextSequence: 0,
        lastActivity: new Date()
      }
      this.conversations.set(conversationId, state)
    }

    // Create full event with sequence and timestamp
    // Force conversationId to match method argument to prevent mismatched IDs
    const event: StreamingEvent = {
      ...eventData,
      conversationId, // Override any conversationId in eventData
      id: randomUUID(),
      sequence: state.nextSequence++,
      timestamp: new Date(),
      deliveredTo: new Set(),
      persisted: false
    }

    // NEW: Track message lifecycle for pending message detection
    // Extract messageId from event data
    const messageId = event.data?.messageId as string | undefined

    // Error events are terminal for the stream — clear all pending messages.
    // Exception: non-terminal error types (e.g. TOOL_VALIDATION_ERROR) where agent retries.
    const isTerminalError = event.type === 'error' &&
      !NON_TERMINAL_ERROR_TYPES.includes(event.data?.errorType as typeof NON_TERMINAL_ERROR_TYPES[number])

    if (isTerminalError) {
      this.pendingMessages.delete(conversationId)
    } else if (event.type === 'complete' && !messageId) {
      // complete is unambiguously terminal. If messageId is absent (e.g. conversation
      // state already cleaned up on abort/handoff), clear all pending for the conversation.
      this.pendingMessages.delete(conversationId)
    } else if (messageId) {
      // Mark message as pending on streaming events. tool_call/tool_result are
      // intentionally excluded because this path does not attach messageId to them.
      const streamingTypes = ['chunk', 'tool_start', 'tool_input_delta', 'step_start']
      if (streamingTypes.includes(event.type)) {
        this.addPendingMessage(conversationId, messageId)
      }

      // Remove from pending on completion events
      const completionTypes = ['step_complete', 'complete']
      if (completionTypes.includes(event.type)) {
        this.removePendingMessage(conversationId, messageId)
      }
    }

    // Buffer the event
    state.buffer.push(event)
    state.lastActivity = new Date()

    // Notify all subscribers with hybrid dispatch
    // Blocking subscribers (default) are awaited and can fail-fast
    // Non-blocking subscribers run fire-and-forget with errors captured via onError()
    for (const subscriber of state.subscribers) {
      // Check if subscriber has a filter
      if (subscriber.filter && !subscriber.filter(event)) {
        continue // Skip this subscriber
      }

      // Default to blocking for backward compatibility
      const isBlocking = subscriber.blocking !== false

      if (isBlocking) {
        // Blocking: await and propagate errors (fail-fast)
        try {
          await subscriber.onEvent(event)
          event.deliveredTo?.add(subscriber.id)
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))

          // Call onError handler
          try {
            subscriber.onError(err)
          } catch (handlerError) {
            // Log error handler failures to aid debugging
            this.logger?.warn('eventChannel.subscriber.onError_handler_failed', {
              subscriberId: subscriber.id,
              conversationId,
              originalError: err.message,
              handlerError: handlerError instanceof Error ? handlerError.message : String(handlerError)
            })
          }

          // Fail-fast: throw on blocking subscriber error
          throw new Error(`Subscriber ${subscriber.id} failed: ${err.message}`)
        }
      } else {
        // Non-blocking: fire-and-forget with error capture
        // Track delivery synchronously before async work starts to avoid race conditions
        // where code checking deliveredTo immediately after publish() won't see pending subscribers
        event.deliveredTo?.add(subscriber.id)

        subscriber.onEvent(event).catch((error) => {
          const err = error instanceof Error ? error : new Error(String(error))
          try {
            subscriber.onError(err)
          } catch (handlerError) {
            // Log error handler failures to aid debugging
            this.logger?.warn('eventChannel.subscriber.onError_handler_failed', {
              subscriberId: subscriber.id,
              conversationId,
              originalError: err.message,
              handlerError: handlerError instanceof Error ? handlerError.message : String(handlerError)
            })
          }
        })
      }
    }

    return event
  }

  /**
   * Registers a subscriber for a conversation
   * Creates conversation buffer if it doesn't exist
   *
   * @param conversationId - The conversation to subscribe to
   * @param subscriber - The subscriber to register
   *
   * @example
   * ```typescript
   * channel.subscribe('conv_123', new SSESubscriber(writer, appId))
   * ```
   */
  subscribe(conversationId: string, subscriber: EventSubscriber): void {
    let state = this.conversations.get(conversationId)
    if (!state) {
      state = {
        buffer: new CircularBuffer<StreamingEvent>(this.config.capacity),
        subscribers: new Set(),
        nextSequence: 0,
        lastActivity: new Date()
      }
      this.conversations.set(conversationId, state)
    }

    state.subscribers.add(subscriber)
    state.lastActivity = new Date()
  }

  /**
   * Unregisters a subscriber from a conversation.
   *
   * The event buffer is intentionally retained until TTL cleanup. A client can
   * lose the tail of an SSE stream while the server already published
   * terminal events; retaining the buffer lets reconnect replay those terminal
   * events instead of reporting an in-progress stream forever.
   *
   * @param conversationId - The conversation to unsubscribe from
   * @param subscriberId - The subscriber ID to remove
   *
   * @example
   * ```typescript
   * channel.unsubscribe('conv_123', 'sse-subscriber-1')
   * ```
   */
  unsubscribe(conversationId: string, subscriberId: string): void {
    const state = this.conversations.get(conversationId)
    if (!state) {
      return
    }

    // Remove subscriber with matching ID
    for (const subscriber of state.subscribers) {
      if (subscriber.id === subscriberId) {
        state.subscribers.delete(subscriber)
        break
      }
    }

    state.lastActivity = new Date()
  }

  /**
   * Returns events after a specified sequence number
   * Used for connection recovery to replay missed events
   *
   * @param conversationId - The conversation to get events from
   * @param afterSequence - Return events with sequence > this value
   * @returns Array of events after specified sequence
   *
   * @example
   * ```typescript
   * // Replay all events (from sequence 0)
   * const events = channel.getEventsSince('conv_123', 0)
   * ```
   */
  getEventsSince(conversationId: string, afterSequence: number): StreamingEvent[] {
    const state = this.conversations.get(conversationId)
    if (!state) {
      return []
    }

    return state.buffer.getEventsSince(afterSequence)
  }

  /**
   * Marks all buffered events for a persisted message as database-backed.
   * Recovery can then filter those events when the client also reloads the
   * persisted history snapshot, avoiding duplicate live-event replay.
   *
   * @param conversationId - The conversation containing buffered events
   * @param messageId - Persisted agent message ID attached to stream events
   * @returns Number of events marked persisted
   */
  markMessageEventsPersisted(conversationId: string, messageId: string): number {
    const state = this.conversations.get(conversationId)
    if (!state) {
      return 0
    }

    let marked = 0
    for (const event of state.buffer.getAll()) {
      // persisted is monotonic: once the DB snapshot covers an event, every
      // future recovery reader should observe the same buffered object as persisted.
      if (event.data?.messageId === messageId && event.persisted !== true) {
        event.persisted = true
        marked++
      }
    }

    if (marked > 0) {
      state.lastActivity = new Date()
    }
    return marked
  }

  /**
   * Returns metadata about a conversation's event buffer
   * Useful for diagnostics and replay status
   *
   * @param conversationId - The conversation to get metadata for
   * @returns Event metadata or null if conversation doesn't exist or has no events yet
   *
   * @example
   * ```typescript
   * const metadata = channel.getMetadata('conv_123')
   * if (metadata) {
   *   console.log(`Buffered ${metadata.totalEvents} events`)
   *   console.log(`Oldest event: ${metadata.oldestTimestamp}`)
   * } else {
   *   console.log('No events yet or conversation not found')
   * }
   * ```
   */
  getMetadata(conversationId: string): EventMetadata | null {
    const state = this.conversations.get(conversationId)
    if (!state) {
      return null
    }

    const events = state.buffer.getAll()
    if (events.length === 0) {
      // Return null instead of bogus timestamps when no events exist
      // This allows consumers to distinguish "no events yet" from "events existed but were truncated"
      return null
    }

    return {
      conversationId,
      firstSequence: events[0]!.sequence,
      lastSequence: events[events.length - 1]!.sequence,
      totalEvents: events.length,
      oldestTimestamp: events[0]!.timestamp,
      newestTimestamp: events[events.length - 1]!.timestamp,
      pendingMessageIds: this.getPendingMessageIds(conversationId)
    }
  }

  /**
   * Removes expired conversations based on TTL
   * Only removes conversations with no active subscribers and no activity for longer than TTL
   * This prevents dropping live WebSocket connections that may be idle but still subscribed
   *
   * @returns Number of conversations cleaned up
   *
   * @example
   * ```typescript
   * // Run cleanup periodically
   * setInterval(() => {
   *   const removed = channel.cleanup()
   *   console.log(`Cleaned up ${removed} expired conversations`)
   * }, 60000) // Every minute
   * ```
   */
  cleanup(): number {
    const now = new Date()
    const conversationsToRemove: string[] = []

    for (const [conversationId, state] of this.conversations) {
      // Only cleanup conversations with no active subscribers
      if (state.subscribers.size > 0) {
        continue
      }

      const timeSinceLastActivity = now.getTime() - state.lastActivity.getTime()

      if (timeSinceLastActivity >= this.config.ttl) {
        conversationsToRemove.push(conversationId)
      }
    }

    for (const conversationId of conversationsToRemove) {
      this.conversations.delete(conversationId)
      this.pendingMessages.delete(conversationId)  // NEW: Clean up pending message tracking
    }

    return conversationsToRemove.length
  }

  /**
   * Returns the number of active conversations
   *
   * @returns Number of conversations with buffers
   */
  getActiveConversationCount(): number {
    return this.conversations.size
  }

  /**
   * Checks if a conversation exists in the channel
   *
   * @param conversationId - The conversation to check
   * @returns true if conversation exists, false otherwise
   */
  hasConversation(conversationId: string): boolean {
    return this.conversations.has(conversationId)
  }
}
