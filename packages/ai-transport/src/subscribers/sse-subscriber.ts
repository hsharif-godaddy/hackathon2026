import type { StreamingEvent } from '../interfaces.js'
import type { ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { formatSSEEvent } from '../sse-format.js'
import { BaseEventSubscriber } from './base-subscriber.js'

export class SSESubscriber extends BaseEventSubscriber {
  private res: ServerResponse
  private _lastSequence = -1

  constructor(res: ServerResponse, appId: string) {
    super(`sse-${appId}-${randomUUID()}`)
    this.res = res
  }

  get lastSequence(): number {
    return this._lastSequence
  }

  isConnected(): boolean {
    return !this.res.writableEnded && !this.res.destroyed
  }

  protected async deliver(event: StreamingEvent): Promise<void> {
    const payload = {
      ...event.data,
      content: event.content,
      conversationId: event.conversationId,
      agentName: event.agentName,
    }

    try {
      this.res.write(formatSSEEvent(event.type, payload, event.sequence))
      this._lastSequence = event.sequence
    } catch {
      // Connection closed, will be cleaned up by registry
    }
  }

  protected deliverError(error: Error): void {
    const payload = { error: error.message, timestamp: new Date().toISOString() }
    try {
      this.res.write(formatSSEEvent('stream_error', payload))
    } catch {
      // Connection closed
    }
  }

  protected onDispose(): void {
    // No cleanup needed beyond disposal flag (handled by base)
  }
}
