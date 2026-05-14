import { describe, it, expect, vi } from 'vitest'
import { formatSSEEvent, formatStreamErrorFallback, safeFormatSSEEvent } from '../sse-format.js'

describe('formatSSEEvent', () => {
  it('emits event + data without id when id is omitted', () => {
    const text = formatSSEEvent('chunk', { content: 'hi' })
    expect(text).toBe('event: chunk\ndata: {"content":"hi"}\n\n')
  })

  it('emits id line when id is provided (including 0)', () => {
    expect(formatSSEEvent('chunk', { c: 1 }, 42)).toContain('id: 42\n')
    expect(formatSSEEvent('chunk', { c: 1 }, 0)).toContain('id: 0\n')
  })

  it('throws for BigInt values (JSON.stringify contract)', () => {
    expect(() => formatSSEEvent('chunk', { big: BigInt(1) })).toThrow()
  })
})

describe('safeFormatSSEEvent', () => {
  it('returns the formatted string for serializable payloads', () => {
    expect(safeFormatSSEEvent('chunk', { c: 'x' }, 1))
      .toBe('id: 1\nevent: chunk\ndata: {"c":"x"}\n\n')
  })

  it('returns null and logs on BigInt payloads', () => {
    const warn = vi.fn()
    const out = safeFormatSSEEvent('chunk', { big: BigInt(1) }, 5, { warn })
    expect(out).toBeNull()
    expect(warn).toHaveBeenCalledWith('sse.format_failed', expect.objectContaining({
      kind: 'chunk', sequence: 5,
    }))
  })

  it('returns null and logs on circular references', () => {
    const warn = vi.fn()
    const data: Record<string, unknown> = { a: 1 }
    data.self = data
    const out = safeFormatSSEEvent('chunk', data, undefined, { warn })
    expect(out).toBeNull()
    expect(warn).toHaveBeenCalledWith('sse.format_failed', expect.any(Object))
  })

  it('merges context into the log payload', () => {
    const warn = vi.fn()
    safeFormatSSEEvent('chunk', { big: BigInt(1) }, undefined, { warn }, {
      conversationId: 'conv_1', appId: 'app_1',
    })
    expect(warn).toHaveBeenCalledWith('sse.format_failed', expect.objectContaining({
      conversationId: 'conv_1', appId: 'app_1',
    }))
  })

  it('does not throw when logger is absent', () => {
    expect(() => safeFormatSSEEvent('chunk', { big: BigInt(1) })).not.toThrow()
  })
})

describe('formatStreamErrorFallback', () => {
  it('formats a stream_error frame carrying the original kind and sequence', () => {
    const text = formatStreamErrorFallback('chunk', 42)
    expect(text).toContain('id: 42\n')
    expect(text).toContain('event: stream_error\n')
    expect(text).toContain('"error":"event_format_failed"')
    expect(text).toContain('"kind":"chunk"')
    expect(text).toContain('"sequence":42')
  })

  it('produces a primitive-only payload that cannot itself fail JSON.stringify', () => {
    // Sanity: the fallback formatter is the last line of defence — exercising
    // it on every event type must not throw.
    expect(() => formatStreamErrorFallback('chunk', 0)).not.toThrow()
    expect(() => formatStreamErrorFallback('tool_input_delta', 999_999)).not.toThrow()
  })
})
