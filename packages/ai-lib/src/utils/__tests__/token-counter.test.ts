/**
 * Tests for token-counter.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  countTokens,
  countTotalTokens,
  countConversationTokens,
  estimateTokens,
  isTokenCountingSupported,
  getModelProvider,
  type TokenCountResult
} from '../token-counter.js'

// Mock the external dependencies
vi.mock('tiktoken', () => ({
  encoding_for_model: vi.fn((model: string) => ({
    encode: vi.fn((text: string) => new Array(Math.ceil(text.length / 4)).fill(0)),
    free: vi.fn()
  }))
}))

vi.mock('@anthropic-ai/tokenizer', () => ({
  countTokens: vi.fn((text: string) => Math.ceil(text.length / 4))
}))

describe('token-counter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('countTokens', () => {
    it('should count tokens for OpenAI models', () => {
      const result = countTokens('Hello world', 'gpt-4o')
      
      expect(result).toEqual({
        tokenCount: expect.any(Number),
        provider: 'openai',
        normalizedModelName: 'gpt-4o'
      })
      expect(result.tokenCount).toBeGreaterThan(0)
    })

    it('should count tokens for Anthropic models', () => {
      const result = countTokens('Hello world', 'claude-3-5-sonnet')
      
      expect(result).toEqual({
        tokenCount: expect.any(Number),
        provider: 'anthropic',
        normalizedModelName: 'claude-3-5-sonnet'
      })
      expect(result.tokenCount).toBeGreaterThan(0)
    })

    it('should count tokens for Bedrock Claude models', () => {
      const result = countTokens('Hello world', 'claude4')
      
      expect(result).toEqual({
        tokenCount: expect.any(Number),
        provider: 'anthropic', // Note: Uses Anthropic tokenizer for Bedrock Claude
        normalizedModelName: 'claude-sonnet-4'
      })
      expect(result.tokenCount).toBeGreaterThan(0)
    })

    it('should handle model aliases correctly', () => {
      const result1 = countTokens('Hello world', 'gpt4o')
      const result2 = countTokens('Hello world', 'gpt-4o')
      
      expect(result1.provider).toBe(result2.provider)
      expect(result1.normalizedModelName).toBe(result2.normalizedModelName)
    })

    it('should handle empty text input', () => {
      const result = countTokens('', 'gpt-4o')
      
      expect(result).toEqual({
        tokenCount: 0,
        provider: 'openai',
        normalizedModelName: 'gpt-4o'
      })
    })

    it('should handle null text input', () => {
      const result = countTokens(null as any, 'gpt-4o')
      
      expect(result).toEqual({
        tokenCount: 0,
        provider: 'openai',
        normalizedModelName: 'gpt-4o'
      })
    })

    it('should handle non-string text input', () => {
      const result = countTokens(123 as any, 'gpt-4o')
      
      expect(result).toEqual({
        tokenCount: 0,
        provider: 'openai',
        normalizedModelName: 'gpt-4o'
      })
    })

    it('should fall back to approximation for unsupported models', () => {
      const text = 'Hello world test'
      const result = countTokens(text, 'unknown-model')
      
      expect(result.tokenCount).toBe(Math.ceil(text.length / 4))
      expect(result.provider).toBe('openai') // Fallback provider
    })

    it('should handle very long text', () => {
      const longText = 'word '.repeat(1000)
      const result = countTokens(longText, 'gpt-4o')
      
      expect(result.tokenCount).toBeGreaterThan(0)
      expect(result.tokenCount).toBeLessThan(longText.length) // Should be less than character count
    })
  })

  describe('countTotalTokens', () => {
    it('should count tokens across multiple texts', () => {
      const texts = ['Hello', 'world', 'test']
      const result = countTotalTokens(texts, 'gpt-4o')
      
      expect(result.tokenCount).toBeGreaterThan(0)
      expect(result.provider).toBe('openai')
      expect(result.normalizedModelName).toBe('gpt-4o')
    })

    it('should handle empty array', () => {
      const result = countTotalTokens([], 'gpt-4o')
      
      expect(result.tokenCount).toBe(0)
    })

    it('should handle array with empty strings', () => {
      const texts = ['', '', '']
      const result = countTotalTokens(texts, 'gpt-4o')
      
      expect(result.tokenCount).toBe(0)
    })

    it('should be equivalent to joining texts and counting', () => {
      const texts = ['Hello', 'world', 'test']
      const totalResult = countTotalTokens(texts, 'gpt-4o')
      const joinedResult = countTokens(texts.join(''), 'gpt-4o')
      
      expect(totalResult.tokenCount).toBe(joinedResult.tokenCount)
    })
  })

  describe('countConversationTokens', () => {
    it('should count tokens in conversation messages', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' }
      ]
      
      const result = countConversationTokens(messages, 'gpt-4o')
      
      expect(result.tokenCount).toBeGreaterThan(0)
      expect(result.provider).toBe('openai')
    })

    it('should handle messages without content', () => {
      const messages = [
        { role: 'user', content: '' },
        { role: 'assistant' } as any, // Missing content
        { role: 'user', content: 'Hello' }
      ]
      
      const result = countConversationTokens(messages, 'gpt-4o')
      
      expect(result.tokenCount).toBeGreaterThan(0) // Should still count 'Hello'
    })

    it('should filter out empty content messages', () => {
      const messages = [
        { role: 'user', content: '   ' }, // Whitespace only
        { role: 'assistant', content: 'Hello' }
      ]
      
      const result = countConversationTokens(messages, 'gpt-4o')
      
      // Should only count the 'Hello' message
      const singleResult = countTokens('Hello', 'gpt-4o')
      expect(result.tokenCount).toBe(singleResult.tokenCount)
    })

    it('should handle empty messages array', () => {
      const result = countConversationTokens([], 'gpt-4o')
      
      expect(result.tokenCount).toBe(0)
    })

    it('should work with different role types', () => {
      const messages = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' }
      ]
      
      const result = countConversationTokens(messages, 'claude-3-5-sonnet')
      
      expect(result.tokenCount).toBeGreaterThan(0)
      expect(result.provider).toBe('anthropic')
    })
  })

  describe('estimateTokens', () => {
    it('should provide rough token estimate', () => {
      const text = 'Hello world test message'
      const estimate = estimateTokens(text)
      
      expect(estimate).toBe(Math.ceil(text.length / 4))
    })

    it('should handle empty string', () => {
      const estimate = estimateTokens('')
      expect(estimate).toBe(0)
    })

    it('should handle null input', () => {
      const estimate = estimateTokens(null as any)
      expect(estimate).toBe(0)
    })

    it('should handle non-string input', () => {
      const estimate = estimateTokens(123 as any)
      expect(estimate).toBe(0)
    })

    it('should provide consistent estimates', () => {
      const text = 'Consistent test text'
      const estimate1 = estimateTokens(text)
      const estimate2 = estimateTokens(text)
      
      expect(estimate1).toBe(estimate2)
    })
  })

  describe('isTokenCountingSupported', () => {
    it('should return true for supported OpenAI models', () => {
      expect(isTokenCountingSupported('gpt-4o')).toBe(true)
      expect(isTokenCountingSupported('gpt4o')).toBe(true)
      expect(isTokenCountingSupported('gpt-4-turbo')).toBe(true)
    })

    it('should return true for supported Anthropic models', () => {
      expect(isTokenCountingSupported('claude-3-5-sonnet')).toBe(true)
      expect(isTokenCountingSupported('claude4')).toBe(true)
      expect(isTokenCountingSupported('sonnet')).toBe(true)
    })

    it('should return true for supported Bedrock models', () => {
      expect(isTokenCountingSupported('claude-sonnet-4')).toBe(true)
      expect(isTokenCountingSupported('global.anthropic.claude-sonnet-4-20250514-v1:0')).toBe(true)
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
      expect(getModelProvider('claude-3-5-sonnet')).toBe('anthropic')
      expect(getModelProvider('claude4')).toBe('anthropic')
    })

    it('should return correct provider for Bedrock models', () => {
      expect(getModelProvider('global.anthropic.claude-sonnet-4-20250514-v1:0')).toBe('bedrock-claude')
    })

    it('should handle unsupported models', () => {
      expect(getModelProvider('unknown-model')).toBe('openai') // Default fallback
    })
  })

  describe('integration with model normalization', () => {
    it('should consistently use normalized model names', () => {
      // Test that aliases resolve to the same normalized name
      const result1 = countTokens('test', 'claude4')
      const result2 = countTokens('test', 'sonnet4')
      const result3 = countTokens('test', 'claude-sonnet-4')
      
      expect(result1.normalizedModelName).toBe('claude-sonnet-4')
      expect(result2.normalizedModelName).toBe('claude-sonnet-4')
      expect(result3.normalizedModelName).toBe('claude-sonnet-4')
    })

    it('should handle provider preferences correctly', () => {
      // Different aliases might have different provider preferences
      const result = countTokens('test', 'claude4')
      expect(['anthropic', 'bedrock-claude']).toContain(result.provider)
    })
  })

  describe('error handling and resilience', () => {
    it('should handle tiktoken encoding errors gracefully', async () => {
      // Mock tiktoken to throw an error
      const { encoding_for_model } = await import('tiktoken')
      vi.mocked(encoding_for_model).mockImplementationOnce(() => {
        throw new Error('Tiktoken error')
      })
      
      // Should fall back to approximation without throwing
      const result = countTokens('Hello world', 'gpt-4o')
      
      expect(result.tokenCount).toBe(Math.ceil('Hello world'.length / 4))
    })

    it('should handle Anthropic tokenizer errors gracefully', async () => {
      // Mock Anthropic tokenizer to throw an error
      const { countTokens: countAnthropicTokens } = await import('@anthropic-ai/tokenizer')
      vi.mocked(countAnthropicTokens).mockImplementationOnce(() => {
        throw new Error('Anthropic tokenizer error')
      })
      
      // Should fall back to approximation without throwing
      const result = countTokens('Hello world', 'claude-3-5-sonnet')
      
      expect(result.tokenCount).toBe(Math.ceil('Hello world'.length / 4))
    })

    it('should handle very long text inputs', () => {
      const veryLongText = 'a'.repeat(100000)
      
      expect(() => {
        countTokens(veryLongText, 'gpt-4o')
      }).not.toThrow()
    })

    it('should handle special characters and Unicode', () => {
      const textWithUnicode = 'Hello 世界 🌍 emoji test'
      
      expect(() => {
        countTokens(textWithUnicode, 'gpt-4o')
      }).not.toThrow()
      
      const result = countTokens(textWithUnicode, 'gpt-4o')
      expect(result.tokenCount).toBeGreaterThan(0)
    })
  })

  describe('performance considerations', () => {
    it('should handle multiple calls efficiently', () => {
      const text = 'Performance test text'
      const startTime = Date.now()
      
      // Make multiple calls
      for (let i = 0; i < 10; i++) {
        countTokens(text, 'gpt-4o')
      }
      
      const endTime = Date.now()
      const duration = endTime - startTime
      
      // Should complete reasonably quickly (less than 1 second)
      expect(duration).toBeLessThan(1000)
    })

    it('should properly free tiktoken encodings', async () => {
      const { encoding_for_model } = await import('tiktoken')
      const mockFree = vi.fn()
      
      vi.mocked(encoding_for_model).mockReturnValue({
        encode: vi.fn(() => [1, 2, 3]),
        free: mockFree
      } as any)
      
      countTokens('test', 'gpt-4o')
      
      expect(mockFree).toHaveBeenCalled()
    })
  })
})