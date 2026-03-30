import { describe, it, expect } from 'vitest'
import { 
  SimpleMessageBuilder, 
  CachingMessageBuilder, 
  ConversationMessageBuilder,
  createSimpleMessageBuilder,
  createCachingMessageBuilder,
  createConversationMessageBuilder
} from '../core/message-builder.js'
import type { AgentContext } from '../core/types.js'

describe('MessageBuilder', () => {
  describe('SimpleMessageBuilder', () => {
    it('should create simple message builder', () => {
      const builder = new SimpleMessageBuilder('Test system prompt')
      expect(builder.getDescription()).toContain('Simple')
    })

    it('should build messages with system prompt and user input', () => {
      const builder = new SimpleMessageBuilder('You are helpful.')
      const messages = builder.buildMessages('Hello')
      
      expect(messages).toHaveLength(2)
      expect(messages[0]).toEqual({
        role: 'system',
        content: 'You are helpful.'
      })
      expect(messages[1]).toEqual({
        role: 'user', 
        content: 'Hello'
      })
    })

    it('should handle empty system prompt', () => {
      const builder = new SimpleMessageBuilder('')
      const messages = builder.buildMessages('Hello')
      
      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual({
        role: 'user',
        content: 'Hello'
      })
    })

    it('should include conversation history', () => {
      const builder = new SimpleMessageBuilder('You are helpful.')
      const context: AgentContext = {
        messages: [
          { role: 'user', content: 'Previous question' },
          { role: 'assistant', content: 'Previous answer' }
        ]
      }
      
      const messages = builder.buildMessages('New question', context)
      
      expect(messages).toHaveLength(4)
      expect(messages[1]).toEqual({ role: 'user', content: 'Previous question' })
      expect(messages[2]).toEqual({ role: 'assistant', content: 'Previous answer' })
      expect(messages[3]).toEqual({ role: 'user', content: 'New question' })
    })

    it('should create via factory function', () => {
      const builder = createSimpleMessageBuilder('Test prompt')
      expect(builder).toBeInstanceOf(SimpleMessageBuilder)
    })
  })

  describe('CachingMessageBuilder', () => {
    it('should create caching message builder', () => {
      const builder = new CachingMessageBuilder('Test system prompt')
      expect(builder.getDescription()).toContain('Caching')
    })

    it('should build messages with cache metadata', () => {
      const builder = new CachingMessageBuilder('You are helpful.')
      const messages = builder.buildMessages('Hello')
      
      expect(messages).toHaveLength(2)
      
      const systemMessage = messages[0] as any
      expect(systemMessage.role).toBe('system')
      expect(systemMessage.content).toBe('You are helpful.')
      expect(systemMessage.providerOptions).toEqual({
        anthropic: { cacheControl: { type: 'default' } }
      })
    })

    it('should handle empty system prompt', () => {
      const builder = new CachingMessageBuilder('')
      const messages = builder.buildMessages('Hello')
      
      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual({
        role: 'user',
        content: 'Hello'
      })
    })

    it('should create via factory function', () => {
      const builder = createCachingMessageBuilder('Test prompt')
      expect(builder).toBeInstanceOf(CachingMessageBuilder)
    })
  })

  describe('ConversationMessageBuilder', () => {
    it('should create conversation message builder', () => {
      const builder = new ConversationMessageBuilder('Test system prompt')
      expect(builder.getDescription()).toContain('Multi-turn')
    })

    it('should build messages without caching by default', () => {
      const builder = new ConversationMessageBuilder('You are helpful.')
      const messages = builder.buildMessages('Hello')
      
      expect(messages).toHaveLength(2)
      expect(messages[0]).toEqual({
        role: 'system',
        content: 'You are helpful.'
      })
    })

    it('should build messages with caching when enabled', () => {
      const builder = new ConversationMessageBuilder('You are helpful.', true)
      const messages = builder.buildMessages('Hello')
      
      expect(messages).toHaveLength(2)
      
      const systemMessage = messages[0] as any
      expect(systemMessage.role).toBe('system')
      expect(systemMessage.content).toBe('You are helpful.')
      expect(systemMessage.providerOptions).toEqual({
        anthropic: { cacheControl: { type: 'default' } }
      })
    })

    it('should include full conversation history', () => {
      const builder = new ConversationMessageBuilder('You are helpful.')
      const context: AgentContext = {
        messages: [
          { role: 'user', content: 'First question' },
          { role: 'assistant', content: 'First answer' },
          { role: 'user', content: 'Second question' },
          { role: 'assistant', content: 'Second answer' }
        ]
      }
      
      const messages = builder.buildMessages('Third question', context)
      
      expect(messages).toHaveLength(6) // system + 4 history + new user
      expect(messages[0]?.role).toBe('system')
      expect(messages[1]).toEqual({ role: 'user', content: 'First question' })
      expect(messages[2]).toEqual({ role: 'assistant', content: 'First answer' })
      expect(messages[3]).toEqual({ role: 'user', content: 'Second question' })
      expect(messages[4]).toEqual({ role: 'assistant', content: 'Second answer' })
      expect(messages[5]).toEqual({ role: 'user', content: 'Third question' })
    })

    it('should create via factory function', () => {
      const builder = createConversationMessageBuilder('Test prompt', true)
      expect(builder).toBeInstanceOf(ConversationMessageBuilder)
    })
  })

  describe('Factory Functions', () => {
    it('should create correct builder types', () => {
      const simple = createSimpleMessageBuilder('prompt')
      const caching = createCachingMessageBuilder('prompt')
      const conversation = createConversationMessageBuilder('prompt')
      
      expect(simple).toBeInstanceOf(SimpleMessageBuilder)
      expect(caching).toBeInstanceOf(CachingMessageBuilder)
      expect(conversation).toBeInstanceOf(ConversationMessageBuilder)
    })

    it('should pass parameters correctly', () => {
      const prompt = 'Test system prompt'
      
      const simple = createSimpleMessageBuilder(prompt)
      const caching = createCachingMessageBuilder(prompt)
      const conversation = createConversationMessageBuilder(prompt, true)
      
      // Test that they all use the same prompt
      const simpleMessages = simple.buildMessages('test')
      const cachingMessages = caching.buildMessages('test')
      const conversationMessages = conversation.buildMessages('test')
      
      expect(simpleMessages[0]?.content).toBe(prompt)
      expect(cachingMessages[0]?.content).toBe(prompt)
      expect(conversationMessages[0]?.content).toBe(prompt)
    })
  })
})
