import { describe, it, expect } from 'vitest'
import {
  getModelContextWindow,
  calculateCacheMetrics,
  calculateContextWindowUtilization
} from '../model-context-window.js'

describe('getModelContextWindow', () => {
  describe('exact model name matches', () => {
    it('should return 200k for Claude Sonnet 4.5', () => {
      expect(getModelContextWindow('claude-sonnet-4-5')).toBe(200000)
    })

    it('should return 200k for Claude Opus 4', () => {
      expect(getModelContextWindow('claude-opus-4')).toBe(200000)
    })

    it('should return 200k for Claude Haiku 4', () => {
      expect(getModelContextWindow('claude-haiku-4')).toBe(200000)
    })

    it('should return 128k for GPT-4o', () => {
      expect(getModelContextWindow('gpt-4o')).toBe(128000)
    })

    it('should return 128k for GPT-4o Mini', () => {
      expect(getModelContextWindow('gpt-4o-mini')).toBe(128000)
    })

    it('should return 8192 for GPT-4 (older model)', () => {
      expect(getModelContextWindow('gpt-4')).toBe(8192)
    })

    it('should return 16385 for GPT-3.5 Turbo', () => {
      expect(getModelContextWindow('gpt-3.5-turbo')).toBe(16385)
    })
  })

  describe('short name matches', () => {
    it('should return 200k for "sonnet"', () => {
      expect(getModelContextWindow('sonnet')).toBe(200000)
    })

    it('should return 200k for "opus"', () => {
      expect(getModelContextWindow('opus')).toBe(200000)
    })

    it('should return 200k for "haiku"', () => {
      expect(getModelContextWindow('haiku')).toBe(200000)
    })
  })

  describe('case-insensitive matching', () => {
    it('should handle uppercase model names', () => {
      expect(getModelContextWindow('CLAUDE-SONNET-4-5')).toBe(200000)
    })

    it('should handle mixed case model names', () => {
      expect(getModelContextWindow('Claude-Sonnet-4-5')).toBe(200000)
    })

    it('should handle model names with extra whitespace', () => {
      expect(getModelContextWindow('  claude-sonnet-4-5  ')).toBe(200000)
    })
  })

  describe('partial matching (Bedrock format)', () => {
    it('should match Bedrock-style model IDs containing Claude Sonnet', () => {
      expect(getModelContextWindow('anthropic.claude-sonnet-4-5-v2:0')).toBe(200000)
    })

    it('should match Bedrock-style model IDs containing Claude Opus', () => {
      expect(getModelContextWindow('anthropic.claude-opus-4-v1:0')).toBe(200000)
    })

    it('should match Bedrock-style model IDs containing Claude Haiku', () => {
      expect(getModelContextWindow('anthropic.claude-haiku-4-v1:0')).toBe(200000)
    })
  })

  describe('partial matching priority (avoid misclassification)', () => {
    it('should match gpt-4o-mini as 128k, not gpt-4 as 8k', () => {
      expect(getModelContextWindow('gpt-4o-mini')).toBe(128000)
      expect(getModelContextWindow('gpt-4o-mini-2024-07-18')).toBe(128000)
    })

    it('should match gpt-4o as 128k, not gpt-4 as 8k', () => {
      expect(getModelContextWindow('gpt-4o')).toBe(128000)
      expect(getModelContextWindow('gpt-4o-2024-08-06')).toBe(128000)
    })

    it('should match gpt-4-turbo as 128k, not gpt-4 as 8k', () => {
      expect(getModelContextWindow('gpt-4-turbo')).toBe(128000)
      expect(getModelContextWindow('gpt-4-turbo-2024-04-09')).toBe(128000)
    })

    it('should still match gpt-4 (older model) as 8k', () => {
      expect(getModelContextWindow('gpt-4')).toBe(8192)
      expect(getModelContextWindow('gpt-4-0613')).toBe(8192)
    })
  })

  describe('unknown models', () => {
    it('should return default (128k) for unknown model', () => {
      expect(getModelContextWindow('unknown-model-123')).toBe(128000)
    })

    it('should return default for empty string', () => {
      expect(getModelContextWindow('')).toBe(128000)
    })

    it('should return default for undefined', () => {
      expect(getModelContextWindow(undefined)).toBe(128000)
    })
  })
})

