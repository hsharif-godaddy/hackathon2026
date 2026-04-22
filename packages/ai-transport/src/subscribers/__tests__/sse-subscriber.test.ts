import { describe, it, expect, vi } from 'vitest'
import { SSESubscriber } from '../sse-subscriber.js'
import type { StreamingEvent } from '../../interfaces.js'

function makeRes(overrides: Record<string, unknown> = {}) {
  return {
    writableEnded: false,
    destroyed: false,
    write: vi.fn(),
    ...overrides,
  } as any
}

function makeEvent(overrides: Partial<StreamingEvent> = {}): StreamingEvent {
  return {
    id: 'e1', conversationId: 'c1', sequence: 5, type: 'chunk' as any,
    content: 'hello', data: { extra: true }, timestamp: new Date(), agentName: 'test',
    ...overrides,
  }
}

describe('SSESubscriber', () => {
  it('writes formatted SSE to response using event.sequence by default', async () => {
    const res = makeRes()
    const sub = new SSESubscriber(res, 'app1')

    await sub.onEvent(makeEvent())

    expect(res.write).toHaveBeenCalledOnce()
    const written = res.write.mock.calls[0][0] as string
    expect(written).toContain('id: 5')
    expect(written).toContain('event: chunk')
    expect(written).toContain('"content":"hello"')
    expect(sub.lastSequence).toBe(5)
  })

  it('writes id: 0 when sequence is zero', async () => {
    const res = makeRes()
    const sub = new SSESubscriber(res, 'app1')

    await sub.onEvent(makeEvent({ sequence: 0 }))
    expect(sub.lastSequence).toBe(0)

    const written = res.write.mock.calls[0][0] as string
    expect(written).toContain('id: 0')
  })

  it('canonical fields override event.data keys', async () => {
    const res = makeRes()
    const sub = new SSESubscriber(res, 'app1')

    await sub.onEvent(makeEvent({
      content: 'real',
      data: { content: 'shadowed', other: 1 },
    }))

    const written = res.write.mock.calls[0][0] as string
    const dataLine = written.split('\n').find((l: string) => l.startsWith('data:'))!
    const payload = JSON.parse(dataLine.replace('data: ', ''))
    expect(payload.content).toBe('real')
    expect(payload.other).toBe(1)
  })

  it('reports disconnected when res.writableEnded', () => {
    const res = makeRes({ writableEnded: true })
    const sub = new SSESubscriber(res, 'app1')
    expect(sub.isConnected()).toBe(false)
  })

  it('reports disconnected when res.destroyed', () => {
    const res = makeRes({ destroyed: true })
    const sub = new SSESubscriber(res, 'app1')
    expect(sub.isConnected()).toBe(false)
  })

  it('writes error events via deliverError', () => {
    const res = makeRes()
    const sub = new SSESubscriber(res, 'app1')

    sub.onError(new Error('boom'))

    const written = res.write.mock.calls[0][0] as string
    expect(written).toContain('event: stream_error')
    expect(written).toContain('"error":"boom"')
  })

  it('suppresses write errors on closed connections', async () => {
    const res = makeRes()
    res.write.mockImplementation(() => { throw new Error('write after end') })
    const sub = new SSESubscriber(res, 'app1')

    await expect(sub.onEvent(makeEvent())).resolves.toBeUndefined()
  })

  it('has unique subscriber ID per instance', () => {
    const res = makeRes()
    const a = new SSESubscriber(res, 'app1')
    const b = new SSESubscriber(res, 'app1')
    expect(a.id).not.toBe(b.id)
  })
})
