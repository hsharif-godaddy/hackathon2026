import { describe, it, expect } from 'vitest'
import { TypeValidationError } from 'ai'
import { analyzeStreamError, isNetworkError, isUpstreamTimeoutError } from '../analyze-stream-error.js'

describe('isNetworkError', () => {
  it('returns false for null/undefined', () => {
    expect(isNetworkError(null)).toBe(false)
    expect(isNetworkError(undefined)).toBe(false)
  })

  it('recognizes known undici codes on the error itself', () => {
    const err = Object.assign(new Error('x'), { code: 'UND_ERR_SOCKET' })
    expect(isNetworkError(err)).toBe(true)
  })

  it('recognizes known undici codes on error.cause.code', () => {
    const err = Object.assign(new Error('x'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })
    expect(isNetworkError(err)).toBe(true)
  })

  it('recognizes TypeError with "terminated" in message', () => {
    const err = new TypeError('fetch failed: terminated')
    expect(isNetworkError(err)).toBe(true)
  })

  it('recognizes FetchError and SocketError by name', () => {
    expect(isNetworkError(Object.assign(new Error('x'), { name: 'FetchError' }))).toBe(true)
    expect(isNetworkError(Object.assign(new Error('x'), { name: 'SocketError' }))).toBe(true)
  })

  it('recognizes "other side closed" / "content-length" in messages', () => {
    expect(isNetworkError(new Error('other side closed'))).toBe(true)
    expect(isNetworkError(new Error('content-length mismatch'))).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isNetworkError(new Error('nothing to see'))).toBe(false)
  })
})

describe('analyzeStreamError', () => {
  it('classifies abort errors before network errors', () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const info = analyzeStreamError(err)
    expect(info.type).toBe('AbortError')
    expect(info.isAbortError).toBe(true)
    expect(info.isNetworkError).toBe(false)
  })

  it('classifies network errors when not aborted', () => {
    const err = Object.assign(new Error('terminated'), { name: 'TypeError', code: 'UND_ERR_SOCKET' })
    const info = analyzeStreamError(err)
    expect(info.type).toBe('NetworkError')
    expect(info.isNetworkError).toBe(true)
    expect(info.code).toBe('UND_ERR_SOCKET')
  })

  it('falls back to error name for generic errors', () => {
    class DomainError extends Error {
      override name = 'DomainError'
    }
    const info = analyzeStreamError(new DomainError('x'))
    expect(info.type).toBe('DomainError')
    expect(info.isAbortError).toBe(false)
    expect(info.isNetworkError).toBe(false)
  })

  it('walks the cause chain up to 5 levels', () => {
    const deepest = Object.assign(new Error('root'), { code: 'UND_ERR_SOCKET' })
    let chain: Error = deepest
    for (let i = 0; i < 10; i++) {
      chain = Object.assign(new Error(`level-${i}`), { cause: chain })
    }
    const info = analyzeStreamError(chain)
    expect(info.causeChain).toHaveLength(5)
  })

  it('handles plain-object causes with code/message/name (undici shape)', () => {
    const err = Object.assign(new Error('outer'), {
      cause: { name: 'SocketError', code: 'UND_ERR_SOCKET', message: 'closed' },
    })
    const info = analyzeStreamError(err)
    expect(info.causeChain[0]).toBe('SocketError: closed [UND_ERR_SOCKET]')
  })

  it('breaks on string causes', () => {
    const err = Object.assign(new Error('outer'), { cause: 'raw string reason' })
    const info = analyzeStreamError(err)
    expect(info.causeChain).toEqual(['raw string reason'])
  })

  it('extracts statusCode and truncates responseBody to 500 chars', () => {
    const long = 'a'.repeat(600)
    const err = Object.assign(new Error('api'), { statusCode: 503, responseBody: long })
    const info = analyzeStreamError(err)
    expect(info.statusCode).toBe(503)
    expect(info.responseBody).toHaveLength(500)
  })

  it('ignores non-string responseBody', () => {
    const err = Object.assign(new Error('api'), { responseBody: { nested: true } })
    const info = analyzeStreamError(err)
    expect(info.responseBody).toBeUndefined()
  })

  it('accepts non-Error throws', () => {
    const info = analyzeStreamError('plain string')
    expect(info.message).toBe('plain string')
    expect(info.type).toBe('UnknownError')
  })

  it('surfaces the offending chunk as validationValue for a TypeValidationError', () => {
    // The exact non-standard SSE chunk that failed the provider's
    // discriminatedUnion lives on TypeValidationError.value — the one
    // diagnostic that pins down which upstream chunk broke the stream.
    const chunk = { type: 'internalServerException', message: 'boom' }
    const err = new TypeValidationError({ value: chunk, cause: new Error('No matching discriminator') })
    const info = analyzeStreamError(err)
    expect(info.validationValue).toBe(JSON.stringify(chunk))
  })

  it('truncates validationValue to 1000 chars', () => {
    const chunk = { type: 'x', blob: 'a'.repeat(2000) }
    const err = new TypeValidationError({ value: chunk, cause: new Error('No matching discriminator') })
    const info = analyzeStreamError(err)
    expect(info.validationValue).toHaveLength(1000)
  })

  it('leaves validationValue undefined for non-TypeValidationError', () => {
    expect(analyzeStreamError(new Error('plain')).validationValue).toBeUndefined()
  })

  it('does not throw when cause is a circular-reference object', () => {
    // Node sockets and some undici internals are reachable via error.cause
    // and contain circular refs. JSON.stringify throws on them; the fallback
    // must tolerate that so the whole analyze call doesn't bubble out of
    // the transport's outer catch.
    const circular: Record<string, unknown> = { name: 'Socket' }
    circular.self = circular
    const err = Object.assign(new Error('outer'), { cause: circular })
    const info = analyzeStreamError(err)
    expect(info.causeChain).toHaveLength(1)
    expect(info.causeChain[0]).toBe('Socket: [non-serializable object]')
  })
})

describe('isUpstreamTimeoutError', () => {
  it('returns false for null/undefined', () => {
    expect(isUpstreamTimeoutError(null)).toBe(false)
    expect(isUpstreamTimeoutError(undefined)).toBe(false)
  })

  it('returns true for statusCode 408 (GoCode request timeout)', () => {
    expect(isUpstreamTimeoutError(Object.assign(new Error('request timeout'), { statusCode: 408 }))).toBe(true)
  })

  it('returns true for statusCode 504 (gateway timeout)', () => {
    expect(isUpstreamTimeoutError(Object.assign(new Error('gateway timeout'), { statusCode: 504 }))).toBe(true)
  })

  it('returns false for other status codes', () => {
    expect(isUpstreamTimeoutError(Object.assign(new Error('x'), { statusCode: 400 }))).toBe(false)
    expect(isUpstreamTimeoutError(Object.assign(new Error('x'), { statusCode: 429 }))).toBe(false)
    expect(isUpstreamTimeoutError(Object.assign(new Error('x'), { statusCode: 500 }))).toBe(false)
  })

  it('returns false for a network error with no statusCode', () => {
    expect(isUpstreamTimeoutError(new TypeError('terminated'))).toBe(false)
  })

  it('returns false for a non-error value', () => {
    expect(isUpstreamTimeoutError('just a string')).toBe(false)
  })
})
