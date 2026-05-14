import type { StreamingEvent } from '../interfaces.js'
import { randomUUID } from 'node:crypto'
import { formatStreamErrorFallback, safeFormatSSEEvent } from '../sse-format.js'
import type { SSEWriter } from '../sse-writer.js'
import { EventCoalescer, type CoalescerConfig } from './event-coalescer.js'
import { BaseEventSubscriber } from './base-subscriber.js'

export interface SSESubscriberLogger {
  warn(event: string, data?: Record<string, unknown>): void
}

/**
 * SSE subscriber that delivers events to a connected HTTP client via an SSEWriter.
 *
 * Coalescing of consecutive chunk / tool_input_delta events is delegated to the
 * shared `EventCoalescer` so SSE and WebSocket apply identical policy. Merging
 * advances the event's sequence to the latest, so the SSE `id:` line on a
 * coalesced frame is the correct Last-Event-Id resumption cursor.
 *
 * Reducing the number of writes also reduces the number of compressed-stream
 * flush boundaries, improving compression ratio when brotli/gzip is enabled.
 *
 * Backpressure: by default the coalescer's adaptive window samples the
 * underlying writer's buffered bytes (compressor + socket queues) so a slow
 * client widens the flush window automatically. Callers can override by
 * passing `coalescerConfig.getBackpressure` explicitly.
 */
export class SSESubscriber extends BaseEventSubscriber {
  private writer: SSEWriter
  private _lastSequence = -1
  private logger: SSESubscriberLogger | undefined
  private coalescer: EventCoalescer<StreamingEvent>

  constructor(writer: SSEWriter, appId: string, logger?: SSESubscriberLogger, coalescerConfig?: CoalescerConfig) {
    super(`sse-${appId}-${randomUUID()}`)
    this.writer = writer
    this.logger = logger
    // EventCoalescer's adaptive thresholds (>20, >50) were tuned for
    // Socket.IO message counts; map SSE buffered bytes to the same scale at
    // ~1 KB per "unit" so 20-50 KB of backlog widens the window the same way
    // ~20-50 queued WS messages would. Node's default socket highWaterMark
    // is 16 KB, so units > 20 means we're past it.
    const config: CoalescerConfig = {
      getBackpressure: () => Math.floor(writer.getBacklogBytes() / 1024),
      logContext: { subscriberId: this.id, transport: 'sse' },
      ...(logger !== undefined ? { logger } : {}),
      ...coalescerConfig,
    }
    this.coalescer = new EventCoalescer<StreamingEvent>(
      (events) => { for (const e of events) this.writeEvent(e) },
      config,
    )
  }

  get lastSequence(): number {
    return this._lastSequence
  }

  isConnected(): boolean {
    return !this.writer.isClosed()
  }

  // isClosed() handles the expected close-race; anything else (serialization
  // or stream errors) is logged rather than swallowed.
  private safeWrite(sseText: string, context: { kind: string; sequence?: number }): boolean {
    if (this.writer.isClosed()) return false
    try {
      this.writer.write(sseText)
      return true
    } catch (err) {
      this.logger?.warn('sse.subscriber.write_failed', {
        subscriberId: this.id,
        kind: context.kind,
        sequence: context.sequence,
        error: err instanceof Error ? err.message : String(err),
        errorCode: (err as NodeJS.ErrnoException | undefined)?.code,
      })
      return false
    }
  }

  private writeEvent(event: StreamingEvent): void {
    const payload = {
      ...event.data,
      content: event.content,
      conversationId: event.conversationId,
      agentName: event.agentName,
    }
    const sseText = safeFormatSSEEvent(event.type, payload, event.sequence, this.logger, { subscriberId: this.id })
    if (sseText) {
      if (this.safeWrite(sseText, { kind: event.type, sequence: event.sequence })) {
        this._lastSequence = event.sequence
      }
      return
    }
    // Format failed (BigInt, circular ref, etc). Emit a synthetic stream_error
    // so the client doesn't hang waiting for stream_complete, and advance
    // _lastSequence so a Last-Event-Id reconnect doesn't replay the
    // unformattable frame.
    const fallback = formatStreamErrorFallback(event.type, event.sequence)
    if (this.safeWrite(fallback, { kind: 'stream_error', sequence: event.sequence })) {
      this._lastSequence = event.sequence
      return
    }
    // Doubly-failed: the client is now definitively stranded — the original
    // event was unformattable AND we couldn't deliver the fallback frame.
    // Emit a dedicated log so this is greppable independently of the
    // generic write_failed events from healthy stream_error frames.
    this.logger?.warn('sse.subscriber.fallback_write_failed', {
      subscriberId: this.id,
      kind: event.type,
      sequence: event.sequence,
    })
  }

  protected async deliver(event: StreamingEvent): Promise<void> {
    this.coalescer.push(event)
  }

  protected deliverError(error: Error): void {
    // Flush pending coalesced events so the client receives all content that
    // arrived before the error frame (mirrors the WS path).
    this.coalescer.flush()
    const payload = { error: error.message, timestamp: new Date().toISOString() }
    const sseText = safeFormatSSEEvent('stream_error', payload, undefined, this.logger, { subscriberId: this.id })
    if (sseText) this.safeWrite(sseText, { kind: 'stream_error' })
  }

  protected onDispose(): void {
    this.coalescer.dispose()
  }
}
