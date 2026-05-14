import type { StreamingEvent } from '../interfaces.js'
import { EventCoalescer, type CoalescerConfig, type CoalescedMessage } from './event-coalescer.js'
import { BaseEventSubscriber } from './base-subscriber.js'

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
export class WebSocketSubscriber extends BaseEventSubscriber {
  private socket: any // Socket.IO socket
  private isDisconnected: IsDisconnectedFn
  private coalescer: EventCoalescer<WebSocketMessage>

  constructor(
    socket: any,
    isDisconnected: IsDisconnectedFn,
    coalescerConfig?: CoalescerConfig
  ) {
    super(`websocket-${socket.id}`)
    this.socket = socket
    this.isDisconnected = isDisconnected
    this.coalescer = new EventCoalescer<WebSocketMessage>(
      (messages) => this.emitMessages(messages),
      coalescerConfig
    )
  }

  isConnected(): boolean {
    return !this.isDisconnected(this.socket.id) && this.socket.connected
  }

  protected async deliver(event: StreamingEvent): Promise<void> {
    const message = this.toWebSocketMessage(event)
    this.coalescer.push(message)
  }

  protected deliverError(error: Error): void {
    if (!this.socket.connected) return
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

  /**
   * Flush pending buffer and release timer resources.
   * MUST be called on socket disconnect to avoid leaking buffered events.
   */
  protected onDispose(): void {
    this.coalescer.dispose()
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

  private emitMessages(messages: CoalescedMessage<WebSocketMessage>[]): void {
    if (!this.socket.connected) return
    // Throws from socket.emit propagate to the coalescer's timer-path catch
    // (event-coalescer.ts) which logs `coalescer.flush_threw` if a logger is
    // configured. Event channel has all events buffered for recovery.
    for (const msg of messages) {
      // Strip coalescedCount — internal metadata, not part of the wire protocol
      const { coalescedCount: _, ...wireMessage } = msg
      this.socket.emit('message', wireMessage)
    }
  }
}
