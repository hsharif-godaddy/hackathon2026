import type { EventSubscriber, StreamingEvent } from '../interfaces.js'

export abstract class BaseEventSubscriber implements EventSubscriber {
  readonly blocking = true
  private disposed = false

  constructor(readonly id: string) {}

  abstract isConnected(): boolean
  protected abstract deliver(event: StreamingEvent): Promise<void>
  protected abstract deliverError(error: Error): void
  protected abstract onDispose(): void

  async onEvent(event: StreamingEvent): Promise<void> {
    if (this.disposed || !this.isConnected()) return
    await this.deliver(event)
  }

  onError(error: Error): void {
    if (this.disposed) return
    this.deliverError(error)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.onDispose()
  }
}
