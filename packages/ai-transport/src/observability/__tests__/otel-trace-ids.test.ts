import { describe, it, expect, vi, afterEach } from 'vitest'
import { trace } from '@opentelemetry/api'
import { getCurrentTraceIds } from '../otel-trace-ids.js'

describe('getCurrentTraceIds', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns trace and observation IDs from the active span', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
      spanContext: () => ({
        traceId: 'abcdef1234567890abcdef1234567890',
        spanId: '1234567890abcdef',
        traceFlags: 1,
      }),
    } as unknown as ReturnType<typeof trace.getActiveSpan>)

    expect(getCurrentTraceIds()).toEqual({
      traceId: 'abcdef1234567890abcdef1234567890',
      observationId: '1234567890abcdef',
    })
  })

  it('returns undefined when no span is active', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined)
    expect(getCurrentTraceIds()).toBeUndefined()
  })

  it('passes through even all-zero IDs from a no-op span so consumers can decide what to do with them', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
      spanContext: () => ({
        traceId: '0'.repeat(32),
        spanId: '0'.repeat(16),
        traceFlags: 0,
      }),
    } as unknown as ReturnType<typeof trace.getActiveSpan>)

    expect(getCurrentTraceIds()).toEqual({
      traceId: '0'.repeat(32),
      observationId: '0'.repeat(16),
    })
  })
})
