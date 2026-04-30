import type { StreamingEvent } from '../interfaces.js'
import { randomUUID } from 'node:crypto'
import { safeFormatSSEEvent } from '../sse-format.js'
import type { SSEWriter } from '../sse-writer.js'
import { BaseEventSubscriber } from './base-subscriber.js'

export interface SSESubscriberLogger {
  warn(event: string, data?: Record<string, unknown>): void
}

export class SSESubscriber extends BaseEventSubscriber {
  private writer: SSEWriter
  private _lastSequence = -1
  private logger: SSESubscriberLogger | undefined

  constructor(writer: SSEWriter, appId: string, logger?: SSESubscriberLogger) {
    super(`sse-${appId}-${randomUUID()}`)
    this.writer = writer
    this.logger = logger
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

  protected async deliver(event: StreamingEvent): Promise<void> {
    const payload = {
      ...event.data,
      content: event.content,
      conversationId: event.conversationId,
      agentName: event.agentName,
    }
    const sseText = safeFormatSSEEvent(event.type, payload, event.sequence, this.logger, { subscriberId: this.id })
    if (sseText && this.safeWrite(sseText, { kind: event.type, sequence: event.sequence })) {
      this._lastSequence = event.sequence
    }
  }

  protected deliverError(error: Error): void {
    const payload = { error: error.message, timestamp: new Date().toISOString() }
    const sseText = safeFormatSSEEvent('stream_error', payload, undefined, this.logger, { subscriberId: this.id })
    if (sseText) this.safeWrite(sseText, { kind: 'stream_error' })
  }

  protected onDispose(): void { /* handled by base */ }
}
