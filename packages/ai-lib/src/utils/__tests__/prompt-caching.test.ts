/**
 * Tests for prompt-caching.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn()
}))

vi.mock('@airo/ai-common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@airo/ai-common')>()
  return {
    ...actual,
    createLogger: () => mockLogger
  }
})

import {
  addCacheControlToMessages,
  logCachingStats,
  estimateCachingSavings,
  supportsPromptCaching
} from '../prompt-caching.js'
import type { ModelMessage, LanguageModel } from 'ai'

// Helper to create a mock Anthropic model
function createMockModel(provider = 'anthropic', modelId = 'claude-3-5-sonnet-20241022'): LanguageModel {
  return { provider, modelId, doGenerate: vi.fn(), doStream: vi.fn() } as any
}

// Helper to create a message with pre-set cache control
function cachedMessage(role: 'user' | 'assistant' | 'system', content: string): ModelMessage {
  return {
    role,
    content,
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
      bedrock: { cachePoint: 'ephemeral' }
    }
  } as any
}

describe('addCacheControlToMessages', () => {
  const model = createMockModel()

  describe('breakpoint overflow guard', () => {
    it('should skip adding breakpoints when existing breakpoints reach the limit', () => {
      // 3 pre-cached messages + 1 reserved for system prompt = 4 (at limit)
      const messages: ModelMessage[] = [
        cachedMessage('user', 'operation log'),
        cachedMessage('user', 'conversation summary'),
        cachedMessage('user', 'context attachment'),
        { role: 'user', content: 'current message' } as any
      ]

      const result = addCacheControlToMessages(messages, model, { cacheSystemPrompts: true })

      // Should return messages unchanged — no new breakpoints added
      expect(result).toBe(messages)
    })

    it('should add breakpoints when under the limit with pre-existing breakpoints', () => {
      // 1 pre-cached message + 1 reserved for system prompt = 2 used, 2 remaining
      const messages: ModelMessage[] = [
        cachedMessage('user', 'summary'),
        { role: 'user', content: 'history message' } as any,
        { role: 'assistant', content: 'response' } as any,
        { role: 'user', content: 'current message' } as any
      ]

      const result = addCacheControlToMessages(messages, model, { cacheSystemPrompts: true })

      // Should add a breakpoint on the last message
      const lastMsg = result[result.length - 1] as any
      expect(lastMsg.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })
    })

    it('should allow more breakpoints when system prompt caching is disabled', () => {
      // 3 pre-cached messages + 0 reserved for system = 3 used, 1 remaining
      const messages: ModelMessage[] = [
        cachedMessage('user', 'operation log'),
        cachedMessage('user', 'conversation summary'),
        cachedMessage('user', 'context attachment'),
        { role: 'user', content: 'current message' } as any
      ]

      const result = addCacheControlToMessages(messages, model, { cacheSystemPrompts: false })

      // Should add 1 breakpoint on last message (1 remaining slot)
      const lastMsg = result[result.length - 1] as any
      expect(lastMsg.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })
    })

    it('should not add breakpoints when at exactly 4 pre-existing', () => {
      const messages: ModelMessage[] = [
        cachedMessage('user', 'a'),
        cachedMessage('user', 'b'),
        cachedMessage('user', 'c'),
        cachedMessage('user', 'd'),
        { role: 'user', content: 'uncached' } as any
      ]

      const result = addCacheControlToMessages(messages, model, { cacheSystemPrompts: false })

      // Already at 4, should return unchanged
      expect(result).toBe(messages)
    })

    it('should not count non-cached messages as existing breakpoints', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: 'no cache' } as any,
        { role: 'assistant', content: 'response' } as any,
        { role: 'user', content: 'current' } as any
      ]

      const result = addCacheControlToMessages(messages, model, { cacheSystemPrompts: false })

      // 0 existing + 0 system = 4 remaining, should add breakpoint on last message
      const lastMsg = result[result.length - 1] as any
      expect(lastMsg.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })
    })
  })
})

describe('logCachingStats', () => {
  beforeEach(() => {
    mockLogger.info.mockClear()
  })

  it('should log stats when inputTokenDetails.cacheWriteTokens is present (cache miss)', () => {
    logCachingStats({
      inputTokens: 5000,
      outputTokens: 1000,
      totalTokens: 6000,
      inputTokenDetails: {
        cacheReadTokens: 0,
        cacheWriteTokens: 4000,
        noCacheTokens: 1000
      }
    })

    expect(mockLogger.info).toHaveBeenCalledWith('prompt_caching.stats', expect.objectContaining({
      noCacheTokens: 1000,
      cacheWriteTokens: 4000,
      cacheReadTokens: 0,
      totalInputTokens: 5000
    }))
  })

  it('should not log when both read and write tokens are zero', () => {
    logCachingStats({
      inputTokens: 5000,
      outputTokens: 1000,
      totalTokens: 6000,
      inputTokenDetails: {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        noCacheTokens: 5000
      }
    })

    expect(mockLogger.info).not.toHaveBeenCalled()
  })

  it('should fall back to deprecated cachedInputTokens when inputTokenDetails is absent', () => {
    logCachingStats({
      inputTokens: 5000,
      outputTokens: 1000,
      totalTokens: 6000,
      cachedInputTokens: 3000
    })

    expect(mockLogger.info).toHaveBeenCalledWith('prompt_caching.stats', expect.objectContaining({
      cacheReadTokens: 3000,
      cacheWriteTokens: 0,
      totalInputTokens: 5000
    }))
  })

  it('should not log when cachedInputTokens and inputTokenDetails are both undefined', () => {
    logCachingStats({
      inputTokens: 5000,
      outputTokens: 1000,
      totalTokens: 6000,
      cachedInputTokens: undefined,
      inputTokenDetails: undefined
    })

    expect(mockLogger.info).not.toHaveBeenCalled()
  })
})

describe('estimateCachingSavings', () => {
  it('should not double-charge cache write tokens', () => {
    // 10000 total: 5000 read, 3000 write, 2000 uncached
    const result = estimateCachingSavings(10000, 5000, 3000)

    // uncachedTokens = 10000 - 5000 - 3000 = 2000
    // costWithCaching = (2000/1M * 3.00) + (5000/1M * 0.30) + (3000/1M * 3.75)
    //                 = 0.006 + 0.0015 + 0.01125 = 0.01875
    // costWithoutCaching = 10000/1M * 3.00 = 0.03
    expect(result.costWithCaching).toBeCloseTo(0.01875, 5)
    expect(result.costWithoutCaching).toBeCloseTo(0.03, 5)
    expect(result.savings).toBeCloseTo(0.01125, 5)
  })

  it('should handle zero totalInputTokens without NaN', () => {
    const result = estimateCachingSavings(0, 0, 0)

    expect(result.savingsPercentage).toBe(0)
    expect(Number.isNaN(result.savingsPercentage)).toBe(false)
  })

  it('should handle all tokens cached (pure cache hit)', () => {
    const result = estimateCachingSavings(5000, 5000, 0)

    // uncachedTokens = 5000 - 5000 - 0 = 0
    // costWithCaching = 0 + (5000/1M * 0.30) + 0 = 0.0015
    expect(result.costWithCaching).toBeCloseTo(0.0015, 5)
    expect(result.savings).toBeGreaterThan(0)
    expect(result.savingsPercentage).toBeCloseTo(90, 0)
  })

  it('should handle all tokens as cache writes (first request)', () => {
    const result = estimateCachingSavings(5000, 0, 5000)

    // uncachedTokens = max(0, 5000 - 0 - 5000) = 0
    // costWithCaching = 0 + 0 + (5000/1M * 3.75) = 0.01875
    // costWithoutCaching = 5000/1M * 3.00 = 0.015
    // savings = 0.015 - 0.01875 = -0.00375 (write premium costs more)
    expect(result.costWithCaching).toBeCloseTo(0.01875, 5)
    expect(result.savings).toBeLessThan(0) // Cache writes are more expensive than uncached
  })

  it('should clamp uncachedTokens to zero when inputs are inconsistent', () => {
    // Inconsistent: read + write > total
    const result = estimateCachingSavings(5000, 3000, 4000)

    // uncachedTokens = max(0, 5000 - 3000 - 4000) = max(0, -2000) = 0
    expect(result.costWithCaching).toBeGreaterThanOrEqual(0)
  })
})
