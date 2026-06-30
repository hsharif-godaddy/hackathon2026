import { describe, it, expect, vi } from 'vitest'
import type { TextStreamPart, ToolSet } from 'ai'
import { createObservingTransform, createTerminalAbortPipeline } from '../observing-transform.js'

type AnyPart = TextStreamPart<ToolSet>

async function pump(
  transform: TransformStream<AnyPart, AnyPart>,
  parts: AnyPart[],
): Promise<AnyPart[]> {
  const writer = transform.writable.getWriter()
  const reader = transform.readable.getReader()
  const forwarded: AnyPart[] = []
  const readAll = (async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      forwarded.push(value)
    }
  })()
  for (const part of parts) await writer.write(part)
  await writer.close()
  await readAll
  return forwarded
}

describe('createObservingTransform', () => {
  it('forwards every part downstream unchanged and observes each in order', async () => {
    const observed: AnyPart[] = []
    const factory = createObservingTransform<ToolSet>({
      observe: (part) => { observed.push(part) },
      onTerminalError: () => {},
    })
    const transform = factory({ tools: {}, stopStream: () => {} })

    const parts: AnyPart[] = [
      { type: 'text-delta', id: '1', text: 'hello' } as AnyPart,
      { type: 'finish' } as AnyPart,
    ]
    const forwarded = await pump(transform, parts)

    expect(forwarded).toEqual(parts)
    expect(observed).toEqual(parts)
  })

  it('on an error part: extracts the Error, calls onTerminalError, and calls stopStream', async () => {
    const onTerminalError = vi.fn()
    const stopStream = vi.fn()
    const factory = createObservingTransform<ToolSet>({
      observe: () => {},
      onTerminalError,
    })
    const transform = factory({ tools: {}, stopStream })

    const errorPart = { type: 'error', error: { message: 'budget exceeded', statusCode: 429 } } as unknown as AnyPart
    const forwarded = await pump(transform, [errorPart])

    expect(forwarded).toEqual([errorPart])
    expect(stopStream).toHaveBeenCalledTimes(1)
    expect(onTerminalError).toHaveBeenCalledTimes(1)
    const passed = onTerminalError.mock.calls[0]![0] as Error
    expect(passed).toBeInstanceOf(Error)
    expect(passed.message).toBe('budget exceeded')
  })

  it('does not call onTerminalError or stopStream for non-error parts', async () => {
    const onTerminalError = vi.fn()
    const stopStream = vi.fn()
    const factory = createObservingTransform<ToolSet>({
      observe: () => {},
      onTerminalError,
    })
    const transform = factory({ tools: {}, stopStream })

    await pump(transform, [{ type: 'tool-call', toolCallId: 't1', toolName: 'edit', input: {} } as unknown as AnyPart])

    expect(onTerminalError).not.toHaveBeenCalled()
    expect(stopStream).not.toHaveBeenCalled()
  })
})

describe('createTerminalAbortPipeline', () => {
  const drivePart = async (
    factory: (args: { tools: ToolSet; stopStream: () => void }) => TransformStream<AnyPart, AnyPart>,
    part: AnyPart,
  ): Promise<void> => {
    const transform = factory({ tools: {}, stopStream: () => {} })
    const writer = transform.writable.getWriter()
    const reader = transform.readable.getReader()
    const drain = (async () => { while (true) { const { done } = await reader.read(); if (done) break } })()
    await writer.write(part)
    await writer.close()
    await drain
  }

  it('exposes a signal that is not aborted before any terminal part', () => {
    const pipeline = createTerminalAbortPipeline<ToolSet>({})
    expect(pipeline.signal).toBeInstanceOf(AbortSignal)
    expect(pipeline.signal.aborted).toBe(false)
    expect(pipeline.getTerminalError()).toBeUndefined()
  })

  it('aborts its signal and captures the error when a terminal error part flows through', async () => {
    const pipeline = createTerminalAbortPipeline<ToolSet>({})

    await drivePart(pipeline.experimental_transform, {
      type: 'error',
      error: { message: 'content filtered', statusCode: 502 },
    } as unknown as AnyPart)

    expect(pipeline.signal.aborted).toBe(true)
    expect(pipeline.getTerminalError()).toBeInstanceOf(Error)
    expect(pipeline.getTerminalError()?.message).toBe('content filtered')
  })

  it('composes the caller signal: a caller abort also aborts the pipeline signal', () => {
    const caller = new AbortController()
    const pipeline = createTerminalAbortPipeline<ToolSet>({ callerSignal: caller.signal })

    expect(pipeline.signal.aborted).toBe(false)
    caller.abort('user_stopped')
    expect(pipeline.signal.aborted).toBe(true)
    // A caller stop is not a terminal stream error.
    expect(pipeline.getTerminalError()).toBeUndefined()
  })

  it('forwards observed parts and leaves the signal intact on normal completion', async () => {
    const observed: Array<{ type: string }> = []
    const pipeline = createTerminalAbortPipeline<ToolSet>({
      observe: (part) => { observed.push(part as { type: string }) },
    })

    await drivePart(pipeline.experimental_transform, { type: 'text-delta', id: '1', text: 'hi' } as unknown as AnyPart)

    expect(observed.map((p) => p.type)).toEqual(['text-delta'])
    expect(pipeline.signal.aborted).toBe(false)
    expect(pipeline.getTerminalError()).toBeUndefined()
  })
})

describe('createObservingTransform terminal-error extraction', () => {
  const drive = async (payload: unknown): Promise<Error> => {
    let captured: Error | undefined
    const factory = createObservingTransform<ToolSet>({
      observe: () => {},
      onTerminalError: (e) => { captured = e },
    })
    await pump(factory({ tools: {}, stopStream: () => {} }), [
      { type: 'error', error: payload } as unknown as AnyPart,
    ])
    if (!captured) throw new Error('onTerminalError was not called')
    return captured
  }

  it('passes an Error payload through unchanged (preserves type for classification)', async () => {
    const original = new TypeError('boom')
    expect(await drive(original)).toBe(original)
  })

  it('wraps a non-empty string payload', async () => {
    const out = await drive('plain failure')
    expect(out).toBeInstanceOf(Error)
    expect(out.message).toBe('plain failure')
  })

  it('falls back to a generic message for an empty string payload', async () => {
    expect((await drive('')).message).toBe('Stream error')
  })

  it('uses .message and keeps the raw payload as cause for an object with a string message', async () => {
    const payload = { message: 'content filtered', statusCode: 502 }
    const out = await drive(payload)
    expect(out.message).toBe('content filtered')
    expect(out.cause).toBe(payload)
  })

  it('lifts statusCode and responseBody to the top level so classifiers reading top-level fields work', async () => {
    const payload = { message: 'request timeout', statusCode: 408, responseBody: 'gateway timeout' }
    const out = await drive(payload) as Error & { statusCode?: number; responseBody?: string }
    expect(out.statusCode).toBe(408)
    expect(out.responseBody).toBe('gateway timeout')
  })

  it('does not invent a statusCode when the payload has none', async () => {
    const out = await drive({ message: 'plain' }) as Error & { statusCode?: number }
    expect(out.statusCode).toBeUndefined()
  })

  it('falls back and keeps the raw payload as cause for an object without a string message', async () => {
    const payload = { code: 502 }
    const out = await drive(payload)
    expect(out.message).toBe('Stream error')
    expect(out.cause).toBe(payload)
  })

  it('falls back to a generic message for a null payload', async () => {
    expect((await drive(null)).message).toBe('Stream error')
  })
})
