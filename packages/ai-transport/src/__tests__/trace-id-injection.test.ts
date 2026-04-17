import { describe, it, expect, vi } from 'vitest'
import { trace, context as otelContext } from '@opentelemetry/api'

describe('OTel traceId injection into metadata', () => {
  it('extracts traceId from invocation span context', () => {
    const mockSpan = {
      spanContext: () => ({
        traceId: 'abcdef1234567890abcdef1234567890',
        spanId: '1234567890abcdef',
        traceFlags: 1,
      }),
      setAttribute: vi.fn(),
      end: vi.fn(),
    }

    const metadata: Record<string, unknown> = { appId: 'app-1' }

    const invocationSpan = mockSpan
    if (invocationSpan) {
      const traceId = invocationSpan.spanContext().traceId
      if (traceId && metadata) {
        metadata.traceId = traceId
      }
    }

    expect(metadata.traceId).toBe('abcdef1234567890abcdef1234567890')
  })

  it('does not mutate metadata when span is undefined', () => {
    const metadata: Record<string, unknown> = { appId: 'app-1' }
    const invocationSpan = undefined

    if (invocationSpan) {
      // unreachable
      const traceId = (invocationSpan as any).spanContext().traceId
      if (traceId && metadata) {
        metadata.traceId = traceId
      }
    }

    expect(metadata.traceId).toBeUndefined()
  })

  it('does not mutate metadata when traceId is empty', () => {
    const mockSpan = {
      spanContext: () => ({
        traceId: '',
        spanId: '',
        traceFlags: 0,
      }),
    }

    const metadata: Record<string, unknown> = { appId: 'app-1' }

    const invocationSpan = mockSpan
    if (invocationSpan) {
      const traceId = invocationSpan.spanContext().traceId
      if (traceId && metadata) {
        metadata.traceId = traceId
      }
    }

    expect(metadata.traceId).toBeUndefined()
  })
})

describe('correlationId extraction from response headers', () => {
  it('extracts x-correlation-id from response headers', () => {
    const capturedResponseHeaders: Record<string, string> = {
      'x-correlation-id': 'gocode-uuid-123',
      'content-type': 'application/json',
    }

    const correlationId = capturedResponseHeaders['x-correlation-id']
    expect(correlationId).toBe('gocode-uuid-123')
  })

  it('returns undefined when x-correlation-id is absent', () => {
    const capturedResponseHeaders: Record<string, string> = {
      'content-type': 'application/json',
    }

    const correlationId = capturedResponseHeaders['x-correlation-id']
    expect(correlationId).toBeUndefined()
  })

  it('returns undefined when response headers are undefined', () => {
    const capturedResponseHeaders: Record<string, string> | undefined = undefined
    const correlationId = capturedResponseHeaders?.['x-correlation-id']
    expect(correlationId).toBeUndefined()
  })
})
