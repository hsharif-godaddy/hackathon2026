import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BudgetExceededError } from '@airo/ai-common'
import {
  withBudgetRecovery,
  invokeBudgetRecoveryCallback,
  buildContinuationPrompt,
  MAX_BUDGET_RETRIES,
} from '../budget-recovery.js'
import type { BudgetRecoveryStreamOptions, BudgetRecoveryCallback } from '../budget-recovery.js'

function createMockOpts(overrides: Partial<BudgetRecoveryStreamOptions> = {}): BudgetRecoveryStreamOptions {
  return {
    sessionId: 'test-session',
    onBudgetExhausted: vi.fn().mockResolvedValue({ retry: true, newUserId: 'grant:new', hasNonIdempotentTools: false }),
    setUserId: vi.fn(),
    getExecutedToolNames: vi.fn().mockReturnValue([]),
    getAccumulatedContent: vi.fn().mockReturnValue(''),
    clearTurnState: vi.fn(),
    publishStreamRetry: vi.fn().mockResolvedValue(undefined),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  }
}

describe('withBudgetRecovery', () => {
  it('passes through successful stream result', async () => {
    const opts = createMockOpts()
    const streamFn = vi.fn().mockResolvedValue('stream-result')

    const result = await withBudgetRecovery(streamFn, 'hello', 'DevelopAgent', opts)

    expect(result).toBe('stream-result')
    expect(opts.onBudgetExhausted).not.toHaveBeenCalled()
  })

  it('passes through non-budget errors without catching', async () => {
    const opts = createMockOpts()
    const streamFn = vi.fn().mockRejectedValue(new Error('network error'))

    await expect(withBudgetRecovery(streamFn, 'hello', 'DevelopAgent', opts)).rejects.toThrow('network error')
    expect(opts.onBudgetExhausted).not.toHaveBeenCalled()
  })

  describe('Layer 2: clean retry', () => {
    it('retries with same prompt when no non-idempotent tools', async () => {
      const budgetError = new BudgetExceededError('budget exceeded', 400, '{}')
      const opts = createMockOpts({
        onBudgetExhausted: vi.fn().mockResolvedValue({ retry: true, newUserId: 'grant:next', hasNonIdempotentTools: false }),
      })
      const streamFn = vi.fn()
        .mockRejectedValueOnce(budgetError)
        .mockResolvedValueOnce('retry-result')

      const result = await withBudgetRecovery(streamFn, 'build a page', 'DevelopAgent', opts)

      expect(result).toBe('retry-result')
      expect(opts.setUserId).toHaveBeenCalledWith('grant:next')
      expect(opts.clearTurnState).toHaveBeenCalled()
      expect(opts.publishStreamRetry).toHaveBeenCalledWith('DevelopAgent')
      expect(streamFn).toHaveBeenCalledTimes(2)
      expect(streamFn).toHaveBeenLastCalledWith('build a page')
    })
  })

  describe('Layer 3: continuation', () => {
    it('retries with continuation prompt when non-idempotent tools ran', async () => {
      const budgetError = new BudgetExceededError('budget exceeded', 400, '{}')
      const opts = createMockOpts({
        onBudgetExhausted: vi.fn().mockResolvedValue({ retry: true, newUserId: 'grant:next', hasNonIdempotentTools: true }),
        getExecutedToolNames: vi.fn().mockReturnValue(['commerce__manage_products']),
        getAccumulatedContent: vi.fn().mockReturnValue('partial output'),
      })
      const streamFn = vi.fn()
        .mockRejectedValueOnce(budgetError)
        .mockResolvedValueOnce('continuation-result')

      const result = await withBudgetRecovery(streamFn, 'publish products', 'DevelopAgent', opts)

      expect(result).toBe('continuation-result')
      expect(opts.setUserId).toHaveBeenCalledWith('grant:next')
      expect(opts.clearTurnState).toHaveBeenCalled()
      expect(opts.publishStreamRetry).not.toHaveBeenCalled()
      const continuationPrompt = streamFn.mock.calls[1][0] as string
      expect(continuationPrompt).toContain('publish products')
      expect(continuationPrompt).toContain('commerce__manage_products')
      expect(continuationPrompt).toContain('Continue the task')
    })
  })

  describe('retry limits', () => {
    it('re-throws after MAX_BUDGET_RETRIES attempts', async () => {
      const budgetError = new BudgetExceededError('budget exceeded', 400, '{}')
      const opts = createMockOpts()
      const streamFn = vi.fn().mockRejectedValue(budgetError)

      await expect(
        withBudgetRecovery(streamFn, 'hello', 'DevelopAgent', opts, MAX_BUDGET_RETRIES)
      ).rejects.toThrow()

      expect(opts.onBudgetExhausted).not.toHaveBeenCalled()
    })

    it('retries up to MAX_BUDGET_RETRIES times before giving up', async () => {
      const budgetError = new BudgetExceededError('budget exceeded', 400, '{}')
      const opts = createMockOpts()
      const streamFn = vi.fn().mockRejectedValue(budgetError)

      await expect(
        withBudgetRecovery(streamFn, 'hello', 'DevelopAgent', opts, 0)
      ).rejects.toThrow()

      // Called MAX_BUDGET_RETRIES times (retries 0, 1, 2 then hits cap at 3)
      expect(opts.onBudgetExhausted).toHaveBeenCalledTimes(MAX_BUDGET_RETRIES)
    })
  })

  describe('callback failure', () => {
    it('re-throws original error when callback returns retry=false', async () => {
      const budgetError = new BudgetExceededError('budget exceeded', 400, '{}')
      const opts = createMockOpts({
        onBudgetExhausted: vi.fn().mockResolvedValue({ retry: false, hasNonIdempotentTools: false }),
      })
      const streamFn = vi.fn().mockRejectedValue(budgetError)

      await expect(
        withBudgetRecovery(streamFn, 'hello', 'DevelopAgent', opts)
      ).rejects.toThrow('budget exceeded')
    })

    it('re-throws original error and logs error-level contract violation when retry=true but no newUserId', async () => {
      const budgetError = new BudgetExceededError('budget exceeded', 400, '{}')
      const opts = createMockOpts({
        onBudgetExhausted: vi.fn().mockResolvedValue({ retry: true, hasNonIdempotentTools: false }),
      })
      const streamFn = vi.fn().mockRejectedValue(budgetError)

      await expect(
        withBudgetRecovery(streamFn, 'hello', 'DevelopAgent', opts)
      ).rejects.toThrow('budget exceeded')

      expect(opts.logger.error).toHaveBeenCalledWith(
        'budget.mid_stream.retry_true_no_userid',
        expect.objectContaining({ sessionId: 'test-session', agentName: 'DevelopAgent' })
      )
    })

    it('re-throws original error when callback throws', async () => {
      const budgetError = new BudgetExceededError('budget exceeded', 400, '{}')
      const opts = createMockOpts({
        onBudgetExhausted: vi.fn().mockRejectedValue(new Error('callback failed')),
      })
      const streamFn = vi.fn().mockRejectedValue(budgetError)

      await expect(
        withBudgetRecovery(streamFn, 'hello', 'DevelopAgent', opts)
      ).rejects.toThrow('budget exceeded')

      expect(opts.logger.error).toHaveBeenCalledWith(
        'budget.mid_stream.callback_error',
        expect.objectContaining({ error: 'callback failed' })
      )
    })
  })
})

