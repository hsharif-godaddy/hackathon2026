import { describe, it, expect, beforeEach } from 'vitest'
import { Agent } from '../core/agent.js'
import { createCachingMessageBuilder } from '../core/message-builder.js'

describe('Agent', () => {
  let agent: Agent

  beforeEach(() => {
    agent = new Agent({
      name: 'Test Agent',
      systemPrompt: 'You are a helpful assistant.',
      model: 'gpt-4o',
      tools: [],
      temperature: 0.7
    })
  })

  describe('Configuration', () => {
    it('should create agent with correct configuration', () => {
      const config = agent.getConfig()
      
      expect(config.name).toBe('Test Agent')
      expect(config.systemPrompt).toBe('You are a helpful assistant.')
      expect(config.model).toBe('gpt-4o')
      expect(config.temperature).toBe(0.7)
      expect(config.tools).toEqual([])
    })

    it('should apply default values', () => {
      const minimalAgent = new Agent({
        name: 'Minimal Agent'
      })
      
      const config = minimalAgent.getConfig()
      expect(config.systemPrompt).toBe('')
      expect(config.model).toBe('gpt-4o')
      expect(config.temperature).toBe(0.7)
      expect(config.maxTokens).toBe(2000)
      expect(config.enableLoopControl).toBe(false)
    })

    it('should accept custom message builder', () => {
      const customBuilder = createCachingMessageBuilder('Custom prompt')
      const agentWithBuilder = new Agent({
        name: 'Custom Agent',
        messageBuilder: customBuilder
      })
      
      expect(agentWithBuilder.getMessageBuilder()).toBe(customBuilder)
    })
  })

  describe('Message Builder Integration', () => {
    it('should use SimpleMessageBuilder by default', () => {
      const builder = agent.getMessageBuilder()
      expect(builder).toBeDefined()
      expect(builder.getDescription()).toContain('Simple')
    })

    it('should create SimpleMessageBuilder from systemPrompt', () => {
      const agentWithPrompt = new Agent({
        name: 'Prompt Agent',
        systemPrompt: 'Test prompt'
      })
      
      const builder = agentWithPrompt.getMessageBuilder()
      expect(builder.getDescription()).toContain('Simple')
    })

    it('should use provided message builder', () => {
      const cachingBuilder = createCachingMessageBuilder('Cached prompt')
      const agentWithCaching = new Agent({
        name: 'Cached Agent',
        messageBuilder: cachingBuilder
      })
      
      const builder = agentWithCaching.getMessageBuilder()
      expect(builder.getDescription()).toContain('Caching')
    })
  })


  describe('Tool Configuration', () => {
    it('should handle empty tools array', () => {
      const config = agent.getConfig()
      expect(config.tools).toEqual([])
    })

    it('should accept tools array', async () => {
      const { tool } = await import('ai')
      const { z } = await import('zod')
      
      const tools = [
        tool({
          description: 'Test tool',
          inputSchema: z.object({}),
          execute: async () => ({})
        })
      ]
      
      const agentWithTools = new Agent({
        name: 'Tool Agent',
        tools
      })
      
      expect(agentWithTools.getConfig().tools).toHaveLength(1)
    })
  })

  describe('Provider Options', () => {
    it('should handle empty provider options', () => {
      const config = agent.getConfig()
      expect(config.providerOptions).toEqual({})
    })

    it('should accept provider options', () => {
      const providerOptions = { temperature: 0.5, maxTokens: 1000 }
      
      const agentWithOptions = new Agent({
        name: 'Options Agent',
        providerOptions
      })
      
      expect(agentWithOptions.getConfig().providerOptions).toEqual(providerOptions)
    })
  })
})
