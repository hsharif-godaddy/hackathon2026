/**
 * Tests for model-normalization.ts
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeModelName,
  getAvailableModels,
  isModelSupported,
  getFullModelName,
  getNormalizedModelName,
  getModelProvider,
  modelSupportsCaching,
  getModelInfo,
  getLegacyModelMappings,
  MODELS,
  ALIASES,
  BEDROCK_MODELS
} from '../model-normalization.js'

describe('model-normalization', () => {
  describe('normalizeModelName', () => {
    it('should normalize OpenAI models correctly', () => {
      const result = normalizeModelName('gpt4o')
      expect(result).toEqual({
        normalizedName: 'gpt-4o',
        fullModelId: 'gpt-4o',
        provider: 'openai',
        isSupported: true,
        originalName: 'gpt4o'
      })
    })

    it('should normalize Claude models to Anthropic by default', () => {
      const result = normalizeModelName('claude4')
      expect(result).toEqual({
        normalizedName: 'claude-sonnet-4',
        fullModelId: 'claude-sonnet-4',
        provider: 'anthropic',
        isSupported: true,
        originalName: 'claude4'
      })
    })

    it('should prefer Bedrock when preferBedrock is true', () => {
      const result = normalizeModelName('claude4', true)
      expect(result).toEqual({
        normalizedName: 'claude-sonnet-4',
        fullModelId: 'global.anthropic.claude-sonnet-4-20250514-v1:0',
        provider: 'bedrock-claude',
        isSupported: true,
        originalName: 'claude4'
      })
    })

    it('should handle full Bedrock ARN names', () => {
      const bedrockArn = 'global.anthropic.claude-sonnet-4-20250514-v1:0'
      const result = normalizeModelName(bedrockArn)
      expect(result).toEqual({
        normalizedName: 'claude-sonnet-4',
        fullModelId: bedrockArn,
        provider: 'bedrock-claude',
        isSupported: true,
        originalName: bedrockArn
      })
    })

    it('should handle canonical model names', () => {
      const result = normalizeModelName('claude-3-5-sonnet')
      expect(result).toEqual({
        normalizedName: 'claude-3-5-sonnet',
        fullModelId: 'claude-3-5-sonnet',
        provider: 'anthropic',
        isSupported: true,
        originalName: 'claude-3-5-sonnet'
      })
    })

    it('should handle unknown models with fallback', () => {
      const result = normalizeModelName('unknown-model')
      expect(result).toEqual({
        normalizedName: 'unknown-model',
        fullModelId: 'unknown-model',
        provider: 'openai',
        isSupported: false,
        originalName: 'unknown-model'
      })
    })

    it('should handle case insensitive input', () => {
      const result = normalizeModelName('CLAUDE4')
      expect(result.normalizedName).toBe('claude-sonnet-4')
    })

    it('should trim whitespace for processing but preserve original', () => {
      const result = normalizeModelName('  claude4  ')
      expect(result.normalizedName).toBe('claude-sonnet-4')
      expect(result.originalName).toBe('  claude4  ')
    })
  })

  describe('getAvailableModels', () => {
    it('should return all available models and aliases', () => {
      const models = getAvailableModels()
      expect(models).toBeInstanceOf(Array)
      expect(models.length).toBeGreaterThan(0)
      expect(models).toContain('gpt-4o')
      expect(models).toContain('gpt4o')
      expect(models).toContain('claude-sonnet-4')
      expect(models).toContain('claude4')
    })

    it('should return sorted models', () => {
      const models = getAvailableModels()
      const sorted = [...models].sort()
      expect(models).toEqual(sorted)
    })

    it('should not have duplicates', () => {
      const models = getAvailableModels()
      const unique = [...new Set(models)]
      expect(models).toEqual(unique)
    })
  })

  describe('isModelSupported', () => {
    it('should return true for supported canonical models', () => {
      expect(isModelSupported('gpt-4o')).toBe(true)
      expect(isModelSupported('claude-sonnet-4')).toBe(true)
    })

    it('should return true for supported aliases', () => {
      expect(isModelSupported('gpt4o')).toBe(true)
      expect(isModelSupported('claude4')).toBe(true)
      expect(isModelSupported('sonnet4')).toBe(true)
    })

    it('should return true for Bedrock ARN names', () => {
      expect(isModelSupported('us.anthropic.claude-3-5-sonnet-20240620-v1:0')).toBe(true)
    })

    it('should return false for unsupported models', () => {
      expect(isModelSupported('unknown-model')).toBe(false)
      expect(isModelSupported('gpt-99')).toBe(false)
    })

    it('should handle case insensitive input', () => {
      expect(isModelSupported('GPT4O')).toBe(true)
      expect(isModelSupported('CLAUDE4')).toBe(true)
    })
  })

  describe('getFullModelName', () => {
    it('should return full model name for OpenAI models', () => {
      expect(getFullModelName('gpt4o')).toBe('gpt-4o')
      expect(getFullModelName('gpt-4o')).toBe('gpt-4o')
    })

    it('should return Anthropic name by default for Claude models', () => {
      expect(getFullModelName('claude4')).toBe('claude-sonnet-4')
    })

    it('should return Bedrock ARN when preferBedrock is true', () => {
      expect(getFullModelName('claude4', true)).toBe('global.anthropic.claude-sonnet-4-20250514-v1:0')
    })
  })

  describe('getNormalizedModelName', () => {
    it('should return normalized name for aliases', () => {
      expect(getNormalizedModelName('gpt4o')).toBe('gpt-4o')
      expect(getNormalizedModelName('claude4')).toBe('claude-sonnet-4')
      expect(getNormalizedModelName('sonnet')).toBe('claude-sonnet-4-6')
    })

    it('should return same name for already normalized models', () => {
      expect(getNormalizedModelName('gpt-4o')).toBe('gpt-4o')
      expect(getNormalizedModelName('claude-sonnet-4')).toBe('claude-sonnet-4')
    })
  })

  describe('getModelProvider', () => {
    it('should return correct provider for OpenAI models', () => {
      expect(getModelProvider('gpt4o')).toBe('openai')
      expect(getModelProvider('gpt-4-turbo')).toBe('openai')
    })

    it('should return anthropic provider by default for Claude models', () => {
      expect(getModelProvider('claude4')).toBe('anthropic')
      expect(getModelProvider('sonnet')).toBe('anthropic')
    })

    it('should return bedrock-claude when preferBedrock is true', () => {
      expect(getModelProvider('claude4', true)).toBe('bedrock-claude')
      expect(getModelProvider('claude-3-5-sonnet', true)).toBe('bedrock-claude')
    })

    it('should return openai as fallback for unknown models', () => {
      expect(getModelProvider('unknown-model')).toBe('openai')
    })
  })

  describe('modelSupportsCaching', () => {
    it('should return true for Bedrock Claude models', () => {
      expect(modelSupportsCaching('claude4')).toBe(true)
      expect(modelSupportsCaching('claude-3-5-sonnet')).toBe(true)
      expect(modelSupportsCaching('claude-3-5-haiku')).toBe(true)
    })

    it('should return false for OpenAI models', () => {
      expect(modelSupportsCaching('gpt4o')).toBe(false)
      expect(modelSupportsCaching('gpt-4-turbo')).toBe(false)
    })

    it('should return false for models not available on Bedrock', () => {
      expect(modelSupportsCaching('claude-3-opus')).toBe(false)
    })
  })

  describe('getModelInfo', () => {
    it('should return complete model information', () => {
      const info = getModelInfo('claude4', true)
      expect(info).toEqual({
        normalizedName: 'claude-sonnet-4',
        fullModelId: 'global.anthropic.claude-sonnet-4-20250514-v1:0',
        provider: 'bedrock-claude',
        isSupported: true,
        originalName: 'claude4'
      })
    })
  })

  describe('getLegacyModelMappings', () => {
    it('should return mappings for all models and aliases', () => {
      const mappings = getLegacyModelMappings()
      expect(typeof mappings).toBe('object')
      expect(mappings['gpt4o']).toBe('gpt-4o')
      expect(mappings['claude4']).toBe('global.anthropic.claude-sonnet-4-20250514-v1:0') // Prefers Bedrock
    })

    it('should prefer Bedrock for Claude models', () => {
      const mappings = getLegacyModelMappings()
      // Claude models should map to Bedrock ARNs when available
      expect(mappings['claude-sonnet-4']).toBe('global.anthropic.claude-sonnet-4-20250514-v1:0')
      expect(mappings['claude-3-5-sonnet']).toBe('us.anthropic.claude-3-5-sonnet-20240620-v1:0')
    })
  })

  describe('data structure integrity', () => {
    it('should have valid MODELS structure', () => {
      expect(typeof MODELS).toBe('object')
      Object.entries(MODELS).forEach(([_, model]) => {
        expect(typeof model.normalizedName).toBe('string')
        expect(model.normalizedName.length).toBeGreaterThan(0)
        // At least one provider should be defined
        expect(model.openai || model.anthropic || model.bedrock).toBeTruthy()
      })
    })

    it('should have valid ALIASES structure', () => {
      expect(typeof ALIASES).toBe('object')
      Object.entries(ALIASES).forEach(([_, canonicalKey]) => {
        expect(typeof canonicalKey).toBe('string')
        expect(MODELS[canonicalKey]).toBeDefined()
      })
    })

    it('should have valid BEDROCK_MODELS structure', () => {
      expect(typeof BEDROCK_MODELS).toBe('object')
      expect(typeof BEDROCK_MODELS.claude4).toBe('string')
      expect(typeof BEDROCK_MODELS.claude35).toBe('string')
      expect(typeof BEDROCK_MODELS.claude3haiku).toBe('string')
    })

    it('should ensure all aliases point to valid models', () => {
      Object.entries(ALIASES).forEach(([_, canonicalKey]) => {
        const model = MODELS[canonicalKey]
        expect(model).toBeDefined()
        expect(model.normalizedName).toBeTruthy()
      })
    })

    it('should ensure Bedrock models exist for caching-capable models', () => {
      const cachingModels = ['claude-sonnet-4', 'claude-3-5-sonnet', 'claude-3-5-haiku']
      cachingModels.forEach(modelKey => {
        const model = MODELS[modelKey]
        expect(model).toBeDefined()
        expect(model.bedrock).toBeDefined()
        expect(typeof model.bedrock).toBe('string')
        expect(model.bedrock?.length).toBeGreaterThan(0)
      })
    })
  })

  describe('edge cases', () => {
    it('should handle empty string input', () => {
      const result = normalizeModelName('')
      expect(result.isSupported).toBe(false)
      expect(result.provider).toBe('openai')
    })

    it('should handle whitespace-only input', () => {
      const result = normalizeModelName('   ')
      expect(result.isSupported).toBe(false)
    })

    it('should handle very long input gracefully', () => {
      const longInput = 'a'.repeat(1000)
      const result = normalizeModelName(longInput)
      expect(result.isSupported).toBe(false)
      expect(result.originalName).toBe(longInput)
    })

    it('should handle special characters in input', () => {
      const result = normalizeModelName('claude-4@#$%')
      expect(result.isSupported).toBe(false)
    })
  })
})
