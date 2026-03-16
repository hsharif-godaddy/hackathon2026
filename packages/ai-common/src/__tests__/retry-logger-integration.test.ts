import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { retryWithBackoff, DEFAULT_RETRY_CONFIG } from '../retry-with-backoff.js'
import { createNetworkError, createServerError, createFailingFunction } from './test-helpers.js'

/**
 * Tests for structured logger integration with retry logic.
 */

describe('retry logger integration', () => {
  let logger: { info: any; warn: any; error: any }

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('emits warn then success for single transient retry', async () => {
    const fn = createFailingFunction(1, () => createNetworkError('ECONNRESET'), 'ok')
    const promise = retryWithBackoff(fn, DEFAULT_RETRY_CONFIG, {
      operation: 'generate',
      agentName: 'agent-1',
      modelName: 'test-model',
      logger
    })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result).toBe('ok')
    expect(logger.warn).toHaveBeenCalledWith(
      'llm.api_call.retry',
      expect.objectContaining({ attempt: 1, category: 'transient', operation: 'generate' })
    )
    expect(logger.info).toHaveBeenCalledWith(
      'llm.api_call.retry_success',
      expect.objectContaining({ attempt: 2, operation: 'generate' })
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('emits exhaustion after maxAttempts fail', async () => {
    const failing = vi.fn().mockRejectedValue(createServerError(503))
    const promise = retryWithBackoff(failing, { ...DEFAULT_RETRY_CONFIG, maxAttempts: 3 }, {
      operation: 'stream',
      modelName: 'test-model',
      logger
    })
    const caught = promise.catch(e => e)
    await vi.runAllTimersAsync()
    await caught
    expect(logger.warn).toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      'llm.api_call.retry_exhausted',
      expect.objectContaining({ attempt: 3, operation: 'stream', category: 'transient' })
    )
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('emits structured events with provided logger', async () => {
    const fn = createFailingFunction(1, () => createNetworkError(), 'ok')
    const promise = retryWithBackoff(fn, DEFAULT_RETRY_CONFIG, { operation: 'generate', logger })
    await vi.runAllTimersAsync()
    await promise
    expect(logger.warn).toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })
})
