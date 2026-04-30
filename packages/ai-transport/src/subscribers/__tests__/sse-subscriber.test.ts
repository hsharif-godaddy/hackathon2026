import { describe, it, expect, vi } from 'vitest'
import { SSESubscriber } from '../sse-subscriber.js'
import type { SSEWriter } from '../../sse-writer.js'
import type { StreamingEvent } from '../../interfaces.js'

function makeWriter(overrides: Partial<SSEWriter> = {}): SSEWriter {
  return {
    encoding: 'identity',
    write: vi.fn(),
    comment: vi.fn(),
    retry: vi.fn(),
    end: vi.fn(),
    isClosed: () => false,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<StreamingEvent> = {}): StreamingEvent {
  return {
    id: 'e1', conversationId: 'c1', sequence: 5, type: 'chunk' as any,
    content: 'hello', data: { extra: true }, timestamp: new Date(), agentName: 'test',
    ...overrides,
  }
}

describe('SSESubscriber', () => {
  it('writes formatted SSE to writer using event.sequence by default', async () => {
    const writer = makeWriter()
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent())

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
  })

  it('skips writing entirely when writer reports closed before delivery', async () => {
    const writer = makeWriter({ isClosed: () => true })
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent())

    expect(writer.write).not.toHaveBeenCalled()
    // lastSequence must not advance for an event that was never delivered.
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

    expect(logger.warn).toHaveBeenCalledWith(
      'sse.subscriber.write_failed',
      expect.objectContaining({
        kind: 'chunk',
        sequence: 7,
        error: 'zlib error',
        errorCode: 'ERR_STREAM_DESTROYED',
      }),
    )
    // lastSequence stays at -1 because the write failed.
    expect(sub.lastSequence).toBe(-1)
  })

  it('does not advance lastSequence when delivery fails', async () => {
    const writer = makeWriter()
    ;(writer.write as any)
      .mockImplementationOnce(() => {}) // first write succeeds
      .mockImplementationOnce(() => { throw new Error('boom') }) // second throws
    const sub = new SSESubscriber(writer, 'app1')

    await sub.onEvent(makeEvent({ sequence: 3 }))
    expect(sub.lastSequence).toBe(3)

    await sub.onEvent(makeEvent({ sequence: 4 }))
    expect(sub.lastSequence).toBe(3)
  })

  it('has unique subscriber ID per instance', () => {
    const writer = makeWriter()
    const a = new SSESubscriber(writer, 'app1')
    const b = new SSESubscriber(writer, 'app1')
    expect(a.id).not.toBe(b.id)
  })

  it('swallows formatSSEEvent serialization errors and logs via the shared safeFormatSSEEvent helper', async () => {
    // Regression: a BigInt or circular-ref value in event.data used to throw
    // out of deliver(), re-throw in the blocking-subscriber fail-fast path,
    // and surface as a spurious error+complete on what was actually a
    // healthy turn. Now deliver() routes through safeFormatSSEEvent and
    // the throw becomes a null return.
    const writer = makeWriter()
    const warn = vi.fn()
    const sub = new SSESubscriber(writer, 'app1', { warn })

    await expect(sub.onEvent(makeEvent({ data: { huge: BigInt(1) } }))).resolves.toBeUndefined()

    expect(writer.write).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('sse.format_failed', expect.objectContaining({
      kind: 'chunk',
      sequence: 5,
      subscriberId: sub.id,
    }))
    // Sequence should NOT advance when the event was never written.
    expect(sub.lastSequence).toBe(-1)
  })
})