describe('invokeBudgetRecoveryCallback', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

  it('returns callback result on success', async () => {
    const callback: BudgetRecoveryCallback = vi.fn().mockResolvedValue({
      retry: true, newUserId: 'grant:1', hasNonIdempotentTools: false,
    })

    const result = await invokeBudgetRecoveryCallback(callback, 'sess-1', new Error('test'), ['readFile'], logger)

    expect(result).toEqual({ retry: true, newUserId: 'grant:1', hasNonIdempotentTools: false })
  })

  it('returns null when callback throws (non-timeout)', async () => {
    const callback: BudgetRecoveryCallback = vi.fn().mockRejectedValue(new Error('internal'))

    const result = await invokeBudgetRecoveryCallback(callback, 'sess-1', new Error('test'), [], logger)

    expect(result).toBeNull()
    expect(logger.error).toHaveBeenCalledWith(
      'budget.mid_stream.callback_error',
      expect.objectContaining({ sessionId: 'sess-1', error: 'internal' })
    )
  })

  it('returns null on timeout and logs callback_timeout with timeoutMs', async () => {
    const callback: BudgetRecoveryCallback = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 20_000))
    )

    vi.useFakeTimers()
    const promise = invokeBudgetRecoveryCallback(callback, 'sess-1', new Error('test'), [], logger)
    await vi.advanceTimersByTimeAsync(10_001)
    const result = await promise
    vi.useRealTimers()

    expect(result).toBeNull()
    expect(logger.error).toHaveBeenCalledWith(
      'budget.mid_stream.callback_timeout',
      expect.objectContaining({ sessionId: 'sess-1', timeoutMs: 10_000 })
    )
  })

  it('returns null on non-timeout error and logs callback_error', async () => {
    const callback: BudgetRecoveryCallback = vi.fn().mockRejectedValue(new Error('DB connection lost'))

    const result = await invokeBudgetRecoveryCallback(callback, 'sess-1', new Error('test'), [], logger)

    expect(result).toBeNull()
    expect(logger.error).toHaveBeenCalledWith(
      'budget.mid_stream.callback_error',
      expect.objectContaining({ sessionId: 'sess-1', error: 'DB connection lost' })
    )
  })
})

describe('buildContinuationPrompt', () => {
  it('includes original prompt', () => {
    const prompt = buildContinuationPrompt('build a page', [], '')
    expect(prompt).toContain('build a page')
  })

  it('includes tool names when present', () => {
    const prompt = buildContinuationPrompt('test', ['toolA', 'toolB'], '')
    expect(prompt).toContain('toolA, toolB')
    expect(prompt).toContain('Do not re-execute them')
  })

  it('includes partial content truncated to 500 chars', () => {
    const longContent = 'a'.repeat(1000)
    const prompt = buildContinuationPrompt('test', [], longContent)
    expect(prompt).toContain('a'.repeat(500))
    expect(prompt.indexOf('a'.repeat(501))).toBe(-1)
  })

  it('omits tool/content sections when empty', () => {
    const prompt = buildContinuationPrompt('test', [], '')
    expect(prompt).not.toContain('tool calls')
    expect(prompt).not.toContain('partial response')
    expect(prompt).toContain('Continue the task')
  })
})

describe('MAX_BUDGET_RETRIES', () => {
  it('is 3', () => {
    expect(MAX_BUDGET_RETRIES).toBe(3)
  })
})
