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
 * Disconnected stream state for buffering events during connection recovery
 */
export interface DisconnectedStreamState {
  abortController: AbortController
  timeoutId: NodeJS.Timeout
  bufferedEvents: WebSocketMessage[]
  conversationId: string
}

/**
 * WebSocket subscriber that delivers events to connected Socket.IO clients
 * Buffers events during disconnection for replay on reconnection
 *
 * Key features:
 * - Emits events to connected sockets via Socket.IO
 * - Buffers events during disconnection to disconnectedStreams map
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
  private socket: any // Socket.IO socket
  private disconnectedStreams: Map<string, DisconnectedStreamState>

  /**
   * Creates a new WebSocket subscriber
   *
   * @param socket - Socket.IO socket instance
   * @param disconnectedStreams - Map of disconnected streams for buffering
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
   * Handles a streaming event by emitting to WebSocket or buffering
   * Checks socket connection state and buffers if disconnected
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
    const message = this.toWebSocketMessage(event)

    // Check if socket is disconnected but stream is still active
    if (this.disconnectedStreams.has(this.socket.id)) {
      // Buffer the event for replay on reconnection
      this.disconnectedStreams.get(this.socket.id)!.bufferedEvents.push(message)
    } else if (this.socket.connected) {
      // Normal emit to connected socket
      this.socket.emit('message', message)
    }
    // If not connected and not in recovery, silently skip
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
