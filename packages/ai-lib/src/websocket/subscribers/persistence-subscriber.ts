import type { EventSubscriber, StreamingEvent, PersistenceStreamingEvent, ConversationPersistence, ConversationContext } from '../interfaces.js'

/**
 * Logger interface for persistence subscriber
 * Allows injection of any logger that supports error/warn methods
 */
export interface PersistenceLogger {
  error(event: string, data: Record<string, unknown>): void
  warn?(event: string, data: Record<string, unknown>): void
}

/**
 * Persistence subscriber that writes events to database
 * Wraps existing ConversationPersistence interface for event-driven architecture
 *
 * Key features:
 * - Non-blocking (fire-and-forget) - errors are logged but don't abort stream
 * - Converts StreamingEvent to PersistenceStreamingEvent format
 * - Calls captureStreamingEvent() for each event
 * - Marks events as persisted on success
 * - Logs errors for monitoring without affecting UX
 *
 * @example
 * ```typescript
 * const subscriber = new PersistenceSubscriber(
 *   persistence,
 *   conversationContext,
 *   logger
 * )
 * channel.subscribe(conversationId, subscriber)
 * ```
 */
export class PersistenceSubscriber implements EventSubscriber {
  id: string

  /**
   * Non-blocking subscriber - persistence errors are logged but don't abort stream.
   * This ensures the user sees streaming content even if database writes fail.
   * The completeConversation() call will still work as it uses the in-memory
   * streamingEvents array which is populated synchronously.
   */
  blocking = false

  private persistence: ConversationPersistence
  private context: ConversationContext
  private logger: PersistenceLogger | undefined

  /**
   * Creates a new persistence subscriber
   *
   * @param persistence - ConversationPersistence implementation
   * @param context - Conversation context for persistence operations
   * @param logger - Optional logger for error reporting
   *
   * @example
   * ```typescript
   * const subscriber = new PersistenceSubscriber(
   *   messagePersistence,
   *   { socketId: 'socket-123', agentName: 'develop', appId: 'app-456' },
   *   logger
   * )
   * ```
   */
  constructor(
    persistence: ConversationPersistence,
    context: ConversationContext,
    logger?: PersistenceLogger
  ) {
    this.persistence = persistence
    this.context = context
    this.logger = logger
    this.id = `persistence-${context.socketId}`
  }

  /**
   * Handles a streaming event by persisting to database
   * Converts to PersistenceStreamingEvent format and calls captureStreamingEvent
   *
   * @param event - The streaming event to persist
   *
   * Note: This subscriber is non-blocking. Errors are logged but not thrown,
   * allowing the stream to continue even if persistence fails.
   *
   * @example
   * ```typescript
   * await subscriber.onEvent(event)
   * ```
   */
  async onEvent(event: StreamingEvent): Promise<void> {
    const persistenceEvent = this.toPersistenceEvent(event)

    try {
      await this.persistence.captureStreamingEvent(
        event.conversationId,
        persistenceEvent,
        this.context
      )

      // Mark as persisted on success
      event.persisted = true
    } catch (error) {
      // Log error but don't throw - stream continues
      // completeConversation() will still work as it uses in-memory streamingEvents
      this.logger?.error('persistence.streaming_event.failed', {
        conversationId: event.conversationId,
        eventId: event.id,
        sequence: event.sequence,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
      // Don't re-throw - this is a non-blocking subscriber
    }
  }

  /**
   * Handles an error that occurred during event processing
   * Logs error without throwing (errors already logged by event channel)
   *
   * @param _error - The error that occurred (unused)
   *
   * @example
   * ```typescript
   * subscriber.onError(new Error('Failed to persist event'))
   * ```
   */
  onError(_error: Error): void {
    // Error already logged by event channel
    // This is a hook for additional error handling if needed
    // Could emit metrics, trigger alerts, etc.
  }

  /**
   * Optional filter - PersistenceSubscriber persists all events by default
   *
   * @param _event - The event to filter (unused)
   * @returns true (persists all events)
   */
  filter(_event: StreamingEvent): boolean {
    return true // Persist all events
  }

  /**
   * Converts StreamingEvent to PersistenceStreamingEvent format
   * Maps event fields to persistence format
   *
   * @param event - The streaming event to convert
   * @returns Persistence event ready for database storage
   *
   * @example
   * ```typescript
   * const persistenceEvent = subscriber.toPersistenceEvent(event)
   * await persistence.captureStreamingEvent(conversationId, persistenceEvent, context)
   * ```
   */
  toPersistenceEvent(event: StreamingEvent): PersistenceStreamingEvent {
    return {
      type: event.type,
      content: event.content,
      data: event.data,
      timestamp: event.timestamp
    }
  }
}
