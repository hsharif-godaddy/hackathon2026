import type { EventSubscriber, StreamingEvent } from '../interfaces.js'

/**
 * WebSocket message format for Socket.IO emission
 */
export interface WebSocketMessage {
  type: StreamingEvent['type']
  content: string
  data: Record<string, unknown>
}

/**
 * Disconnected stream state for tracking recovery during connection window
 * Note: Events are buffered in the ConversationEventChannel, not here.
 * This only tracks the last delivered sequence for replay on reconnection.
 */
export interface DisconnectedStreamState {
  abortController: AbortController
  timeoutId: NodeJS.Timeout
  conversationId: string
  /** Last sequence number successfully delivered before disconnection */
  lastDeliveredSequence: number
}

/**
 * WebSocket subscriber that delivers events to connected Socket.IO clients
 * Skips events during disconnection (buffering happens in event channel)
 *
 * Key features:
 * - Emits events to connected sockets via Socket.IO
 * - Skips events during disconnection (event channel buffers them)
 * - Converts StreamingEvent to WebSocketMessage format
 * - Handles socket connection state gracefully
 *
 * @example
 * ```typescript
 * const subscriber = new WebSocketSubscriber(
 *   socket,
 *   disconnectedStreams
 * )
 * channel.subscribe(conversationId, subscriber)
 * ```
 */
export class WebSocketSubscriber implements EventSubscriber {
  id: string

  /**
   * Blocking subscriber - WebSocket errors should abort the stream.
   * This ensures we detect socket failures immediately and can handle them
   * (e.g., buffer for recovery or abort the stream).
   */
  blocking = true

  private socket: any // Socket.IO socket
  private disconnectedStreams: Map<string, DisconnectedStreamState>

  /**
   * Creates a new WebSocket subscriber
   *
   * @param socket - Socket.IO socket instance
   * @param disconnectedStreams - Map of disconnected streams for skip detection
   *
   * @example
   * ```typescript
   * const subscriber = new WebSocketSubscriber(socket, disconnectedStreams)
   * ```
   */
  constructor(
    socket: any,
    disconnectedStreams: Map<string, DisconnectedStreamState>
  ) {
    this.socket = socket
    this.disconnectedStreams = disconnectedStreams
    this.id = `websocket-${socket.id}`
  }

  /**
   * Handles a streaming event by emitting to WebSocket or skipping
   * Skips when disconnected (event channel buffers events for later replay)
   *
   * @param event - The streaming event to process
   * @throws Error if event delivery fails (for fail-fast behavior)
   *
   * @example
   * ```typescript
   * await subscriber.onEvent(event)
   * ```
   */
  async onEvent(event: StreamingEvent): Promise<void> {
    // Check if socket is disconnected but stream is still active
    // Skip emitting - events are buffered in the event channel and will be
    // replayed via getEventsSince() when the socket reconnects
    if (this.disconnectedStreams.has(this.socket.id)) {
      return // No-op: event channel handles buffering
    }

    if (this.socket.connected) {
      // Normal emit to connected socket
      const message = this.toWebSocketMessage(event)
      this.socket.emit('message', message)
    }
    // If not connected and not in recovery window, silently skip
    // (subscriber should have been unregistered)
  }

  /**
   * Handles an error that occurred during event processing
   * Emits error event to WebSocket client if connected
   *
   * @param error - The error that occurred
   *
   * @example
   * ```typescript
   * subscriber.onError(new Error('Failed to process event'))
   * ```
   */
  onError(error: Error): void {
    if (this.socket.connected) {
      this.socket.emit('message', {
        type: 'error',
        content: error.message,
        data: {
          error: error.message,
          timestamp: new Date().toISOString()
        }
      })
    }
  }

  /**
   * Optional filter - WebSocketSubscriber receives all events by default
   *
   * @param _event - The event to filter (unused)
   * @returns true (receives all events)
   */
  filter(_event: StreamingEvent): boolean {
    return true // No filtering by default
  }

  /**
   * Converts StreamingEvent to WebSocketMessage format
   * Preserves event type, content, and data fields
   *
   * @param event - The streaming event to convert
   * @returns WebSocket message ready for Socket.IO emission
   *
   * @example
   * ```typescript
   * const message = subscriber.toWebSocketMessage(event)
   * socket.emit('message', message)
   * ```
   */
  toWebSocketMessage(event: StreamingEvent): WebSocketMessage {
    return {
      type: event.type,
      content: event.content,
      data: event.data
    }
  }
}
