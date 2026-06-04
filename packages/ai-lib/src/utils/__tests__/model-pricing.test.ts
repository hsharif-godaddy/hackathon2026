/**
 * Tests for model-pricing.ts
 */

import type { LanguageModelUsage } from 'ai'
import { describe, it, expect } from 'vitest'

import {
  buildTokenUsage,
  calculateCostEstimate,
  formatCostEstimate,
  getCacheHitRate,
  getAvailableModelsWithPricing,
  modelSupportsCaching,
  type CostEstimate,
  type TokenUsage
} from '../model-pricing.js'

describe('model-pricing', () => {
  describe('calculateCostEstimate', () => {
    it('should calculate basic costs without caching', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500
      }

      const estimate = calculateCostEstimate(usage, 'gpt-4o')
      
      expect(estimate.inputCost).toBe(0.005) // 1000 * 0.005 / 1000
      expect(estimate.outputCost).toBe(0.0075) // 500 * 0.015 / 1000
      expect(estimate.totalCost).toBe(0.0125)
      expect(estimate.regularCost).toBe(0.0125)
      expect(estimate.savings).toBe(0)
      expect(estimate.savingsPercentage).toBe(0)
      expect(estimate.currency).toBe('USD')
      expect(estimate.model).toBe('gpt-4o')
      expect(estimate.provider).toBe('openai')
      expect(estimate.cachedInputCost).toBeUndefined()
    })

    it('should calculate costs with read caching for Anthropic models', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 200
      }

      const estimate = calculateCostEstimate(usage, 'claude-sonnet-4-6')

      // Regular input: 800 tokens * 0.003 / 1000 = 0.0024
      expect(estimate.inputCost).toBeCloseTo(0.0024, 5)
      // Output: 500 * 0.015 / 1000 = 0.0075
      expect(estimate.outputCost).toBe(0.0075)
      // Cached read: 200 * 0.0003 / 1000 = 0.00006
      expect(estimate.cachedInputCost).toBeCloseTo(0.00006, 5)
      // Total with caching: 0.0024 + 0.0075 + 0.00006 = 0.00996
      expect(estimate.totalCost).toBeCloseTo(0.00996, 5)
      // Regular cost: 1000 * 0.003 / 1000 + 500 * 0.015 / 1000 = 0.0105
      expect(estimate.regularCost).toBeCloseTo(0.0105, 4)
      expect(estimate.savings).toBeCloseTo(0.00054, 3)
      expect(estimate.savingsPercentage).toBeCloseTo(5.14, 2)
    })

    it('should calculate costs with write caching for Anthropic models', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensWrite: 300
      }

      const estimate = calculateCostEstimate(usage, 'claude-sonnet-4-6')

      // Regular input: 700 tokens * 0.003 / 1000 = 0.0021
      expect(estimate.inputCost).toBe(0.0021)
      // Output: 500 * 0.015 / 1000 = 0.0075
      expect(estimate.outputCost).toBe(0.0075)
      // Cached write: 300 * 0.00375 / 1000 = 0.001125
      expect(estimate.cachedInputCost).toBeCloseTo(0.001125, 5)
      // Total with caching
      expect(estimate.totalCost).toBeCloseTo(0.010725, 5)
      expect(estimate.regularCost).toBeCloseTo(0.0105, 4)
      expect(estimate.savings).toBeCloseTo(-0.000225, 3) // Write costs more than regular in this case
    })

    it('should calculate costs with both read and write caching', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 200,
        cachedInputTokensWrite: 100
      }

      const estimate = calculateCostEstimate(usage, 'claude-sonnet-4-6')
      
      // Regular input: 700 tokens * 0.003 / 1000 = 0.0021
      expect(estimate.inputCost).toBe(0.0021)
      // Cached read: 200 * 0.0003 / 1000 = 0.00006
      // Cached write: 100 * 0.00375 / 1000 = 0.000375
      expect(estimate.cachedInputCost).toBeCloseTo(0.000435, 5)
      // Total cached input cost should be sum of read and write
      expect(estimate.totalCost).toBeCloseTo(0.010035, 5)
    })

    it('should handle unsupported models gracefully', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500
      }

      const estimate = calculateCostEstimate(usage, 'unknown-model')
      
      expect(estimate.inputCost).toBe(0)
      expect(estimate.outputCost).toBe(0)
      expect(estimate.totalCost).toBe(0)
      expect(estimate.regularCost).toBe(0)
      expect(estimate.savings).toBe(0)
      expect(estimate.savingsPercentage).toBe(0)
      expect(estimate.currency).toBe('USD')
      expect(estimate.model).toBe('unknown-model')
    })

    it('should handle model aliases correctly', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500
      }

      const estimate1 = calculateCostEstimate(usage, 'sonnet')
      const estimate2 = calculateCostEstimate(usage, 'claude-sonnet-4-6')
      
      // Should produce identical results
      expect(estimate1.totalCost).toBe(estimate2.totalCost)
      expect(estimate1.provider).toBe(estimate2.provider)
    })

    it('should use Anthropic pricing for Claude models', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 200
      }

      const estimate = calculateCostEstimate(usage, 'sonnet')

      // Should use Anthropic pricing
      expect(estimate.provider).toBe('anthropic')
      expect(estimate.cachedInputCost).toBeDefined()
    })

    it('should calculate costs with read caching for azure Kimi', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 200
      }

      const estimate = calculateCostEstimate(usage, 'azure/Kimi-K2.6')

      expect(estimate.provider).toBe('openai')
      expect(estimate.inputCost).toBeCloseTo(0.00076, 6)
      expect(estimate.outputCost).toBe(0.002)
      expect(estimate.cachedInputCost).toBeCloseTo(0.000032, 6)
      expect(estimate.totalCost).toBeCloseTo(0.002792, 6)
      expect(estimate.regularCost).toBeCloseTo(0.00295, 6)
      expect(estimate.savings).toBeCloseTo(0.000158, 6)
    })

    it('should calculate costs with read caching for azure Kimi thinking variant', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 200
      }

      const estimate = calculateCostEstimate(usage, 'azure/Kimi-K2.6-thinking')

      expect(estimate.provider).toBe('openai')
      expect(estimate.inputCost).toBeCloseTo(0.00076, 6)
      expect(estimate.outputCost).toBe(0.002)
      expect(estimate.cachedInputCost).toBeCloseTo(0.000032, 6)
      expect(estimate.totalCost).toBeCloseTo(0.002792, 6)
    })
  })

  describe('getCacheHitRate', () => {
    it('should calculate cache hit rate with read tokens only', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 200
      }

      const hitRate = getCacheHitRate(usage)
      expect(hitRate).toBe(20) // 200/1000 * 100
    })

    it('should calculate cache hit rate with write tokens only', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensWrite: 300
      }

      const hitRate = getCacheHitRate(usage)
      expect(hitRate).toBe(30) // 300/1000 * 100
    })

    it('should calculate cache hit rate with both read and write tokens', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 200,
        cachedInputTokensWrite: 100
      }

      const hitRate = getCacheHitRate(usage)
      expect(hitRate).toBe(30) // (200+100)/1000 * 100
    })

    it('should return 0 for no cached tokens', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500
      }

      const hitRate = getCacheHitRate(usage)
      expect(hitRate).toBe(0)
    })

    it('should return 0 for zero input tokens', () => {
      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 500,
        totalTokens: 500,
        cachedInputTokensRead: 200
      }

      const hitRate = getCacheHitRate(usage)
      expect(hitRate).toBe(0)
    })
  })

  describe('formatCostEstimate', () => {
    it('should format basic cost estimate without caching', () => {
      const estimate: CostEstimate = {
        inputCost: 0.005,
        outputCost: 0.0075,
        totalCost: 0.0125,
        regularCost: 0.0125,
        savings: 0,
        savingsPercentage: 0,
        currency: 'USD',
        model: 'gpt-4o',
        provider: 'openai'
      }

      const lines = formatCostEstimate(estimate)
      
      expect(lines).toContain('📊 Cost Analysis for gpt-4o:')
      expect(lines).toContain('   Input cost: $0.0050')
      expect(lines).toContain('   Output cost: $0.0075')
      expect(lines).toContain('   💰 Total cost: $0.0125')
    })

    it('should format cost estimate with caching', () => {
      const estimate: CostEstimate = {
        inputCost: 0.0024,
        outputCost: 0.0375,
        totalCost: 0.03996,
        cachedInputCost: 0.00006,
        regularCost: 0.0399,
        savings: 0.00006,
        savingsPercentage: 0.15,
        currency: 'USD',
        model: 'claude-sonnet-4-6',
        provider: 'anthropic'
      }

      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 200
      }

      const lines = formatCostEstimate(estimate, usage)

      expect(lines).toContain('📊 Cost Analysis for claude-sonnet-4-6:')
      expect(lines).toContain('   Cached input cost: $0.0001')
      expect(lines).toContain('     • Read: 200 tokens')
      expect(lines).toContain('   💰 Total cost (with caching): $0.0400')
      expect(lines).toContain('   💸 Cost without caching: $0.0399')
      expect(lines.some(line => line.includes('✨ Savings:'))).toBe(true)
    })

    it('should format cost estimate with both read and write tokens', () => {
      const estimate: CostEstimate = {
        inputCost: 0.0021,
        outputCost: 0.0375,
        totalCost: 0.040035,
        cachedInputCost: 0.000435,
        regularCost: 0.0399,
        savings: -0.000435,
        savingsPercentage: -1.09,
        currency: 'USD',
        model: 'claude-sonnet-4-6',
        provider: 'anthropic'
      }

      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 200,
        cachedInputTokensWrite: 100
      }

      const lines = formatCostEstimate(estimate, usage)
      
      expect(lines).toContain('     • Read: 200 tokens')
      expect(lines).toContain('     • Write: 100 tokens')
    })
  })

  describe('modelSupportsCaching', () => {
    it('should return true for Anthropic Claude models with caching support', () => {
      expect(modelSupportsCaching('claude-sonnet-4-6')).toBe(true)
      expect(modelSupportsCaching('sonnet')).toBe(true)
      expect(modelSupportsCaching('claude-haiku-4-5')).toBe(true)
    })

    it('should return false for OpenAI models', () => {
      expect(modelSupportsCaching('gpt-4o')).toBe(false)
      expect(modelSupportsCaching('gpt4o')).toBe(false)
      expect(modelSupportsCaching('gpt-4-turbo')).toBe(false)
    })

    it('should return false for unknown models', () => {
      expect(modelSupportsCaching('unknown-model')).toBe(false)
    })

    it('should return false for OpenAI models without caching', () => {
      expect(modelSupportsCaching('gpt-4-turbo')).toBe(false)
    })

    it('should return true for azure Kimi read cache pricing', () => {
      expect(modelSupportsCaching('azure/Kimi-K2.6')).toBe(true)
      expect(modelSupportsCaching('azure/Kimi-K2.6-thinking')).toBe(true)
    })
  })

  describe('getAvailableModelsWithPricing', () => {
    it('should return all models with pricing information', () => {
      const models = getAvailableModelsWithPricing()
      
      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBeGreaterThan(0)
      
      models.forEach(model => {
        expect(model).toHaveProperty('name')
        expect(model).toHaveProperty('provider')
        expect(model).toHaveProperty('inputCostPer1K')
        expect(model).toHaveProperty('outputCostPer1K')
        expect(model).toHaveProperty('supportsCaching')
        expect(model).toHaveProperty('currency')
        
        expect(typeof model.name).toBe('string')
        expect(typeof model.inputCostPer1K).toBe('number')
        expect(typeof model.outputCostPer1K).toBe('number')
        expect(typeof model.supportsCaching).toBe('boolean')
        expect(model.currency).toBe('USD')
      })
    })

    it('should include OpenAI and Anthropic models', () => {
      const models = getAvailableModelsWithPricing()

      const openaiModels = models.filter(m => m.provider === 'openai')
      const anthropicModels = models.filter(m => m.provider === 'anthropic')

      expect(openaiModels.length).toBeGreaterThan(0)
      expect(anthropicModels.length).toBeGreaterThan(0)
    })

    it('should mark Anthropic Claude models with caching support correctly', () => {
      const models = getAvailableModelsWithPricing()
      const anthropicModels = models.filter(m => m.provider === 'anthropic')

      anthropicModels.forEach(model => {
        if (model.name.includes('claude-sonnet-4') ||
            model.name.includes('claude-haiku-4-5') ||
            model.name.includes('claude-opus-4-8') ||
            model.name.includes('claude-opus-4-7') ||
            model.name.includes('claude-opus-4-6')) {
          expect(model.supportsCaching).toBe(true)
        }
      })
    })

    it('should be sorted by name', () => {
      const models = getAvailableModelsWithPricing()
      const names = models.map(m => m.name)
      const sortedNames = [...names].sort()
      expect(names).toEqual(sortedNames)
    })
  })

  describe('buildTokenUsage', () => {
    it('should map inputTokenDetails cache fields to TokenUsage', function mapDetails() {
      const usage = buildTokenUsage({
        inputTokens: 96772,
        outputTokens: 183,
        totalTokens: 96955,
        inputTokenDetails: {
          noCacheTokens: 5,
          cacheReadTokens: 47192,
          cacheWriteTokens: 49575
        },
        cachedInputTokens: 47192
      } as LanguageModelUsage)

      expect(usage).toEqual({
        inputTokens: 96772,
        outputTokens: 183,
        totalTokens: 96955,
        cachedInputTokensRead: 47192,
        cachedInputTokensWrite: 49575
      })
    })

    it('should fall back to deprecated cachedInputTokens for reads', function fallback() {
      const usage = buildTokenUsage({
        inputTokens: 50000,
        outputTokens: 200,
        totalTokens: 50200,
        cachedInputTokens: 30000
      } as LanguageModelUsage)

      expect(usage).toEqual({
        inputTokens: 50000,
        outputTokens: 200,
        totalTokens: 50200,
        cachedInputTokensRead: 30000
      })
    })

    it('should prefer inputTokenDetails.cacheReadTokens over deprecated cachedInputTokens', function preferDetails() {
      const usage = buildTokenUsage({
        inputTokens: 50000,
        outputTokens: 200,
        totalTokens: 50200,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: 40000,
          cacheWriteTokens: 5000
        },
        cachedInputTokens: 30000
      } as LanguageModelUsage)

      expect(usage.cachedInputTokensRead).toBe(40000)
    })

    it('should omit cache fields when no cache data exists', function noCache() {
      const usage = buildTokenUsage({
        inputTokens: 1000,
        outputTokens: 50,
        totalTokens: 1050
      } as LanguageModelUsage)

      expect(usage).toEqual({
        inputTokens: 1000,
        outputTokens: 50,
        totalTokens: 1050
      })
      expect(usage.cachedInputTokensRead).toBeUndefined()
      expect(usage.cachedInputTokensWrite).toBeUndefined()
    })

    it('should handle cache writes without reads', function writesOnly() {
      const usage = buildTokenUsage({
        inputTokens: 47196,
        outputTokens: 85,
        totalTokens: 47281,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: 47192
        }
      } as LanguageModelUsage)

      expect(usage).toEqual({
        inputTokens: 47196,
        outputTokens: 85,
        totalTokens: 47281,
        cachedInputTokensWrite: 47192
      })
      expect(usage.cachedInputTokensRead).toBeUndefined()
    })

    it('should default missing token counts to zero', function defaults() {
      const usage = buildTokenUsage({} as LanguageModelUsage)

      expect(usage.inputTokens).toBe(0)
      expect(usage.outputTokens).toBe(0)
      expect(usage.totalTokens).toBe(0)
    })

    it('should derive totalTokens from input + output when totalTokens is absent', function derive() {
      const usage = buildTokenUsage({
        inputTokens: 500,
        outputTokens: 200
      } as LanguageModelUsage)

      expect(usage.totalTokens).toBe(700)
    })

    it('should preserve zero-valued cache tokens', function zeroes() {
      const usage = buildTokenUsage({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        inputTokenDetails: {
          noCacheTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0
        }
      } as LanguageModelUsage)

      expect(usage.cachedInputTokensRead).toBe(0)
      expect(usage.cachedInputTokensWrite).toBe(0)
    })

    it('should fall back to cachedInputTokens when inputTokenDetails has no cacheReadTokens', function fallbackWithDetails() {
      const usage = buildTokenUsage({
        inputTokens: 50000,
        outputTokens: 200,
        totalTokens: 50200,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: 5000
        },
        cachedInputTokens: 30000
      } as LanguageModelUsage)

      expect(usage.cachedInputTokensRead).toBe(30000)
      expect(usage.cachedInputTokensWrite).toBe(5000)
    })

    it('should verify noCacheTokens equals inputTokens minus cache tokens', function noCacheArithmetic() {
      const usage = buildTokenUsage({
        inputTokens: 96772,
        outputTokens: 183,
        totalTokens: 96955,
        inputTokenDetails: {
          noCacheTokens: 5,
          cacheReadTokens: 47192,
          cacheWriteTokens: 49575
        },
        cachedInputTokens: 47192
      } as LanguageModelUsage)

      expect(usage.inputTokens - (usage.cachedInputTokensRead ?? 0) - (usage.cachedInputTokensWrite ?? 0)).toBe(5)
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle zero token usage', () => {
      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      }

      const estimate = calculateCostEstimate(usage, 'gpt-4o')
      expect(estimate.totalCost).toBe(0)
    })

    it('should handle negative cached tokens gracefully', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: -100 // Invalid but shouldn't crash
      }

      expect(() => {
        calculateCostEstimate(usage, 'claude-sonnet-4-6')
      }).not.toThrow()
    })

    it('should handle cached tokens exceeding total input tokens', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 1500 // More than input tokens
      }

      const estimate = calculateCostEstimate(usage, 'claude-sonnet-4-6')
      // Should use Math.max(0, ...) to prevent negative regular tokens
      expect(estimate.inputCost).toBeGreaterThanOrEqual(0)
    })

    it('should handle very large token numbers', () => {
      const usage: TokenUsage = {
        inputTokens: 1000000,
        outputTokens: 500000,
        totalTokens: 1500000,
        cachedInputTokensRead: 200000
      }

      const estimate = calculateCostEstimate(usage, 'claude-sonnet-4-6')
      expect(estimate.totalCost).toBeGreaterThan(0)
      expect(estimate.totalCost).toBeLessThan(10000) // Reasonable upper bound
    })
  })
})
