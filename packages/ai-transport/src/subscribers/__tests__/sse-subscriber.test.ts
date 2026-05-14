import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SSESubscriber } from '../sse-subscriber.js'
import type { SSEWriter } from '../../sse-writer.js'
import type { StreamingEvent, StreamingEventType } from '../../interfaces.js'

function makeWriter(overrides: Partial<SSEWriter> = {}): SSEWriter {
  return {
    encoding: 'identity',
    write: vi.fn(),
    comment: vi.fn(),
    retry: vi.fn(),
    end: vi.fn(),
    isClosed: () => false,
    getBacklogBytes: () => 0,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<StreamingEvent> = {}): StreamingEvent {
  return {
    id: 'e1', conversationId: 'c1', sequence: 5, type: 'chunk',
    content: 'hello', data: { extra: true }, timestamp: new Date(), agentName: 'test',
    ...overrides,
  }
}

// Use a non-coalesceable type where a test needs a synchronous write without
// advancing fake timers (chunk and tool_input_delta are coalesceable).
const NON_COALESCEABLE: StreamingEventType = 'complete'

describe('SSESubscriber', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('writes formatted SSE to writer using event.sequence', async () => {
    const writer = makeWriter()
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent())
    vi.runAllTimers()

    expect(writer.write).toHaveBeenCalledOnce()
    const written = (writer.write as any).mock.calls[0][0] as string
    expect(written).toContain('id: 5')
    expect(written).toContain('event: chunk')
    expect(written).toContain('"content":"hello"')
    expect(sub.lastSequence).toBe(5)
  })

  it('writes id: 0 when sequence is zero', async () => {
    const writer = makeWriter()
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent({ sequence: 0 }))
    vi.runAllTimers()

    expect(sub.lastSequence).toBe(0)
    const written = (writer.write as any).mock.calls[0][0] as string
    expect(written).toContain('id: 0')
  })

  it('canonical fields override event.data keys', async () => {
    const writer = makeWriter()
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent({
      content: 'real',
      data: { content: 'shadowed', other: 1 },
    }))
    vi.runAllTimers()

    const written = (writer.write as any).mock.calls[0][0] as string
    const dataLine = written.split('\n').find((l: string) => l.startsWith('data:'))!
    const payload = JSON.parse(dataLine.replace('data: ', ''))
    expect(payload.content).toBe('real')
    expect(payload.other).toBe(1)
  })

  it('reports disconnected when writer reports closed', () => {
    const writer = makeWriter({ isClosed: () => true })
    const sub = new SSESubscriber(writer, 'app1')
    expect(sub.isConnected()).toBe(false)
  })

  it('writes error events via deliverError', () => {
    const writer = makeWriter()
    const sub = new SSESubscriber(writer, 'app1')

    sub.onError(new Error('boom'))

    const written = (writer.write as any).mock.calls[0][0] as string
    expect(written).toContain('event: stream_error')
    expect(written).toContain('"error":"boom"')
  })

  it('suppresses write errors on closed connections', async () => {
    const writer = makeWriter()
    ;(writer.write as any).mockImplementation(() => { throw new Error('write after end') })
    const sub = new SSESubscriber(writer, 'app1')

    await expect(sub.onEvent(makeEvent())).resolves.toBeUndefined()
    vi.runAllTimers() // ensure timer-path write doesn't throw either
  })

  it('skips writing entirely when writer reports closed before delivery', async () => {
    const writer = makeWriter({ isClosed: () => true })
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent())
    vi.runAllTimers()

    expect(writer.write).not.toHaveBeenCalled()
    expect(sub.lastSequence).toBe(-1)
  })

  it('logs when writer.write throws unexpectedly (non-closed)', async () => {
    const writer = makeWriter()
    ;(writer.write as any).mockImplementation(() => {
      const err = new Error('zlib error') as NodeJS.ErrnoException
      err.code = 'ERR_STREAM_DESTROYED'
      throw err
    })
    const logger = { warn: vi.fn() }
    const sub = new SSESubscriber(writer, 'app1', logger)

    await sub.onEvent(makeEvent({ sequence: 7 }))
    vi.runAllTimers()

    expect(logger.warn).toHaveBeenCalledWith(
      'sse.subscriber.write_failed',
      expect.objectContaining({
        kind: 'chunk',
        sequence: 7,
        error: 'zlib error',
        errorCode: 'ERR_STREAM_DESTROYED',
      }),
    )
    expect(sub.lastSequence).toBe(-1)
  })

  it('does not advance lastSequence when delivery fails', async () => {
    const writer = makeWriter()
    ;(writer.write as any)
      .mockImplementationOnce(() => {})        // first write succeeds
      .mockImplementationOnce(() => { throw new Error('boom') }) // second throws
    const sub = new SSESubscriber(writer, 'app1')

    // Use non-coalesceable events so each write is immediate
    await sub.onEvent(makeEvent({ sequence: 3, type: NON_COALESCEABLE }))
    expect(sub.lastSequence).toBe(3)

    await sub.onEvent(makeEvent({ sequence: 4, type: NON_COALESCEABLE }))
    expect(sub.lastSequence).toBe(3)
  })

  it('has unique subscriber ID per instance', () => {
    const writer = makeWriter()
    const a = new SSESubscriber(writer, 'app1')
    const b = new SSESubscriber(writer, 'app1')
    expect(a.id).not.toBe(b.id)
  })

  it('swallows formatSSEEvent serialization errors and logs via safeFormatSSEEvent', async () => {
    const writer = makeWriter()
    const warn = vi.fn()
    const sub = new SSESubscriber(writer, 'app1', { warn })

    await expect(sub.onEvent(makeEvent({ data: { huge: BigInt(1) } }))).resolves.toBeUndefined()
    vi.runAllTimers()

    expect(writer.write).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('sse.format_failed', expect.objectContaining({
      kind: 'chunk',
      sequence: 5,
      subscriberId: sub.id,
    }))
    expect(sub.lastSequence).toBe(-1)
  })

  it('merges consecutive chunk events into a single write on timer flush', async () => {
    const writer = makeWriter()
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent({ sequence: 1, content: 'foo' }))
    await sub.onEvent(makeEvent({ sequence: 2, content: 'bar' }))
    await sub.onEvent(makeEvent({ sequence: 3, content: 'baz' }))

    expect(writer.write).not.toHaveBeenCalled()

    vi.runAllTimers()

    expect(writer.write).toHaveBeenCalledOnce()
    const written = (writer.write as any).mock.calls[0][0] as string
    expect(written).toContain('"content":"foobarbaz"')
    expect(written).toContain('id: 3')
    expect(sub.lastSequence).toBe(3)
  })

  it('advances lastSequence to the last merged event', async () => {
    const writer = makeWriter()
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent({ sequence: 10, content: 'a' }))
    await sub.onEvent(makeEvent({ sequence: 11, content: 'b' }))
    vi.runAllTimers()

    expect(sub.lastSequence).toBe(11)
  })

  it('advances last-write-wins fields (agentName, conversationId) to the latest event', async () => {
    const writer = makeWriter()
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent({ sequence: 1, content: 'a', agentName: 'first', conversationId: 'conv-1' }))
    await sub.onEvent(makeEvent({ sequence: 2, content: 'b', agentName: 'second', conversationId: 'conv-2' }))
    vi.runAllTimers()

    const written = (writer.write as any).mock.calls[0][0] as string
    expect(written).toContain('"agentName":"second"')
    expect(written).toContain('"conversationId":"conv-2"')
  })

  it('flushes pending chunk and writes non-coalesceable event immediately', async () => {
    const writer = makeWriter()
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent({ sequence: 1, content: 'tok', type: 'chunk' }))
    // complete is non-coalesceable — should flush the pending chunk first
    await sub.onEvent(makeEvent({ sequence: 2, content: '', type: NON_COALESCEABLE }))

    expect(writer.write).toHaveBeenCalledTimes(2)
    const [first, second] = (writer.write as any).mock.calls.map((c: any) => c[0] as string)
    expect(first).toContain('event: chunk')
    expect(first).toContain('id: 1')
    expect(second).toContain(`event: ${NON_COALESCEABLE}`)
    expect(second).toContain('id: 2')
    expect(sub.lastSequence).toBe(2)
  })

  it('starts a new pending buffer when coalesce key changes', async () => {
    const writer = makeWriter()
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent({ sequence: 1, type: 'tool_input_delta', data: { toolId: 'tool-a', delta: 'x' } }))
    // Different tool ID → different coalesce key: flushes tool-a and starts tool-b
    await sub.onEvent(makeEvent({ sequence: 2, type: 'tool_input_delta', data: { toolId: 'tool-b', delta: 'y' } }))

    expect(writer.write).toHaveBeenCalledOnce()
    const first = (writer.write as any).mock.calls[0][0] as string
    expect(first).toContain('"toolId":"tool-a"')

    vi.runAllTimers()
    expect(writer.write).toHaveBeenCalledTimes(2)
    const second = (writer.write as any).mock.calls[1][0] as string
    expect(second).toContain('"toolId":"tool-b"')
  })

  it('flushes pending on dispose without waiting for timer', async () => {
    const writer = makeWriter()
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent({ sequence: 7, content: 'pending' }))
    expect(writer.write).not.toHaveBeenCalled()

    sub.dispose()

    expect(writer.write).toHaveBeenCalledOnce()
    const written = (writer.write as any).mock.calls[0][0] as string
    expect(written).toContain('"content":"pending"')
    expect(sub.lastSequence).toBe(7)
  })

  it('does not write after dispose even if timer fires late', async () => {
    const writer = makeWriter()
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent({ sequence: 1 }))
    sub.dispose() // flushes immediately + cancels timer

    const callsAfterDispose = (writer.write as any).mock.calls.length
    vi.runAllTimers() // timer should be cancelled — no extra write

    expect(writer.write).toHaveBeenCalledTimes(callsAfterDispose)
  })

  it('flushes pending before stream_error so content precedes the error frame', async () => {
    const writer = makeWriter()
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent({ sequence: 3, content: 'partial' }))
    sub.onError(new Error('upstream failed'))

    expect(writer.write).toHaveBeenCalledTimes(2)
    const [first, second] = (writer.write as any).mock.calls.map((c: any) => c[0] as string)
    expect(first).toContain('event: chunk')
    expect(first).toContain('"content":"partial"')
    expect(second).toContain('event: stream_error')
  })

  it('respects custom baseWindowMs from coalescerConfig', async () => {
    const writer = makeWriter()
    const sub = new SSESubscriber(writer, 'app1', undefined, { baseWindowMs: 100 })

    await sub.onEvent(makeEvent({ sequence: 1, content: 'a' }))

    vi.advanceTimersByTime(50)
    expect(writer.write).not.toHaveBeenCalled()

    vi.advanceTimersByTime(60) // total 110ms > 100ms window
    expect(writer.write).toHaveBeenCalledOnce()
  })

  it('widens flush window when writer reports buffered backlog', async () => {
    // 60 KB of backlog → coalescer's >50-unit threshold → 100ms window.
    const writer = makeWriter({ getBacklogBytes: () => 60 * 1024 })
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent({ sequence: 1, content: 'x' }))

    // 30ms (the default low-pressure window) is no longer enough.
    vi.advanceTimersByTime(30)
    expect(writer.write).not.toHaveBeenCalled()

    vi.advanceTimersByTime(80) // total 110ms > 100ms widened window
    expect(writer.write).toHaveBeenCalledOnce()
  })

  it('uses mid-tier flush window for moderate backlog (>20, ≤50 units)', async () => {
    // 25 KB → 25 units → coalescer's >20-unit threshold → 60ms window.
    const writer = makeWriter({ getBacklogBytes: () => 25 * 1024 })
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent({ sequence: 1, content: 'x' }))

    vi.advanceTimersByTime(30) // base 30ms window not enough
    expect(writer.write).not.toHaveBeenCalled()

    vi.advanceTimersByTime(35) // total 65ms > 60ms mid-tier window
    expect(writer.write).toHaveBeenCalledOnce()
  })
})
