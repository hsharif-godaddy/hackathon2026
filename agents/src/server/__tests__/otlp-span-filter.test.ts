import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-node'

import {
  OtlpSpanFilterProcessor,
  isAiSpan,
  isCspSpan,
  isDevSupervisorSpan,
} from '../otlp-span-filter.js'

function spanWith(partial: Partial<ReadableSpan>): ReadableSpan {
  return { name: '', attributes: {}, ...partial } as unknown as ReadableSpan
}

describe('isCspSpan', () => {
  it('matches csp.godaddy.com via http.url', () => {
    expect(isCspSpan(spanWith({ attributes: { 'http.url': 'https://csp.godaddy.com/report' } }))).toBe(true)
  })

  it('matches csp.dev-godaddy.com and csp.test-godaddy.com', () => {
    expect(isCspSpan(spanWith({ attributes: { 'http.url': 'https://csp.dev-godaddy.com/r' } }))).toBe(true)
    expect(isCspSpan(spanWith({ attributes: { 'url.full': 'https://csp.test-godaddy.com/r' } }))).toBe(true)
  })

  it('does not match when csp host appears only in the query string', () => {
    expect(isCspSpan(spanWith({ attributes: { 'http.url': 'https://api.godaddy.com/redirect?to=https://csp.godaddy.com/x' } }))).toBe(false)
  })

  it('does not match a hostname that merely contains csp.godaddy.com as a substring', () => {
    expect(isCspSpan(spanWith({ attributes: { 'http.url': 'https://example.com/csp.godaddy.com.report' } }))).toBe(false)
  })

  it('does not match when the URL attribute is missing or non-string', () => {
    expect(isCspSpan(spanWith({ attributes: {} }))).toBe(false)
    expect(isCspSpan(spanWith({ attributes: { 'http.url': 123 } }))).toBe(false)
  })
})

describe('isAiSpan', () => {
  it('matches ai.* span names', () => {
    expect(isAiSpan(spanWith({ name: 'ai.streamText' }))).toBe(true)
    expect(isAiSpan(spanWith({ name: 'ai.streamText.doStream' }))).toBe(true)
    expect(isAiSpan(spanWith({ name: 'ai.toolCall' }))).toBe(true)
  })

  it('does not match non-ai span names', () => {
    expect(isAiSpan(spanWith({ name: 'POST api.test-godaddy.com/gocode/v1/messages' }))).toBe(false)
    expect(isAiSpan(spanWith({ name: 'SSE Message: develop' }))).toBe(false)
  })

  it('is dot-anchored — a name merely starting with "ai" is not matched', () => {
    expect(isAiSpan(spanWith({ name: 'airflow.run' }))).toBe(false)
    expect(isAiSpan(spanWith({ name: 'ai' }))).toBe(false)
    expect(isAiSpan(spanWith({ name: 'ai.' }))).toBe(true)
  })
})

describe('isDevSupervisorSpan', () => {
  it('matches localhost (no port) dev-supervisor API prefixes', () => {
    expect(isDevSupervisorSpan(spanWith({ name: 'POST localhost/workspace/files/view' }))).toBe(true)
    expect(isDevSupervisorSpan(spanWith({ name: 'POST localhost/tasks' }))).toBe(true)
    expect(isDevSupervisorSpan(spanWith({ name: 'GET localhost/health' }))).toBe(true)
  })

  it('does not match customer-app preview spans (localhost WITH a port)', () => {
    expect(isDevSupervisorSpan(spanWith({ name: 'GET localhost:3000/api/products' }))).toBe(false)
  })

  it('does not match unknown first path segments on localhost', () => {
    expect(isDevSupervisorSpan(spanWith({ name: 'POST localhost/api/products' }))).toBe(false)
  })

  it('matches on the exact first segment, not a prefix near-miss', () => {
    // "healthz" is not "health" — the first path segment must match a known prefix exactly.
    expect(isDevSupervisorSpan(spanWith({ name: 'GET localhost/healthz' }))).toBe(false)
    expect(isDevSupervisorSpan(spanWith({ name: 'POST localhost/workspaces/x' }))).toBe(false)
  })

  it('does not match external hosts that share a prefix path', () => {
    expect(isDevSupervisorSpan(spanWith({ name: 'POST api.test-godaddy.com/process' }))).toBe(false)
  })
})

describe('OtlpSpanFilterProcessor', () => {
  let delegate: SpanProcessor
  let processor: OtlpSpanFilterProcessor

  beforeEach(() => {
    delegate = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
      forceFlush: vi.fn().mockResolvedValue(undefined),
    }
    processor = new OtlpSpanFilterProcessor(delegate, [isCspSpan, isAiSpan, isDevSupervisorSpan])
  })

  it('forwards a span matching none of the predicates', () => {
    const span: ReadableSpan = spanWith({ name: 'POST api.test-godaddy.com/gocode/v1/messages', attributes: { 'http.url': 'https://api.test-godaddy.com/gocode/v1/messages' } })
    processor.onEnd(span)
    expect(delegate.onEnd).toHaveBeenCalledWith(span)
  })

  it('drops a span matching any predicate', () => {
    processor.onEnd(spanWith({ name: 'ai.streamText.doStream' }))
    processor.onEnd(spanWith({ name: 'POST localhost/workspace/files/view' }))
    processor.onEnd(spanWith({ attributes: { 'http.url': 'https://csp.godaddy.com/report' } }))
    expect(delegate.onEnd).not.toHaveBeenCalled()
  })

  it('delegates onStart, shutdown, and forceFlush', async () => {
    const span = {} as unknown as Parameters<SpanProcessor['onStart']>[0]
    const ctx = {} as unknown as Parameters<SpanProcessor['onStart']>[1]
    processor.onStart(span, ctx)
    expect(delegate.onStart).toHaveBeenCalledWith(span, ctx)
    await processor.shutdown()
    expect(delegate.shutdown).toHaveBeenCalled()
    await processor.forceFlush()
    expect(delegate.forceFlush).toHaveBeenCalled()
  })
})
