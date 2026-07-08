/**
 * Tests for model-normalization.ts
 */

import { describe, expect, it } from 'vitest'
import {
  normalizeModelName,
  getAvailableModels,
  isModelSupported,
  getFullModelName,
  getCanonicalModelKey,
  getNormalizedModelName,
  getModelProvider,
  getModelInfo,
  getLegacyModelMappings,
  getDefaultProviderOptions,
  getDefaultModelSettings,
  shouldStripTemperature,
  mergeProviderOptions,
  MODELS,
  ALIASES
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
      const result = normalizeModelName('claude-sonnet-4-6')
      expect(result).toEqual({
        normalizedName: 'claude-sonnet-4-6',
        fullModelId: 'claude-sonnet-4-6',
        provider: 'anthropic',
        isSupported: true,
        originalName: 'claude-sonnet-4-6'
      })
    })

    it('should handle canonical model names', () => {
      const result = normalizeModelName('claude-sonnet-4-5')
      expect(result).toEqual({
        normalizedName: 'claude-sonnet-4-5',
        fullModelId: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        isSupported: true,
        originalName: 'claude-sonnet-4-5'
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
      const result = normalizeModelName('CLAUDE-SONNET-4-6')
      expect(result.normalizedName).toBe('claude-sonnet-4-6')
    })

    it('should normalize azure Kimi to the OpenAI-compatible provider', () => {
      const result = normalizeModelName('azure/Kimi-K2.6')
      expect(result).toEqual({
        normalizedName: 'azure/kimi-k2.6',
        fullModelId: 'azure/Kimi-K2.6',
        provider: 'openai',
        isSupported: true,
        originalName: 'azure/Kimi-K2.6'
      })
    })

    it('should normalize azure Kimi thinking variant to the OpenAI-compatible provider', () => {
      const result = normalizeModelName('azure/Kimi-K2.6-thinking')
      expect(result).toEqual({
        normalizedName: 'azure/kimi-k2.6',
        fullModelId: 'azure/Kimi-K2.6',
        provider: 'openai',
        isSupported: true,
        originalName: 'azure/Kimi-K2.6-thinking'
      })
    })

    it('should trim whitespace for processing but preserve original', () => {
      const result = normalizeModelName('  claude-sonnet-4-6  ')
      expect(result.normalizedName).toBe('claude-sonnet-4-6')
      expect(result.originalName).toBe('  claude-sonnet-4-6  ')
    })
  })

  describe('getAvailableModels', () => {
    it('should return all available models and aliases', () => {
      const models = getAvailableModels()
      expect(models).toBeInstanceOf(Array)
      expect(models.length).toBeGreaterThan(0)
      expect(models).toContain('gpt-4o')
      expect(models).toContain('gpt4o')
      expect(models).toContain('claude-sonnet-4-6')
      expect(models).toContain('sonnet')
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
      expect(isModelSupported('claude-sonnet-4-6')).toBe(true)
      expect(isModelSupported('azure/Kimi-K2.6')).toBe(true)
      expect(isModelSupported('azure/Kimi-K2.6-thinking')).toBe(true)
    })

    it('should return true for supported aliases', () => {
      expect(isModelSupported('gpt4o')).toBe(true)
      expect(isModelSupported('sonnet')).toBe(true)
      expect(isModelSupported('haiku')).toBe(true)
    })


    it('should return false for unsupported models', () => {
      expect(isModelSupported('unknown-model')).toBe(false)
      expect(isModelSupported('gpt-99')).toBe(false)
    })

    it('should handle case insensitive input', () => {
      expect(isModelSupported('GPT4O')).toBe(true)
      expect(isModelSupported('CLAUDE-SONNET-4-6')).toBe(true)
    })
  })

  describe('getFullModelName', () => {
    it('should return full model name for OpenAI models', () => {
      expect(getFullModelName('gpt4o')).toBe('gpt-4o')
      expect(getFullModelName('gpt-4o')).toBe('gpt-4o')
      expect(getFullModelName('azure/Kimi-K2.6')).toBe('azure/Kimi-K2.6')
      expect(getFullModelName('azure/Kimi-K2.6-thinking')).toBe('azure/Kimi-K2.6')
    })

    it('should return Anthropic name by default for Claude models', () => {
      expect(getFullModelName('sonnet')).toBe('claude-sonnet-4-6')
    })

  })

  describe('getNormalizedModelName', () => {
    it('should return normalized name for aliases', () => {
      expect(getNormalizedModelName('gpt4o')).toBe('gpt-4o')
      expect(getNormalizedModelName('sonnet')).toBe('claude-sonnet-4-6')
      expect(getNormalizedModelName('haiku')).toBe('claude-haiku-4-5')
    })

    it('should return same name for already normalized models', () => {
      expect(getNormalizedModelName('gpt-4o')).toBe('gpt-4o')
      expect(getNormalizedModelName('claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
    })
  })

  describe('getCanonicalModelKey', () => {
    it('resolves aliases to the canonical model key', () => {
      expect(getCanonicalModelKey('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5')
      expect(getCanonicalModelKey('sonnet')).toBe('claude-sonnet-4-6')
      expect(getCanonicalModelKey('haiku')).toBe('claude-haiku-4-5')
    })

    it('lowercases and trims unknown / canonical names', () => {
      expect(getCanonicalModelKey('  Azure/Kimi-K2.6  ')).toBe('azure/kimi-k2.6')
      expect(getCanonicalModelKey('claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
    })

    it('keeps Kimi base and thinking variants distinct (unlike normalizedName and fullName)', () => {
      // The two variants share both normalizedName (`azure/kimi-k2.6`) and
      // upstream id (`azure/Kimi-K2.6`), so only the MODELS-map key keeps them apart.
      expect(getCanonicalModelKey('azure/Kimi-K2.6')).toBe('azure/kimi-k2.6')
      expect(getCanonicalModelKey('azure/Kimi-K2.6-thinking')).toBe('azure/kimi-k2.6-thinking')
    })

    it('keeps azure and non-azure sonnet-4-6 distinct (unlike normalizedName)', () => {
      // Both share the normalizedName field `claude-sonnet-4-6`, but they are
      // separate model definitions and must not collapse during dedup.
      expect(getCanonicalModelKey('claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
      expect(getCanonicalModelKey('azure/claude-sonnet-4-6')).toBe('azure/claude-sonnet-4-6')
    })
  })

  describe('getModelProvider', () => {
    it('should return correct provider for OpenAI models', () => {
      expect(getModelProvider('gpt4o')).toBe('openai')
      expect(getModelProvider('gpt-4-turbo')).toBe('openai')
      expect(getModelProvider('azure/Kimi-K2.6')).toBe('openai')
    })

    it('should return anthropic provider by default for Claude models', () => {
      expect(getModelProvider('claude-sonnet-4-6')).toBe('anthropic')
      expect(getModelProvider('sonnet')).toBe('anthropic')
    })


    it('should return openai as fallback for unknown models', () => {
      expect(getModelProvider('unknown-model')).toBe('openai')
    })
  })


  describe('getModelInfo', () => {
    it('should return complete model information', () => {
      const info = getModelInfo('claude-sonnet-4-6')
      expect(info).toEqual({
        normalizedName: 'claude-sonnet-4-6',
        fullModelId: 'claude-sonnet-4-6',
        provider: 'anthropic',
        isSupported: true,
        originalName: 'claude-sonnet-4-6'
      })
    })
  })

  describe('getLegacyModelMappings', () => {
    it('should return mappings for all models and aliases', () => {
      const mappings = getLegacyModelMappings()
      expect(typeof mappings).toBe('object')
      expect(mappings['gpt4o']).toBe('gpt-4o')
      expect(mappings['sonnet']).toBe('claude-sonnet-4-6')
      expect(mappings['azure/kimi-k2.6']).toBe('azure/Kimi-K2.6')
      expect(mappings['azure/kimi-k2.6-thinking']).toBe('azure/Kimi-K2.6')
    })

    it('should map Claude models to Anthropic provider', () => {
      const mappings = getLegacyModelMappings()
      expect(mappings['claude-sonnet-4-6']).toBe('claude-sonnet-4-6')
      expect(mappings['claude-sonnet-4-5']).toBe('claude-sonnet-4-5-20250929')
    })
  })

  describe('data structure integrity', () => {
    it('should have valid MODELS structure', () => {
      expect(typeof MODELS).toBe('object')
      Object.entries(MODELS).forEach(([_, model]) => {
        expect(typeof model.normalizedName).toBe('string')
        expect(model.normalizedName.length).toBeGreaterThan(0)
        // At least one provider should be defined
        expect(model.openai || model.anthropic).toBeTruthy()
      })
    })

    it('should have valid ALIASES structure', () => {
      expect(typeof ALIASES).toBe('object')
      Object.entries(ALIASES).forEach(([_, canonicalKey]) => {
        expect(typeof canonicalKey).toBe('string')
        expect(MODELS[canonicalKey]).toBeDefined()
      })
    })

    it('should ensure all aliases point to valid models', () => {
      Object.entries(ALIASES).forEach(([_, canonicalKey]) => {
        const model = MODELS[canonicalKey]
        expect(model).toBeDefined()
        expect(model.normalizedName).toBeTruthy()
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

  describe('getDefaultProviderOptions', () => {
    it('returns effort low for claude-sonnet-4-6', () => {
      expect(getDefaultProviderOptions('claude-sonnet-4-6')).toEqual({
        anthropic: { effort: 'low' }
      })
    })

    it('returns effort low for sonnet alias', () => {
      expect(getDefaultProviderOptions('sonnet')).toEqual({
        anthropic: { effort: 'low' }
      })
    })

    it('returns effort low for azure claude-sonnet-4-6', () => {
      expect(getDefaultProviderOptions('azure/claude-sonnet-4-6')).toEqual({
        anthropic: { effort: 'low' }
      })
    })

    it('returns reasoning effort none for azure Kimi', () => {
      expect(getDefaultProviderOptions('azure/Kimi-K2.6')).toEqual({
        litellm: {
          extra_body: {
            reasoning_effort: 'none'
          },
          metadata: {
            guardrails: {
              'unicode-security': {
                extra_body: {
                  mode: 'disabled'
                }
              }
            }
          }
        }
      })
    })

    it('sets reasoning effort low for azure Kimi thinking variant', () => {
      expect(getDefaultProviderOptions('azure/Kimi-K2.6-thinking')).toEqual({
        litellm: {
          extra_body: {
            reasoning_effort: 'low'
          },
          metadata: {
            guardrails: {
              'unicode-security': {
                extra_body: {
                  mode: 'disabled'
                }
              }
            }
          }
        }
      })
    })

    it('returns effort high for claude-opus-4-8', () => {
      expect(getDefaultProviderOptions('claude-opus-4-8')).toEqual({
        anthropic: { effort: 'high' }
      })
    })

    it('returns effort low for claude-opus-4-7', () => {
      expect(getDefaultProviderOptions('claude-opus-4-7')).toEqual({
        anthropic: { effort: 'low' }
      })
    })

    it('returns effort low for claude-opus-4-6', () => {
      expect(getDefaultProviderOptions('claude-opus-4-6')).toEqual({
        anthropic: { effort: 'low' }
      })
    })

    it('disables tool streaming for claude-haiku-4-5', () => {
      expect(getDefaultProviderOptions('claude-haiku-4-5')).toEqual({
        anthropic: { toolStreaming: false }
      })
    })

    it('returns undefined for unsupported models', () => {
      expect(getDefaultProviderOptions('unknown-model')).toBeUndefined()
    })
  })

  describe('getDefaultModelSettings', () => {
    it('returns provider options and temperature for azure Kimi', () => {
      expect(getDefaultModelSettings('azure/Kimi-K2.6')).toEqual({
        temperature: 0.6,
        providerOptions: {
          litellm: {
            extra_body: {
              reasoning_effort: 'none'
            },
            metadata: {
              guardrails: {
                'unicode-security': {
                  extra_body: {
                    mode: 'disabled'
                  }
                }
              }
            }
          }
        }
      })
    })

    it('returns temperature 1.0 with reasoning effort low for azure Kimi thinking variant', () => {
      expect(getDefaultModelSettings('azure/Kimi-K2.6-thinking')).toEqual({
        temperature: 1.0,
        providerOptions: {
          litellm: {
            extra_body: {
              reasoning_effort: 'low'
            },
            metadata: {
              guardrails: {
                'unicode-security': {
                  extra_body: {
                    mode: 'disabled'
                  }
                }
              }
            }
          }
        }
      })
    })

    it('returns provider options without temperature for Claude models', () => {
      expect(getDefaultModelSettings('sonnet')).toEqual({
        providerOptions: {
          anthropic: { effort: 'low' }
        }
      })
    })

    it('returns tool streaming disabled for claude-haiku-4-5', () => {
      expect(getDefaultModelSettings('claude-haiku-4-5')).toEqual({
        providerOptions: {
          anthropic: { toolStreaming: false }
        }
      })
    })

    it('returns undefined for models without defaults', () => {
      expect(getDefaultModelSettings('claude-sonnet-4-5')).toBeUndefined()
    })
  })

  describe('shouldStripTemperature', () => {
    it('returns true for azure Kimi', () => {
      expect(shouldStripTemperature('azure/Kimi-K2.6')).toBe(true)
    })

    it('returns true for azure Kimi thinking variant', () => {
      expect(shouldStripTemperature('azure/Kimi-K2.6-thinking')).toBe(true)
    })

    it('returns true for claude-opus-4-8', () => {
      expect(shouldStripTemperature('claude-opus-4-8')).toBe(true)
    })

    it('returns true for claude-opus-4-7', () => {
      expect(shouldStripTemperature('claude-opus-4-7')).toBe(true)
    })

    it('returns false for claude-opus-4-6', () => {
      expect(shouldStripTemperature('claude-opus-4-6')).toBe(false)
    })

    it('returns false for claude-sonnet-4-6', () => {
      expect(shouldStripTemperature('claude-sonnet-4-6')).toBe(false)
    })

    it('returns false for unsupported models', () => {
      expect(shouldStripTemperature('unknown-model')).toBe(false)
    })
  })

  describe('mergeProviderOptions', () => {
    it('deep merges provider options with later values taking precedence', () => {
      expect(mergeProviderOptions(
        { anthropic: { effort: 'low', cacheControl: { type: 'ephemeral' } } },
        { anthropic: { effort: 'medium' } }
      )).toEqual({
        anthropic: {
          effort: 'medium',
          cacheControl: { type: 'ephemeral' }
        }
      })
    })

    it('preserves provider options when later inputs are undefined', () => {
      expect(mergeProviderOptions(
        { anthropic: { effort: 'low' } },
        undefined
      )).toEqual({
        anthropic: { effort: 'low' }
      })
    })

    it('skips empty inputs before merging later provider options', () => {
      expect(mergeProviderOptions(
        {},
        { anthropic: { effort: 'medium' } }
      )).toEqual({
        anthropic: { effort: 'medium' }
      })
    })

    it('does not share nested object references with model defaults', () => {
      const result = mergeProviderOptions(
        getDefaultProviderOptions('sonnet'),
        { openai: { reasoningEffort: 'low' } }
      )
      const anthropic = result?.anthropic as { effort?: string }

      anthropic.effort = 'medium'

      expect(getDefaultProviderOptions('sonnet')).toEqual({
        anthropic: { effort: 'low' }
      })
    })

    it('drops prototype pollution keys while merging', () => {
      const maliciousOptions = JSON.parse(
        '{"anthropic":{"effort":"low","__proto__":{"polluted":true}},"constructor":{"prototype":{"polluted":true}}}'
      )
      const result = mergeProviderOptions(maliciousOptions)

      expect(result).toEqual({
        anthropic: { effort: 'low' }
      })
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })

    it('returns undefined when no options are provided', () => {
      expect(mergeProviderOptions(undefined)).toBeUndefined()
    })
  })
})
