import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computeDebugTurnStats } from '../debug-turn-stats.js'

describe('computeDebugTurnStats', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-21T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('computes all fields from token counts', () => {
    const result = computeDebugTurnStats({
      conversationId: 'conv-1',
      agentName: 'develop',
      modelName: 'claude-sonnet-4-5',
      inputTokens: 10000,
      outputTokens: 500,
      totalTokens: 10500,
      cachedInputTokens: 7000,
      cacheWriteInputTokens: 2000,
    })

    expect(result.type).toBe('debug_turn_stats')
    expect(result.conversationId).toBe('conv-1')
    expect(result.agentName).toBe('develop')
    expect(result.modelName).toBe('claude-sonnet-4-5')
    expect(result.inputTokens).toBe(10000)
    expect(result.outputTokens).toBe(500)
    expect(result.totalTokens).toBe(10500)
    expect(result.cachedInputTokens).toBe(7000)
    expect(result.cacheWriteInputTokens).toBe(2000)
    expect(result.cacheHitRate).toBe(0.7)
    expect(result.contextWindowUtilization).toBe(0.05)
    expect(result.costUsd).toBeGreaterThan(0)
    expect(result.timestamp).toBe('2026-05-21T10:00:00.000Z')
  })

  it('handles zero cached tokens', () => {
    const result = computeDebugTurnStats({
      conversationId: 'conv-2',
      agentName: 'initial',
      modelName: 'gpt-4o',
      inputTokens: 5000,
      outputTokens: 200,
      totalTokens: 5200,
    })

    expect(result.cachedInputTokens).toBe(0)
    expect(result.cacheWriteInputTokens).toBe(0)
    expect(result.cacheHitRate).toBe(0)
  })

  it('handles zero input tokens without division errors', () => {
    const result = computeDebugTurnStats({
      conversationId: 'conv-3',
      agentName: 'develop',
      modelName: 'claude-sonnet-4-5',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    })

    expect(result.cacheHitRate).toBe(0)
    expect(result.contextWindowUtilization).toBe(0)
    expect(result.costUsd).toBe(0)
  })
})
