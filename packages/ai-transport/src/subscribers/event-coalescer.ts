import { getCoalesceKey, mergeCoalescedData } from '../interfaces.js'

/**
 * Minimal shape required to participate in coalescing.
 * Both `WebSocketMessage` and `StreamingEvent` satisfy this — the coalescer is
 * generic so the same policy serves both transports.
 */
export interface CoalesceableMessage {
  type: string
  content: string
  data: Record<string, unknown>
}

/**
 * Message with coalescing metadata
 */
export type CoalescedMessage<T extends CoalesceableMessage> = T & {
  /** Number of original events merged into this message (1 = no coalescing) */
  coalescedCount?: number
}

export interface CoalescerLogger {
  warn(event: string, data?: Record<string, unknown>): void
}

/**
 * Configuration for EventCoalescer
 */
export interface CoalescerConfig {
  /** Base coalescing window in ms (default: 30) */
  baseWindowMs?: number
  /** Returns current backpressure level. Higher values widen the coalescing
   *  window. The thresholds are unitless: > 20 → 60 ms, > 50 → 100 ms. Each
   *  caller supplies a number on a scale that fits its transport (e.g. WS
   *  passes Socket.IO `writeBuffer.length`, SSE scales buffered bytes to
   *  ~1 KB per unit). Sampled when the flush timer is scheduled, not when
   *  it fires. */
  getBackpressure?: () => number
  /** Optional logger; receives `coalescer.flush_threw` if a synchronous
   *  `onFlush` call from the timer path throws. Without this, a synchronous
   *  throw inside the timer callback would surface as `uncaughtException`. */
  logger?: CoalescerLogger
  /** Static fields merged into every log payload — e.g. `{ subscriberId,
   *  transport }` so operators can identify which subscriber's flush
   *  failed. */
  logContext?: Record<string, unknown>
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
export class EventCoalescer<T extends CoalesceableMessage> {
  private pending: T | null = null
  private pendingKey: string | null = null
  private pendingCount = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private readonly onFlush: (messages: CoalescedMessage<T>[]) => void
  private readonly baseWindowMs: number
  private readonly getBackpressure: (() => number) | undefined
  private readonly logger: CoalescerLogger | undefined
  private readonly logContext: Record<string, unknown> | undefined

  constructor(
    onFlush: (messages: CoalescedMessage<T>[]) => void,
    config: CoalescerConfig = {}
  ) {
    this.onFlush = onFlush
    this.baseWindowMs = config.baseWindowMs ?? 30
    this.getBackpressure = config.getBackpressure
    this.logger = config.logger
    this.logContext = config.logContext
  }

  /**
   * Accept an event for potential coalescing
   */
  push(message: T): void {
    if (this.disposed) return

    const key = getCoalesceKey(message.type, message.data)

    if (key === null) {
      // Non-coalesceable: flush pending + pass through immediately together
      const batch: CoalescedMessage<T>[] = []
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
      // Last-write-wins for fields beyond content/data (sequence, id, timestamp
      // on StreamingEvent). Single spread is one allocation and avoids the
      // ordering trap of mutate-then-restore.
      this.pending = {
        ...message,
        content: this.pending.content + message.content,
        data: mergeCoalescedData(message.type, this.pending.data, message.data),
      }
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

  private takePending(): CoalescedMessage<T> {
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
      if (!this.pending) return
      // Caller-side flush sites (push / flush / dispose) run under whatever
      // try/catch their callers provide. The timer is the unique unguarded
      // path — a synchronous throw here would surface as `uncaughtException`.
      // takePending() runs before onFlush, so pending/pendingKey/pendingCount
      // are already cleared even when onFlush throws — the next push starts
      // a fresh buffer.
      const message = this.takePending()
      try {
        this.onFlush([message])
      } catch (err) {
        // sequence is transport-specific (StreamingEvent has it; WebSocketMessage
        // doesn't) — include when present so SSE operators see the lost frame's
        // cursor without forcing the field onto the base CoalesceableMessage.
        const seq = (message as { sequence?: unknown }).sequence
        this.logger?.warn('coalescer.flush_threw', {
          ...this.logContext,
          error: err instanceof Error ? err.message : String(err),
          eventType: message.type,
          coalescedCount: message.coalescedCount ?? 1,
          ...(typeof seq === 'number' ? { sequence: seq } : {}),
        })
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
