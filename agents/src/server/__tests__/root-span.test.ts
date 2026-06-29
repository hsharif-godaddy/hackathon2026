import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SpanStatusCode } from '@opentelemetry/api'

// Hoisted so the mocks are initialized before the @opentelemetry/api mock
// factory (and the SUT import) run. startActiveSpan(name, options, callback)
// invokes the callback with our mock span and returns its result, matching the
// real tracer contract runRootSpan relies on.
const { mockSpan, mockStartActiveSpan } = vi.hoisted(() => {
  const span = { recordException: vi.fn(), setStatus: vi.fn(), end: vi.fn() }
  const startActiveSpan = vi.fn(
    (_name: string, _options: unknown, cb: (s: typeof span) => unknown): unknown => cb(span),
  )
  return { mockSpan: span, mockStartActiveSpan: startActiveSpan }
})

vi.mock('@opentelemetry/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/api')>()
  return {
    ...actual,
    trace: { ...actual.trace, getTracer: vi.fn().mockReturnValue({ startActiveSpan: mockStartActiveSpan }) },
  }
})

import { runRootSpan, runRootSpanBackground } from '../root-span.js'

describe('runRootSpan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the fn result and ends the span on success', async () => {
    const result: string = await runRootSpan('test.span', async () => 'value')
    expect(result).toBe('value')
    expect(mockSpan.end).toHaveBeenCalledOnce()
    expect(mockSpan.recordException).not.toHaveBeenCalled()
  })

  it('seeds messaging.* attributes so Elastic classifies the transaction (not "unknown")', async () => {
    await runRootSpan('test.span', async () => undefined)
    const [, options] = mockStartActiveSpan.mock.calls[0]!
    expect((options as { attributes?: Record<string, string> }).attributes).toMatchObject({
      'messaging.system': 'airo-agents',
      'messaging.operation': 'process',
    })
  })

  it('records the exception, sets ERROR status, ends, and rethrows on failure', async () => {
    const boom: Error = new Error('boom')
    await expect(runRootSpan('test.span', async () => { throw boom })).rejects.toBe(boom)
    expect(mockSpan.recordException).toHaveBeenCalledWith(boom)
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR })
    expect(mockSpan.end).toHaveBeenCalledOnce()
  })

  it('wraps a non-Error throw in an Error for recordException but rethrows the original', async () => {
    await expect(runRootSpan('test.span', async () => { throw 'string-failure' })).rejects.toBe('string-failure')
    const recorded: unknown = mockSpan.recordException.mock.calls[0]![0]
    expect(recorded).toBeInstanceOf(Error)
    expect((recorded as Error).message).toBe('string-failure')
  })
})

describe('runRootSpanBackground', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs fn and ends the span without throwing', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    runRootSpanBackground('bg.span', fn)
    await vi.waitFor(() => expect(mockSpan.end).toHaveBeenCalled())
    expect(fn).toHaveBeenCalledOnce()
  })

  it('swallows the rejection and routes it to onError', async () => {
    const boom: Error = new Error('bg boom')
    const onError = vi.fn()
    runRootSpanBackground('bg.span', async () => { throw boom }, onError)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(boom))
    expect(mockSpan.recordException).toHaveBeenCalledWith(boom)
  })

  it('does not produce an unhandled rejection when onError is omitted', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    runRootSpanBackground('bg.span', async () => { throw new Error('silent') })
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })
})
