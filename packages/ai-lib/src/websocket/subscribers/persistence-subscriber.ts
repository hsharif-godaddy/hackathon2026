import type { EventSubscriber, StreamingEvent, PersistenceStreamingEvent, ConversationPersistence, ConversationContext } from '../interfaces.js'

/**
 * Persistence subscriber that writes events to database
 * Wraps existing ConversationPersistence interface for event-driven architecture
 *
 * Key features:
 * - Converts StreamingEvent to PersistenceStreamingEvent format
 * - Calls captureStreamingEvent() for each event
 * - Marks events as persisted on success
 * - Throws error on failure for fail-fast behavior
 *
 * @example
 * ```typescript
 * const subscriber = new PersistenceSubscriber(
 *   persistence,
 *   conversationContext
 * )
 * channel.subscribe(conversationId, subscriber)
 * ```
 */
export class PersistenceSubscriber implements EventSubscriber {
  id: string
  private persistence: ConversationPersistence
  private context: ConversationContext

  /**
   * Creates a new persistence subscriber
   *
   * @param persistence - ConversationPersistence implementation
   * @param context - Conversation context for persistence operations
   *
   * @example
   * ```typescript
   * const subscriber = new PersistenceSubscriber(
   *   messagePersistence,
   *   { socketId: 'socket-123', agentName: 'develop', appId: 'app-456' }
   * )
   * ```
   */
  constructor(
    persistence: ConversationPersistence,
    context: ConversationContext
  ) {
    this.persistence = persistence
    this.context = context
    this.id = `persistence-${context.socketId}`
  }

  /**
   * Handles a streaming event by persisting to database
   * Converts to PersistenceStreamingEvent format and calls captureStreamingEvent
   *
   * @param event - The streaming event to persist
   * @throws Error if persistence fails (for fail-fast behavior)
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
      // Re-throw for fail-fast behavior
      throw error instanceof Error
        ? error
        : new Error(`Persistence failed: ${String(error)}`)
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
