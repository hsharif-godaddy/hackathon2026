import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { retryWithBackoff, DEFAULT_RETRY_CONFIG, hasRetryMetadata, getRetryMetadata, isRetryableError, classifyError } from '../retry-with-backoff.js'
import { createNetworkError, createRateLimitError, createServerError, createAuthError, createBadRequestError, createServiceUnavailableError, createFailingFunction, createTransientBadRequestError, createToolValidationError, createAPICallErrorWithHeaders } from './test-helpers.js'

describe('retry-with-backoff simplified', () => {
  let events: { info: any[]; warn: any[]; error: any[] }
  let logger: { info: (e: string, d: unknown) => void; warn: (e: string, d: unknown) => void; error: (e: string, d: unknown) => void }

  beforeEach(() => {
    vi.useFakeTimers()
    events = { info: [], warn: [], error: [] }
    logger = {
      info: (e, d) => events.info.push({ e, d }),
      warn: (e, d) => events.warn.push({ e, d }),
      error: (e, d) => events.error.push({ e, d })
    }
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('success without retry logs nothing', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const res = await retryWithBackoff(fn, DEFAULT_RETRY_CONFIG, { operation: 'generate', logger })
    expect(res).toBe('ok')
    expect(events.warn).toHaveLength(0)
    expect(events.info).toHaveLength(0)
    expect(events.error).toHaveLength(0)
  })

  it('single transient failure then success emits warn then info', async () => {
    const fn = createFailingFunction(1, () => createNetworkError('ECONNRESET'), 'done')
    const resPromise = retryWithBackoff(fn, DEFAULT_RETRY_CONFIG, { operation: 'generate', logger })
    await vi.runAllTimersAsync()
    const res = await resPromise
    expect(res).toBe('done')
    expect(events.warn).toHaveLength(1)
    expect(events.info).toHaveLength(1)
    expect(events.error).toHaveLength(0)
  })

  it('exhausts retries and attaches metadata', async () => {
    const fn = vi.fn().mockRejectedValue(createNetworkError())
    const p = retryWithBackoff(fn, DEFAULT_RETRY_CONFIG, { operation: 'generate', logger })
    const caught = p.catch(e => e)
    await vi.runAllTimersAsync()
    const err = await caught
    expect(events.error).toHaveLength(1)
    expect(hasRetryMetadata(err)).toBe(true)
    const meta = getRetryMetadata(err)
    expect(meta?.attempts).toBe(DEFAULT_RETRY_CONFIG.maxAttempts)
    expect(meta?.category).toBe('transient')
  })

  it('does not retry non-retryable client error', async () => {
    const auth = createAuthError(401)
    const fn = vi.fn().mockRejectedValue(auth)
    const p = retryWithBackoff(fn, DEFAULT_RETRY_CONFIG, { operation: 'generate', logger })
    // Attach handler early to avoid unhandled rejection warnings
    const caught = p.catch(e => e)
    await vi.runAllTimersAsync()
    const err = await caught
    if (err instanceof Error) {
      expect(err.message).toContain('Authentication failed')
    } else {
      throw new Error('Expected an Error instance')
    }
    expect(fn).toHaveBeenCalledTimes(1)
    expect(events.error).toHaveLength(1)
    expect(events.warn).toHaveLength(0)
  })

  it('rate limit retries then succeeds', async () => {
    const fn = createFailingFunction(2, () => createRateLimitError(), 'ok')
    const p = retryWithBackoff(fn, DEFAULT_RETRY_CONFIG, { operation: 'generate', logger })
    await vi.runAllTimersAsync()
    const res = await p
    expect(res).toBe('ok')
    expect(events.warn.length).toBe(2)
    expect(events.info.length).toBe(1)
  })

  it('server 503 retried', async () => {
    const fn = createFailingFunction(1, () => createServerError(503), 'ok')
    const p = retryWithBackoff(fn, DEFAULT_RETRY_CONFIG, { operation: 'generate', logger })
    await vi.runAllTimersAsync()
    const res = await p
    expect(res).toBe('ok')
    expect(events.warn).toHaveLength(1)
  })

  it('service unavailable retried', async () => {
    const fn = createFailingFunction(1, () => createServiceUnavailableError(), 'ok')
    const p = retryWithBackoff(fn, DEFAULT_RETRY_CONFIG, { operation: 'generate', logger })
    await vi.runAllTimersAsync()
    const res = await p
    expect(res).toBe('ok')
    expect(events.warn).toHaveLength(1)
  })

  it('isRetryableError helper matches expectations', () => {
    expect(isRetryableError(createNetworkError())).toBe(true)
    expect(isRetryableError(createRateLimitError())).toBe(true)
    expect(isRetryableError(createServerError(500))).toBe(true)
    expect(isRetryableError(createAuthError(401))).toBe(false)
    // Note: createBadRequestError('Bad request') is now retryable as a transient 400
    // Use a non-matching message for non-retryable 400 test
    expect(isRetryableError(createBadRequestError('Invalid parameter value'))).toBe(false)
  })

  it('transient 400 "Bad Request" is retried', async () => {
    const fn = createFailingFunction(1, () => createTransientBadRequestError('Bad Request'), 'ok')
    const p = retryWithBackoff(fn, DEFAULT_RETRY_CONFIG, { operation: 'generate', logger })
    await vi.runAllTimersAsync()
    const res = await p
    expect(res).toBe('ok')
    expect(events.warn).toHaveLength(1)
    expect(events.info).toHaveLength(1)
  })

  it('tool validation 400 is NOT retried', async () => {
    const fn = vi.fn().mockRejectedValue(createToolValidationError())
    const p = retryWithBackoff(fn, DEFAULT_RETRY_CONFIG, { operation: 'generate', logger })
    const caught = p.catch(e => e)
    await vi.runAllTimersAsync()
    const err = await caught
    expect(fn).toHaveBeenCalledTimes(1)
    expect(events.error).toHaveLength(1)
    expect(events.warn).toHaveLength(0)
    expect(err.message).toContain('toolUse.input')
  })

  it('isRetryableError identifies transient vs non-transient 400s', () => {
    // Transient 400 (generic "Bad Request") should be retryable
    expect(isRetryableError(createTransientBadRequestError('Bad Request'))).toBe(true)

    // Non-transient 400s should NOT be retryable
    expect(isRetryableError(createBadRequestError('Invalid parameter'))).toBe(false)
    expect(isRetryableError(createToolValidationError())).toBe(false)
  })

  it('terminated connection errors are retryable', () => {
    // "terminated" with word boundary should be retryable
    const terminatedError = new Error('fetch failed: terminated')
    expect(isRetryableError(terminatedError)).toBe(true)
    expect(classifyError(terminatedError).category).toBe('transient')

    // "other side closed" should be retryable
    const otherSideClosedError = new Error('other side closed')
    expect(isRetryableError(otherSideClosedError)).toBe(true)
    expect(classifyError(otherSideClosedError).category).toBe('transient')
  })

  it('unterminated errors are NOT retryable (false positive prevention)', () => {
    // "unterminated" should NOT match the word-boundary pattern
    const unterminatedStringError = new Error('SyntaxError: unterminated string literal')
    expect(isRetryableError(unterminatedStringError)).toBe(false)

    const unterminatedEscapeError = new Error('TypeError: unterminated escape sequence')
    expect(isRetryableError(unterminatedEscapeError)).toBe(false)
  })

  it('terminated connection error is retried and succeeds', async () => {
    const fn = createFailingFunction(1, () => new Error('fetch failed: terminated'), 'ok')
    const p = retryWithBackoff(fn, DEFAULT_RETRY_CONFIG, { operation: 'generate', logger })
    await vi.runAllTimersAsync()
    const res = await p
    expect(res).toBe('ok')
    expect(events.warn).toHaveLength(1)
    expect(events.info).toHaveLength(1)
  })
})

describe('retry-after header support', () => {
  let events: { info: any[]; warn: any[]; error: any[] }
  let logger: { info: (e: string, d: unknown) => void; warn: (e: string, d: unknown) => void; error: (e: string, d: unknown) => void }

  beforeEach(() => {
    vi.useFakeTimers()
    events = { info: [], warn: [], error: [] }
    logger = {
      info: (e, d) => events.info.push({ e, d }),
      warn: (e, d) => events.warn.push({ e, d }),
      error: (e, d) => events.error.push({ e, d })
    }
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('classifyError extracts retryAfterMs from APICallError headers', () => {
    it('parses retry-after header in seconds', () => {
      const error = createAPICallErrorWithHeaders(429, { 'retry-after': '30' })
      const decision = classifyError(error)
      expect(decision.retryable).toBe(true)
      expect(decision.category).toBe('rate_limit')
      expect(decision.retryAfterMs).toBe(30_000)
    })

    it('parses x-ratelimit-reset-requests duration', () => {
      const error = createAPICallErrorWithHeaders(429, {
        'x-ratelimit-reset-requests': '5s'
      })
      const decision = classifyError(error)
      expect(decision.retryable).toBe(true)
      expect(decision.retryAfterMs).toBe(5_000)
    })

    it('parses x-ratelimit-reset-tokens as fallback', () => {
      const error = createAPICallErrorWithHeaders(429, {
        'x-ratelimit-reset-tokens': '10s'
      })
      const decision = classifyError(error)
      expect(decision.retryable).toBe(true)
      expect(decision.retryAfterMs).toBe(10_000)
    })

    it('prefers retry-after over x-ratelimit-reset-* headers', () => {
      const error = createAPICallErrorWithHeaders(429, {
        'retry-after': '2',
        'x-ratelimit-reset-requests': '60s'
      })
      const decision = classifyError(error)
      expect(decision.retryAfterMs).toBe(2_000) // retry-after wins
    })

    it('prefers x-ratelimit-reset-requests over x-ratelimit-reset-tokens', () => {
      const error = createAPICallErrorWithHeaders(429, {
        'x-ratelimit-reset-requests': '3s',
        'x-ratelimit-reset-tokens': '30s'
      })
      const decision = classifyError(error)
      expect(decision.retryAfterMs).toBe(3_000) // requests wins
    })

    it('prioritizes retry-after > x-ratelimit-reset-requests > x-ratelimit-reset-tokens', () => {
      const error = createAPICallErrorWithHeaders(429, {
        'retry-after': '5',
        'x-ratelimit-reset-requests': '10s',
        'x-ratelimit-reset-tokens': '30s'
      })
      const decision = classifyError(error)
      expect(decision.retryAfterMs).toBe(5_000) // retry-after wins over both
    })

    it('parses fractional duration values', () => {
      const error = createAPICallErrorWithHeaders(429, {
        'x-ratelimit-reset-requests': '1.5s'
      })
      const decision = classifyError(error)
      expect(decision.retryAfterMs).toBe(1_500)
    })

    it('parses minute duration values', () => {
      const error = createAPICallErrorWithHeaders(429, {
        'x-ratelimit-reset-requests': '2m'
      })
      const decision = classifyError(error)
      expect(decision.retryAfterMs).toBe(120_000)
    })

    it('parses ms duration values', () => {
      const error = createAPICallErrorWithHeaders(429, {
        'x-ratelimit-reset-requests': '500ms'
      })
      const decision = classifyError(error)
      expect(decision.retryAfterMs).toBe(500)
    })

    it('returns retryAfterMs for 5xx errors too', () => {
      const error = createAPICallErrorWithHeaders(503, {
        'retry-after': '10'
      })
      const decision = classifyError(error)
      expect(decision.retryable).toBe(true)
      expect(decision.category).toBe('transient')
      expect(decision.retryAfterMs).toBe(10_000)
    })

    it('returns undefined retryAfterMs when no headers present', () => {
      const error = createAPICallErrorWithHeaders(429, {})
      const decision = classifyError(error)
      expect(decision.retryable).toBe(true)
      expect(decision.retryAfterMs).toBeUndefined()
    })
  })

  describe('retryWithBackoff uses server-suggested delay', () => {
    it('uses retry-after header delay instead of exponential backoff', async () => {
      // 429 with retry-after: 2 (seconds) — should wait ~2000ms not exponential backoff
      let attempt = 0
      const fn = async () => {
        attempt++
        if (attempt === 1) {
          throw createAPICallErrorWithHeaders(429, { 'retry-after': '2' })
        }
        return 'ok'
      }

      const p = retryWithBackoff(fn, { ...DEFAULT_RETRY_CONFIG, jitter: false }, { operation: 'generate', logger })
      await vi.runAllTimersAsync()
      const res = await p
      expect(res).toBe('ok')

      // Verify the warn log includes serverRetryAfterMs
      expect(events.warn).toHaveLength(1)
      expect(events.warn[0].d.serverRetryAfterMs).toBe(2_000)
      // With jitter disabled, delay should be exactly the server-suggested value (clamped)
      expect(events.warn[0].d.delayMs).toBe(2_000)
    })

    it('clamps server-suggested delay to maxDelayMs', async () => {
      let attempt = 0
      const fn = async () => {
        attempt++
        if (attempt === 1) {
          throw createAPICallErrorWithHeaders(429, { 'retry-after': '120' }) // 120s > 16s max
        }
        return 'ok'
      }

      const p = retryWithBackoff(
        fn,
        { ...DEFAULT_RETRY_CONFIG, jitter: false, maxDelayMs: 16_000 },
        { operation: 'generate', logger }
      )
      await vi.runAllTimersAsync()
      const res = await p
      expect(res).toBe('ok')

      // Delay should be clamped to maxDelayMs
      expect(events.warn[0].d.delayMs).toBe(16_000)
      expect(events.warn[0].d.serverRetryAfterMs).toBe(120_000)
    })

    it('falls back to exponential backoff when no retry-after header', async () => {
      let attempt = 0
      const fn = async () => {
        attempt++
        if (attempt === 1) {
          throw createAPICallErrorWithHeaders(429, {}) // no retry-after
        }
        return 'ok'
      }

      const p = retryWithBackoff(
        fn,
        { ...DEFAULT_RETRY_CONFIG, jitter: false, baseDelayMs: 1000 },
        { operation: 'generate', logger }
      )
      await vi.runAllTimersAsync()
      const res = await p
      expect(res).toBe('ok')

      // Without server hint, should use exponential backoff (1000ms for first retry)
      expect(events.warn[0].d.serverRetryAfterMs).toBeUndefined()
      expect(events.warn[0].d.delayMs).toBe(1_000)
    })
  })
})