describe('calculateCacheMetrics', () => {
  describe('normal cache usage', () => {
    it('should calculate metrics correctly with 70% cache hit rate', () => {
      const result = calculateCacheMetrics(10000, 7000)

      expect(result.cachedTokens).toBe(7000)
      expect(result.freshTokens).toBe(3000)
      expect(result.cacheHitRate).toBe(70)
    })

    it('should calculate metrics correctly with 50% cache hit rate', () => {
      const result = calculateCacheMetrics(40000, 20000)

      expect(result.cachedTokens).toBe(20000)
      expect(result.freshTokens).toBe(20000)
      expect(result.cacheHitRate).toBe(50)
    })

    it('should calculate metrics correctly with 100% cache hit rate', () => {
      const result = calculateCacheMetrics(10000, 10000)

      expect(result.cachedTokens).toBe(10000)
      expect(result.freshTokens).toBe(0)
      expect(result.cacheHitRate).toBe(100)
    })
  })

  describe('edge cases with no cache', () => {
    it('should handle undefined cachedInputTokens', () => {
      const result = calculateCacheMetrics(10000, undefined)

      expect(result.cachedTokens).toBe(0)
      expect(result.freshTokens).toBe(10000)
      expect(result.cacheHitRate).toBe(0)
    })

    it('should handle null cachedInputTokens', () => {
      const result = calculateCacheMetrics(10000, null)

      expect(result.cachedTokens).toBe(0)
      expect(result.freshTokens).toBe(10000)
      expect(result.cacheHitRate).toBe(0)
    })

    it('should handle zero cachedInputTokens', () => {
      const result = calculateCacheMetrics(10000, 0)

      expect(result.cachedTokens).toBe(0)
      expect(result.freshTokens).toBe(10000)
      expect(result.cacheHitRate).toBe(0)
    })
  })

  describe('edge cases with zero input tokens', () => {
    it('should handle zero inputTokens with zero cache', () => {
      const result = calculateCacheMetrics(0, 0)

      expect(result.cachedTokens).toBe(0)
      expect(result.freshTokens).toBe(0)
      expect(result.cacheHitRate).toBe(0)
    })

    it('should handle zero inputTokens with undefined cache', () => {
      const result = calculateCacheMetrics(0, undefined)

      expect(result.cachedTokens).toBe(0)
      expect(result.freshTokens).toBe(0)
      expect(result.cacheHitRate).toBe(0)
    })
  })

  describe('rounding behavior', () => {
    it('should round cache hit rate to nearest integer (down)', () => {
      const result = calculateCacheMetrics(10000, 6549) // 65.49%

      expect(result.cacheHitRate).toBe(65)
    })

    it('should round cache hit rate to nearest integer (up)', () => {
      const result = calculateCacheMetrics(10000, 6551) // 65.51%

      expect(result.cacheHitRate).toBe(66)
    })
  })

  describe('clamping behavior (provider bug protection)', () => {
    it('should clamp cachedTokens when it exceeds inputTokens', () => {
      // Provider bug: reports more cached tokens than total input
      const result = calculateCacheMetrics(10000, 12000)

      expect(result.cachedTokens).toBe(10000) // Clamped to inputTokens
      expect(result.freshTokens).toBe(0) // No negative values
      expect(result.cacheHitRate).toBe(100) // Clamped to 100%
    })

    it('should clamp negative cachedTokens to zero', () => {
      const result = calculateCacheMetrics(10000, -100)

      expect(result.cachedTokens).toBe(0)
      expect(result.freshTokens).toBe(10000)
      expect(result.cacheHitRate).toBe(0)
    })
  })
})

describe('calculateContextWindowUtilization', () => {
  describe('Claude models (200k window)', () => {
    it('should calculate 20% utilization for 40k tokens', () => {
      const utilization = calculateContextWindowUtilization(40000, 'claude-sonnet-4-5')

      expect(utilization).toBe(20)
    })

    it('should calculate 50% utilization for 100k tokens', () => {
      const utilization = calculateContextWindowUtilization(100000, 'claude-sonnet-4-5')

      expect(utilization).toBe(50)
    })

    it('should calculate 100% utilization for 200k tokens', () => {
      const utilization = calculateContextWindowUtilization(200000, 'claude-sonnet-4-5')

      expect(utilization).toBe(100)
    })

    it('should handle over-utilization (>100%)', () => {
      const utilization = calculateContextWindowUtilization(250000, 'claude-sonnet-4-5')

      expect(utilization).toBe(125)
    })
  })

  describe('GPT models (128k window)', () => {
    it('should calculate 50% utilization for 64k tokens', () => {
      const utilization = calculateContextWindowUtilization(64000, 'gpt-4o')

      expect(utilization).toBe(50)
    })

    it('should calculate 100% utilization for 128k tokens', () => {
      const utilization = calculateContextWindowUtilization(128000, 'gpt-4o')

      expect(utilization).toBe(100)
    })
  })

  describe('edge cases', () => {
    it('should return 0 for zero tokens', () => {
      const utilization = calculateContextWindowUtilization(0, 'claude-sonnet-4-5')

      expect(utilization).toBe(0)
    })

    it('should handle undefined model name (use default 128k)', () => {
      const utilization = calculateContextWindowUtilization(64000, undefined)

      expect(utilization).toBe(50) // 64k / 128k = 50%
    })

    it('should handle unknown model name (use default 128k)', () => {
      const utilization = calculateContextWindowUtilization(64000, 'unknown-model')

      expect(utilization).toBe(50) // 64k / 128k = 50%
    })
  })

  describe('rounding behavior', () => {
    it('should round utilization to nearest integer (down)', () => {
      const utilization = calculateContextWindowUtilization(40499, 'claude-sonnet-4-5')
      // 40499 / 200000 = 20.2495%

      expect(utilization).toBe(20)
    })

    it('should round utilization to nearest integer (up)', () => {
      const utilization = calculateContextWindowUtilization(40500, 'claude-sonnet-4-5')
      // 40500 / 200000 = 20.25%

      expect(utilization).toBe(20)
    })
  })
})
