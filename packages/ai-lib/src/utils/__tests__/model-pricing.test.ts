/**
 * Tests for model-pricing.ts
 */

import { describe, it, expect } from 'vitest'
import {
  calculateCostEstimate,
  formatCostEstimate,
  getCacheHitRate,
  modelSupportsCaching,
  getAvailableModelsWithPricing,
  type TokenUsage,
  type CostEstimate
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

    it('should calculate costs with read caching for Bedrock models', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 200
      }

      const estimate = calculateCostEstimate(usage, 'claude-sonnet-4')
      
      // Regular input: 800 tokens * 0.003 / 1000 = 0.0024
      expect(estimate.inputCost).toBeCloseTo(0.0024, 5)
      // Output: 500 * 0.075 / 1000 = 0.0375
      expect(estimate.outputCost).toBe(0.0375)
      // Cached read: 200 * 0.0003 / 1000 = 0.00006
      expect(estimate.cachedInputCost).toBeCloseTo(0.00006, 5)
      // Total with caching: 0.0024 + 0.0375 + 0.00006 = 0.03996
      expect(estimate.totalCost).toBeCloseTo(0.03996, 5)
      // Regular cost: 1000 * 0.003 / 1000 + 500 * 0.075 / 1000 = 0.0405
      expect(estimate.regularCost).toBeCloseTo(0.0405, 4)
      expect(estimate.savings).toBeCloseTo(0.00054, 3)
      expect(estimate.savingsPercentage).toBeCloseTo(1.33, 2)
    })

    it('should calculate costs with write caching for Bedrock models', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensWrite: 300
      }

      const estimate = calculateCostEstimate(usage, 'claude-sonnet-4')
      
      // Regular input: 700 tokens * 0.003 / 1000 = 0.0021
      expect(estimate.inputCost).toBe(0.0021)
      // Output: 500 * 0.075 / 1000 = 0.0375
      expect(estimate.outputCost).toBe(0.0375)
      // Cached write: 300 * 0.00375 / 1000 = 0.001125
      expect(estimate.cachedInputCost).toBeCloseTo(0.001125, 5)
      // Total with caching
      expect(estimate.totalCost).toBeCloseTo(0.040625, 3)
      expect(estimate.regularCost).toBeCloseTo(0.0405, 4)
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

      const estimate = calculateCostEstimate(usage, 'claude-sonnet-4')
      
      // Regular input: 700 tokens * 0.003 / 1000 = 0.0021
      expect(estimate.inputCost).toBe(0.0021)
      // Cached read: 200 * 0.0003 / 1000 = 0.00006
      // Cached write: 100 * 0.00375 / 1000 = 0.000375
      expect(estimate.cachedInputCost).toBeCloseTo(0.000435, 5)
      // Total cached input cost should be sum of read and write
      expect(estimate.totalCost).toBeCloseTo(0.040035, 3)
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

      const estimate1 = calculateCostEstimate(usage, 'claude4')
      const estimate2 = calculateCostEstimate(usage, 'claude-sonnet-4')
      
      // Should produce identical results
      expect(estimate1.totalCost).toBe(estimate2.totalCost)
      expect(estimate1.provider).toBe(estimate2.provider)
    })

    it('should prefer Bedrock for caching-capable models', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 200
      }

      const estimate = calculateCostEstimate(usage, 'claude4')
      
      // Should use Bedrock pricing even though alias could map to Anthropic
      expect(estimate.provider).toBe('bedrock-claude')
      expect(estimate.cachedInputCost).toBeDefined()
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
        model: 'claude-sonnet-4',
        provider: 'bedrock-claude'
      }

      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 200
      }

      const lines = formatCostEstimate(estimate, usage)
      
      expect(lines).toContain('📊 Cost Analysis for claude-sonnet-4:')
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
        model: 'claude-sonnet-4',
        provider: 'bedrock-claude'
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
    it('should return true for Bedrock Claude models with caching support', () => {
      expect(modelSupportsCaching('claude-sonnet-4')).toBe(true)
      expect(modelSupportsCaching('claude4')).toBe(true)
      expect(modelSupportsCaching('claude-3-5-haiku')).toBe(true)
    })

    it('should return false for OpenAI models', () => {
      expect(modelSupportsCaching('gpt-4o')).toBe(false)
      expect(modelSupportsCaching('gpt4o')).toBe(false)
      expect(modelSupportsCaching('gpt-4-turbo')).toBe(false)
    })

    it('should return false for Claude models not available on Bedrock', () => {
      expect(modelSupportsCaching('claude-3-opus')).toBe(false)
    })

    it('should return false for unsupported models', () => {
      expect(modelSupportsCaching('unknown-model')).toBe(false)
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

    it('should include both regular and Bedrock models', () => {
      const models = getAvailableModelsWithPricing()
      
      const openaiModels = models.filter(m => m.provider === 'openai')
      const anthropicModels = models.filter(m => m.provider === 'anthropic')
      const bedrockModels = models.filter(m => m.provider === 'bedrock-claude')
      
      expect(openaiModels.length).toBeGreaterThan(0)
      expect(anthropicModels.length).toBeGreaterThan(0)
      expect(bedrockModels.length).toBeGreaterThan(0)
    })

    it('should mark Bedrock models as supporting caching', () => {
      const models = getAvailableModelsWithPricing()
      const bedrockModels = models.filter(m => m.provider === 'bedrock-claude')
      
      bedrockModels.forEach(model => {
        if (model.name.includes('claude-sonnet-4') || 
            model.name.includes('claude-3-5-haiku')) {
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
        calculateCostEstimate(usage, 'claude-sonnet-4')
      }).not.toThrow()
    })

    it('should handle cached tokens exceeding total input tokens', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 1500 // More than input tokens
      }

      const estimate = calculateCostEstimate(usage, 'claude-sonnet-4')
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

      const estimate = calculateCostEstimate(usage, 'claude-sonnet-4')
      expect(estimate.totalCost).toBeGreaterThan(0)
      expect(estimate.totalCost).toBeLessThan(10000) // Reasonable upper bound
    })
  })
})