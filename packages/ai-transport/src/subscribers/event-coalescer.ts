import { getCoalesceKey, mergeCoalescedData } from '../interfaces.js'
import type { WebSocketMessage } from './websocket-subscriber.js'

/**
 * Message with coalescing metadata
 */
export interface CoalescedMessage extends WebSocketMessage {
  /** Number of original events merged into this message (1 = no coalescing) */
  coalescedCount?: number
}

/**
 * Configuration for EventCoalescer
 */
export interface CoalescerConfig {
  /** Base coalescing window in ms (default: 30) */
  baseWindowMs?: number
  /** Returns current backpressure level (e.g. Socket.IO writeBuffer length).
   *  Higher values widen the coalescing window.
   *  Sampled when the flush timer is scheduled (on first push after a flush),
   *  not when the timer fires. */
  getBackpressure?: () => number
}

/**
 * Pure coalescing logic for WebSocket messages.
 *
 * Buffers consecutive same-type coalesceable events (chunk, tool_input_delta)
 * and flushes them as a single message with concatenated content on a timer.
 * Non-coalesceable events flush any pending buffer and pass through immediately.
 *
 * Adaptive window: if getBackpressure returns > 0, the flush window scales up
 * to reduce emit frequency when the client is falling behind.
 */
export class EventCoalescer {
  private pending: WebSocketMessage | null = null
  private pendingKey: string | null = null
  private pendingCount = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private readonly onFlush: (messages: CoalescedMessage[]) => void
  private readonly baseWindowMs: number
  private readonly getBackpressure: (() => number) | undefined

  constructor(
    onFlush: (messages: CoalescedMessage[]) => void,
    config: CoalescerConfig = {}
  ) {
    this.onFlush = onFlush
    this.baseWindowMs = config.baseWindowMs ?? 30
    this.getBackpressure = config.getBackpressure
  }

  /**
   * Accept an event for potential coalescing
   */
  push(message: WebSocketMessage): void {
    if (this.disposed) return

    const key = getCoalesceKey(message.type, message.data)

    if (key === null) {
      // Non-coalesceable: flush pending + pass through immediately together
      const batch: CoalescedMessage[] = []
      if (this.pending) {
        batch.push(this.takePending())
      }
      batch.push(message)
      this.clearTimer()
      this.onFlush(batch)
      return
    }

    // Coalesceable event
    if (this.pending && this.pendingKey === key) {
      // Same coalesce key: merge
      this.pending.content += message.content
      this.pending.data = mergeCoalescedData(message.type, this.pending.data, message.data)
      this.pendingCount++
    } else {
      // Different key: flush previous, start new buffer
      if (this.pending) {
        this.clearTimer()
        this.onFlush([this.takePending()])
      }
      this.pending = { ...message }
      this.pendingKey = key
      this.pendingCount = 1
    }

    this.scheduleFlush()
  }

  /**
   * Immediately flush any pending buffer without disabling the coalescer.
   * Use this for non-terminal flush points (e.g. onError where streaming may continue).
   */
  flush(): void {
    this.clearTimer()
    if (this.pending) {
      this.onFlush([this.takePending()])
    }
  }

  /**
   * Immediately flush any pending buffer and permanently disable the coalescer.
   * MUST be called on socket disconnect to avoid leaking timers.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearTimer()
    if (this.pending) {
      this.onFlush([this.takePending()])
    }
  }

  private takePending(): CoalescedMessage {
    const msg = this.pending!
    const count = this.pendingCount
    this.pending = null
    this.pendingKey = null
    this.pendingCount = 0
    return count > 1 ? { ...msg, coalescedCount: count } : msg
  }

  private getWindowMs(): number {
    if (!this.getBackpressure) return this.baseWindowMs
    const backlog = this.getBackpressure()
    if (backlog > 50) return 100
    if (backlog > 20) return 60
    return this.baseWindowMs
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return // already scheduled
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      if (this.pending) {
        this.onFlush([this.takePending()])
      }
    }, this.getWindowMs())
  }

  private clearTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }
}
