import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { retryWithBackoff, DEFAULT_RETRY_CONFIG, hasRetryMetadata, getRetryMetadata, isRetryableError } from '../retry-with-backoff.js'
import { createNetworkError, createRateLimitError, createServerError, createAuthError, createBadRequestError, createServiceUnavailableError, createFailingFunction, createTransientBadRequestError, createToolValidationError } from './test-helpers.js'

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
})
