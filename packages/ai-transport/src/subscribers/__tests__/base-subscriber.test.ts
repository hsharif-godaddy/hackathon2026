import { describe, it, expect, vi } from 'vitest'
import { BaseEventSubscriber } from '../base-subscriber.js'
import type { StreamingEvent } from '../../interfaces.js'

class TestSubscriber extends BaseEventSubscriber {
  public deliverCalls: StreamingEvent[] = []
  public errorCalls: Error[] = []
  public disposeCalled = false
  public disposeCount = 0
  private connected = true

  constructor(id: string) { super(id) }

  setConnected(v: boolean) { this.connected = v }
  isConnected(): boolean { return this.connected }

  protected async deliver(event: StreamingEvent): Promise<void> {
    this.deliverCalls.push(event)
  }
  protected deliverError(error: Error): void {
    this.errorCalls.push(error)
  }
  protected onDispose(): void {
    this.disposeCalled = true
    this.disposeCount++
  }
}

function makeEvent(overrides: Partial<StreamingEvent> = {}): StreamingEvent {
  return {
    id: 'e1', conversationId: 'c1', sequence: 1, type: 'chunk' as any,
    content: 'hello', data: {}, timestamp: new Date(), agentName: 'test',
    ...overrides,
  }
}

describe('BaseEventSubscriber', () => {
  it('delivers events when connected', async () => {
    const sub = new TestSubscriber('s1')
    await sub.onEvent(makeEvent())
    expect(sub.deliverCalls).toHaveLength(1)
  })

  it('skips delivery when disconnected', async () => {
    const sub = new TestSubscriber('s1')
    sub.setConnected(false)
    await sub.onEvent(makeEvent())
    expect(sub.deliverCalls).toHaveLength(0)
  })

  it('skips delivery after dispose', async () => {
    const sub = new TestSubscriber('s1')
    sub.dispose()
    await sub.onEvent(makeEvent())
    expect(sub.deliverCalls).toHaveLength(0)
    expect(sub.disposeCalled).toBe(true)
  })

  it('skips error delivery after dispose', () => {
    const sub = new TestSubscriber('s1')
    sub.dispose()
    sub.onError(new Error('test'))
    expect(sub.errorCalls).toHaveLength(0)
  })

  it('only calls onDispose once on multiple dispose calls', () => {
    const sub = new TestSubscriber('s1')
    sub.dispose()
    sub.dispose()
    sub.dispose()
    expect(sub.disposeCount).toBe(1)
  })

  it('delivers errors when active', () => {
    const sub = new TestSubscriber('s1')
    sub.onError(new Error('test'))
    expect(sub.errorCalls).toHaveLength(1)
  })
})
