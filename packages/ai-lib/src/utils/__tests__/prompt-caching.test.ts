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
function createMockModel(provider = 'anthropic', modelId = 'claude-sonnet-4-6'): LanguageModel {
  return { provider, modelId, doGenerate: vi.fn(), doStream: vi.fn() } as any
}

// Helper to create a message with pre-set cache control
function cachedMessage(role: 'user' | 'assistant' | 'system', content: string): ModelMessage {
  return {
    role,
    content,
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } }
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

  describe('intermediate breakpoint placement', () => {
    // Generate N filler messages to simulate long conversation histories
    function fillerMessages(count: number): ModelMessage[] {
      return Array.from({ length: count }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `message ${i}`
      } as any))
    }

    it('should place intermediate breakpoint when gap exceeds lookback window', () => {
      // 1 existing breakpoint at position 0, then 30 messages = gap of 30 > 20
      const messages: ModelMessage[] = [
        cachedMessage('user', 'memory summary'),
        ...fillerMessages(30)
      ]

      const result = addCacheControlToMessages(messages, model, { cacheSystemPrompts: false })

      // Intermediate should be at position 0 + 20 - 2 = 18
      const intermediate = result[18] as any
      expect(intermediate.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })

      // Last message should also have breakpoint
      const lastMsg = result[result.length - 1] as any
      expect(lastMsg.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })
    })

    it('should not place intermediate when gap is within lookback window', () => {
      // 1 existing breakpoint at position 0, then 15 messages = gap of 15 < 20
      const messages: ModelMessage[] = [
        cachedMessage('user', 'memory summary'),
        ...fillerMessages(15)
      ]

      const result = addCacheControlToMessages(messages, model, { cacheSystemPrompts: false })

      // Only the last message should have a new breakpoint (no intermediate needed)
      const newBreakpoints = result
        .map((msg, i) => ({ msg, i }))
        .filter(({ msg, i }) => {
          const po = (msg as any).providerOptions?.anthropic?.cacheControl
          return po && i !== 0 // exclude the pre-existing one at position 0
        })

      expect(newBreakpoints).toHaveLength(1)
      expect(newBreakpoints[0].i).toBe(result.length - 1)
    })

    it('should place intermediate within lookback range of existing breakpoint', () => {
      // Existing breakpoint at position 2 (after 2 uncached messages), then 80 messages
      const messages: ModelMessage[] = [
        { role: 'system', content: 'template' } as any,
        { role: 'user', content: 'app context' } as any,
        cachedMessage('user', 'memory summary'),
        ...fillerMessages(80)
      ]

      const result = addCacheControlToMessages(messages, model, { cacheSystemPrompts: false })

      // Intermediate should be at position 2 + 20 - 2 = 20
      const intermediate = result[20] as any
      expect(intermediate.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })

      // Gap from existing (pos 2) to intermediate (pos 20) = 18, within 20-block lookback
      expect(20 - 2).toBeLessThan(20)
    })

    it('should place intermediate even without existing breakpoints (unsummarized conversations)', () => {
      // No existing breakpoints, 40 simple messages (1 block each) — anchor falls back to position 0
      const messages: ModelMessage[] = fillerMessages(40)

      const result = addCacheControlToMessages(messages, model, { cacheSystemPrompts: false })

      // Block count reaches 18 at message index 18 (1 block per simple message, anchor at 0)
      const intermediate = result[18] as any
      expect(intermediate.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })

      // Last message should also have breakpoint
      const lastMsg = result[result.length - 1] as any
      expect(lastMsg.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })
    })

    it('should count content blocks not messages for intermediate placement', () => {
      // Messages with array content (multiple blocks per message) should trigger
      // earlier intermediate placement to stay within the 20-block lookback window
      const messages: ModelMessage[] = [
        cachedMessage('user', 'memory summary'),
        // Each message has 3 content blocks (text + 2 tool calls)
        ...Array.from({ length: 30 }, (_, i) => ({
          role: i % 2 === 0 ? 'assistant' : 'user',
          content: [
            { type: 'text', text: `msg ${i}` },
            { type: 'tool-call', toolCallId: `tc${i}a`, toolName: 'a', input: {} },
            { type: 'tool-call', toolCallId: `tc${i}b`, toolName: 'b', input: {} }
          ]
        } as any))
      ]

      const result = addCacheControlToMessages(messages, model, { cacheSystemPrompts: false })

      // With 3 blocks per message, 18 blocks reached at message index 6
      // (anchor at 0, iterate from 1: positions 1-6 = 6 messages * 3 blocks = 18)
      const intermediate = result[6] as any
      expect(intermediate.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })
    })

    it('should not push already-cached last message into breakpoints array', () => {
      // When the last message is already cached (e.g., within-turn retry),
      // it should not be added to the breakpoints array. This prevents
      // wasting a slot that counts toward maxNewBreakpoints.
      const messages: ModelMessage[] = [
        cachedMessage('user', 'memory summary'),
        ...fillerMessages(10),
        cachedMessage('assistant', 'already cached last message')
      ]

      const result = addCacheControlToMessages(messages, model, { cacheSystemPrompts: false })

      // The already-cached last message should be returned unchanged (not re-tagged)
      const lastMsg = result[result.length - 1] as any
      expect(lastMsg).toBe(messages[messages.length - 1])

      // No new breakpoints should be added - the last message is already cached
      // and serves as the anchor, leaving no gap for an intermediate
      const newBreakpoints = result.filter((msg, i) => {
        const po = (msg as any).providerOptions?.anthropic?.cacheControl
        return po && msg !== messages[i] // only count newly-added cache control
      })
      expect(newBreakpoints).toHaveLength(0)
    })

    it('should respect breakpoint slot limits with existing breakpoints', () => {
      // 3 existing breakpoints + 1 system reserved = 4, no room for intermediate
      const messages: ModelMessage[] = [
        cachedMessage('user', 'a'),
        cachedMessage('user', 'b'),
        cachedMessage('user', 'c'),
        ...fillerMessages(30)
      ]

      const result = addCacheControlToMessages(messages, model, { cacheSystemPrompts: true })

      // 3 existing + 1 system reserved = 4, no remaining slots
      expect(result).toBe(messages)
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
