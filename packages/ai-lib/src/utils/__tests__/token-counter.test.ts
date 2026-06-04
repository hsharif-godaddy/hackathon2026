/**
 * Tests for token-counter.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  countTokens,
  countTotalTokens,
  countConversationTokens,
  isTokenCountingSupported,
  getModelProvider
} from '../token-counter.js'

// Mock ai-tokenizer with dynamic import support
vi.mock('ai-tokenizer', () => ({
  Tokenizer: class MockTokenizer {
    constructor(_encoding: unknown) {}
    count(text: string): number {
      return Math.ceil(text.length / 4)
    }
  },
  models: {
    'openai/gpt-4o': true,
    'openai/gpt-4o-mini': true,
    'openai/gpt-4-turbo': true,
    'anthropic/claude-sonnet-4.5': true,
    'anthropic/claude-haiku-4.5': true,
    'google/gemini-3-pro-preview': true,
    'moonshotai/kimi-k2-thinking': true,
    'zai/glm-4.5': true,
  }
}))

vi.mock('ai-tokenizer/encoding/claude', () => ({}))
vi.mock('ai-tokenizer/encoding/o200k_base', () => ({}))
vi.mock('ai-tokenizer/encoding/cl100k_base', () => ({}))

describe('token-counter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('countTokens', () => {
    it('should count tokens for OpenAI models', async () => {
      const result = await countTokens('Hello world', 'gpt-4o')

      expect(result).toEqual({
        tokenCount: expect.any(Number),
        provider: 'openai',
        normalizedModelName: 'gpt-4o'
      })
      expect(result.tokenCount).toBeGreaterThan(0)
    })

    it('should count tokens for Anthropic models', async () => {
      const result = await countTokens('Hello world', 'claude-sonnet-4-6')

      expect(result).toEqual({
        tokenCount: expect.any(Number),
        provider: 'anthropic',
        normalizedModelName: 'claude-sonnet-4-6'
      })
      expect(result.tokenCount).toBeGreaterThan(0)
    })

    it('should count tokens for Claude models using aliases', async () => {
      const result = await countTokens('Hello world', 'sonnet')

      expect(result).toEqual({
        tokenCount: expect.any(Number),
        provider: 'anthropic',
        normalizedModelName: 'claude-sonnet-4-6'
      })
      expect(result.tokenCount).toBeGreaterThan(0)
    })

    it('should handle model aliases correctly', async () => {
      const result1 = await countTokens('Hello world', 'gpt4o')
      const result2 = await countTokens('Hello world', 'gpt-4o')

      expect(result1.provider).toBe(result2.provider)
      expect(result1.normalizedModelName).toBe(result2.normalizedModelName)
    })

    it('should handle empty text input', async () => {
      const result = await countTokens('', 'gpt-4o')

      expect(result).toEqual({
        tokenCount: 0,
        provider: 'openai',
        normalizedModelName: 'gpt-4o'
      })
    })

    it('should handle null text input', async () => {
      const result = await countTokens(null as any, 'gpt-4o')

      expect(result).toEqual({
        tokenCount: 0,
        provider: 'openai',
        normalizedModelName: 'gpt-4o'
      })
    })

    it('should handle non-string text input', async () => {
      const result = await countTokens(123 as any, 'gpt-4o')

      expect(result).toEqual({
        tokenCount: 0,
        provider: 'openai',
        normalizedModelName: 'gpt-4o'
      })
    })

    it('should fall back to approximation for unsupported models', async () => {
      const text = 'Hello world test'
      const result = await countTokens(text, 'unknown-model')

      expect(result.tokenCount).toBe(Math.ceil(text.length / 4))
      expect(result.provider).toBe('openai') // Fallback provider
    })

    it('should handle very long text', async () => {
      const longText = 'word '.repeat(1000)
      const result = await countTokens(longText, 'gpt-4o')

      expect(result.tokenCount).toBeGreaterThan(0)
      expect(result.tokenCount).toBeLessThan(longText.length) // Should be less than character count
    })
  })

  describe('countTotalTokens', () => {
    it('should count tokens across multiple texts', async () => {
      const texts = ['Hello', 'world', 'test']
      const result = await countTotalTokens(texts, 'gpt-4o')

      expect(result.tokenCount).toBeGreaterThan(0)
      expect(result.provider).toBe('openai')
      expect(result.normalizedModelName).toBe('gpt-4o')
    })

    it('should handle empty array', async () => {
      const result = await countTotalTokens([], 'gpt-4o')

      expect(result.tokenCount).toBe(0)
    })

    it('should handle array with empty strings', async () => {
      const texts = ['', '', '']
      const result = await countTotalTokens(texts, 'gpt-4o')

      expect(result.tokenCount).toBe(0)
    })

    it('should be equivalent to joining texts and counting', async () => {
      const texts = ['Hello', 'world', 'test']
      const totalResult = await countTotalTokens(texts, 'gpt-4o')
      const joinedResult = await countTokens(texts.join(''), 'gpt-4o')

      expect(totalResult.tokenCount).toBe(joinedResult.tokenCount)
    })
  })

  describe('countConversationTokens', () => {
    it('should count tokens in conversation messages', async () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' }
      ]

      const result = await countConversationTokens(messages, 'gpt-4o')

      expect(result.tokenCount).toBeGreaterThan(0)
      expect(result.provider).toBe('openai')
    })

    it('should handle messages without content', async () => {
      const messages = [
        { role: 'user', content: '' },
        { role: 'assistant' } as any, // Missing content
        { role: 'user', content: 'Hello' }
      ]

      const result = await countConversationTokens(messages, 'gpt-4o')

      expect(result.tokenCount).toBeGreaterThan(0) // Should still count 'Hello'
    })

    it('should filter out empty content messages', async () => {
      const messages = [
        { role: 'user', content: '   ' }, // Whitespace only
        { role: 'assistant', content: 'Hello' }
      ]

      const result = await countConversationTokens(messages, 'gpt-4o')

      // Should only count the 'Hello' message
      const singleResult = await countTokens('Hello', 'gpt-4o')
      expect(result.tokenCount).toBe(singleResult.tokenCount)
    })

    it('should handle empty messages array', async () => {
      const result = await countConversationTokens([], 'gpt-4o')

      expect(result.tokenCount).toBe(0)
    })

    it('should work with different role types', async () => {
      const messages = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' }
      ]

      const result = await countConversationTokens(messages, 'claude-sonnet-4-6')

      expect(result.tokenCount).toBeGreaterThan(0)
      expect(result.provider).toBe('anthropic')
    })
  })

  describe('isTokenCountingSupported', () => {
    it('should return true for supported OpenAI models', () => {
      expect(isTokenCountingSupported('gpt-4o')).toBe(true)
      expect(isTokenCountingSupported('gpt4o')).toBe(true)
      expect(isTokenCountingSupported('gpt-4-turbo')).toBe(true)
    })

    it('should return true for supported Anthropic models', () => {
      expect(isTokenCountingSupported('claude-sonnet-4-6')).toBe(true)
      expect(isTokenCountingSupported('sonnet')).toBe(true)
      expect(isTokenCountingSupported('haiku')).toBe(true)
    })

    it('should return true for supported Claude models', () => {
      expect(isTokenCountingSupported('claude-sonnet-4-5')).toBe(true)
      expect(isTokenCountingSupported('claude-haiku-4-5')).toBe(true)
    })

    it('should return false for unsupported models', () => {
      expect(isTokenCountingSupported('truly-unknown-model-xyz')).toBe(false)
      expect(isTokenCountingSupported('gpt-99')).toBe(false)
    })

    it('should handle invalid input gracefully', () => {
      expect(isTokenCountingSupported('truly-unknown-model-xyz')).toBe(false)
      expect(isTokenCountingSupported(null as any)).toBe(false)
    })
  })

  describe('getModelProvider', () => {
    it('should return correct provider for OpenAI models', () => {
      expect(getModelProvider('gpt-4o')).toBe('openai')
      expect(getModelProvider('gpt4o')).toBe('openai')
    })

    it('should return correct provider for Anthropic models', () => {
      expect(getModelProvider('claude-sonnet-4-6')).toBe('anthropic')
      expect(getModelProvider('sonnet')).toBe('anthropic')
    })

    it('should return correct provider for Gemini models', () => {
      expect(getModelProvider('gemini-3-flash-preview')).toBe('openai')
    })

    it('should return correct provider for azure Kimi', () => {
      expect(getModelProvider('azure/Kimi-K2.6')).toBe('openai')
      expect(getModelProvider('azure/Kimi-K2.6-thinking')).toBe('openai')
    })

    it('should handle unsupported models', () => {
      expect(getModelProvider('unknown-model')).toBe('openai') // Default fallback
    })
  })

  describe('integration with model normalization', () => {
    it('should consistently use normalized model names', async () => {
      // Test that aliases resolve to the same normalized name
      const result1 = await countTokens('test', 'sonnet')
      const result2 = await countTokens('test', 'claude-sonnet-4-6')

      expect(result1.normalizedModelName).toBe('claude-sonnet-4-6')
      expect(result2.normalizedModelName).toBe('claude-sonnet-4-6')
    })

    it('should handle provider correctly for Claude models', async () => {
      // Claude models should use anthropic provider
      const result = await countTokens('test', 'sonnet')
      expect(result.provider).toBe('anthropic')
    })
  })

  describe('error handling and resilience', () => {
    it('should handle very long text inputs', async () => {
      const veryLongText = 'a'.repeat(100000)

      await expect(countTokens(veryLongText, 'gpt-4o')).resolves.not.toThrow()
    })

    it('should handle special characters and Unicode', async () => {
      const textWithUnicode = 'Hello 世界 🌍 emoji test'

      const result = await countTokens(textWithUnicode, 'gpt-4o')
      expect(result.tokenCount).toBeGreaterThan(0)
    })
  })

  describe('performance considerations', () => {
    it('should handle multiple calls efficiently', async () => {
      const text = 'Performance test text'
      const startTime = Date.now()

      // Make multiple calls
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(countTokens(text, 'gpt-4o'))
      }
      await Promise.all(promises)

      const endTime = Date.now()
      const duration = endTime - startTime

      // Should complete reasonably quickly (less than 1 second)
      expect(duration).toBeLessThan(1000)
    })
  })

  describe('lazy loading behavior', () => {
    it('should load tokenizer on first use and cache it', async () => {
      // First call loads the tokenizer
      const result1 = await countTokens('test', 'gpt-4o')
      expect(result1.tokenCount).toBeGreaterThan(0)

      // Second call should use cached tokenizer
      const result2 = await countTokens('test', 'gpt-4o')
      expect(result2.tokenCount).toBe(result1.tokenCount)
    })

    it('should load different tokenizers for different providers', async () => {
      // Load OpenAI tokenizer
      const openaiResult = await countTokens('test', 'gpt-4o')
      expect(openaiResult.provider).toBe('openai')

      // Load Claude tokenizer
      const claudeResult = await countTokens('test', 'claude-sonnet-4-6')
      expect(claudeResult.provider).toBe('anthropic')
    })
  })
})
