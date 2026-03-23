import type { EventSubscriber, StreamingEvent } from '../interfaces.js'
import { EventCoalescer, type CoalescerConfig, type CoalescedMessage } from './event-coalescer.js'

/**
 * WebSocket message format for Socket.IO emission
 */
export interface WebSocketMessage {
  type: StreamingEvent['type']
  content: string
  data: Record<string, unknown>
}

/**
 * Function type for checking if a socket is disconnected
 * Used to decouple WebSocketSubscriber from state management implementation
 */
export type IsDisconnectedFn = (socketId: string) => boolean

/**
 * WebSocket subscriber that delivers events to connected Socket.IO clients
 * Coalesces consecutive chunk/tool_input_delta events into single emits.
 * Skips events during disconnection (buffering happens in event channel)
 */
export class WebSocketSubscriber implements EventSubscriber {
  id: string

  /**
   * Blocking subscriber — onEvent() resolves immediately after buffering
   * (synchronous push). The event channel awaits the buffer-add, not the
   * socket emit. Actual emission happens asynchronously via the coalescer's
   * flush timer. Emit errors are caught in emitMessages() to prevent
   * uncaught exceptions in the timer callback.
   */
  blocking = true

  private socket: any // Socket.IO socket
  private isDisconnected: IsDisconnectedFn
  private coalescer: EventCoalescer

  constructor(
    socket: any,
    isDisconnected: IsDisconnectedFn,
    coalescerConfig?: CoalescerConfig
  ) {
    this.socket = socket
    this.isDisconnected = isDisconnected
    this.id = `websocket-${socket.id}`

    this.coalescer = new EventCoalescer(
      (messages) => this.emitMessages(messages),
      coalescerConfig
    )
  }

  async onEvent(event: StreamingEvent): Promise<void> {
    if (this.isDisconnected(this.socket.id)) {
      return
    }

    if (this.socket.connected) {
      const message = this.toWebSocketMessage(event)
      this.coalescer.push(message)
    }
  }

  /**
   * Flush pending buffer and release timer resources.
   * MUST be called on socket disconnect to avoid leaking buffered events.
   */
  dispose(): void {
    this.coalescer.dispose()
  }

  onError(error: Error): void {
    if (this.socket.connected) {
      // Flush pending events before emitting error (non-terminal — coalescer stays usable)
      this.coalescer.flush()
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

  filter(_event: StreamingEvent): boolean {
    return true
  }

  toWebSocketMessage(event: StreamingEvent): WebSocketMessage {
    return {
      type: event.type,
      content: event.content,
      data: event.data
    }
  }

  private emitMessages(messages: CoalescedMessage[]): void {
    if (!this.socket.connected) return
    try {
      for (const msg of messages) {
        // Strip coalescedCount — internal metadata, not part of the wire protocol
        const { coalescedCount: _, ...wireMessage } = msg
        this.socket.emit('message', wireMessage)
      }
    } catch {
      // Swallow emit errors in timer callback to prevent uncaught exceptions.
      // The event channel has all events buffered for recovery regardless.
    }
  }
}
