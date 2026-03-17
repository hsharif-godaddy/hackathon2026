import { describe, it, expect } from 'vitest'
import { AgentContextPipeline } from '../agent-context-pipeline.js'

describe('AgentContextPipeline', () => {
  describe('transformContext', () => {
    it('creates user message from text input', async () => {
      const pipeline = new AgentContextPipeline()
      const result = await pipeline.transformContext({
        userMessage: 'hello',
        contextMessages: [],
        conversationMessages: [],
        executionContext: {},
        turnIndex: 0,
      })
      expect(result.userMessage).toEqual({ role: 'user', content: 'hello' })
    })

    it('passes through context and conversation messages', async () => {
      const pipeline = new AgentContextPipeline()
      const contextMessages = [
        { role: 'system' as const, content: 'system prompt' },
      ]
      const conversationMessages = [
        { role: 'user' as const, content: 'previous' },
      ]

      const result = await pipeline.transformContext({
        userMessage: 'hello',
        contextMessages,
        conversationMessages,
        executionContext: {},
        turnIndex: 0,
      })
      expect(result.contextMessages).toBe(contextMessages)
      expect(result.conversationMessages).toBe(conversationMessages)
    })

    it('builds hybrid content when files are provided', async () => {
      const pipeline = new AgentContextPipeline()
      const result = await pipeline.transformContext({
        userMessage: 'describe this image',
        files: [
          {
            input: {
              source: 'test.png',
              mimeType: 'image/png',
            },
            base64Content: 'base64data',
            metadata: {
              size: 100,
              mimeType: 'image/png',
              filename: 'test.png',
              extractedAt: new Date(),
              processingTime: 10,
            },
          },
        ],
        contextMessages: [],
        conversationMessages: [],
        executionContext: {},
        turnIndex: 0,
      })
      // buildHybridContent returns a structured content message
      expect(result.userMessage.role).toBe('user')
    })

    it('returns undefined userMessage for empty prompt without files', async () => {
      const pipeline = new AgentContextPipeline()
      const result = await pipeline.transformContext({
        userMessage: '',
        contextMessages: [],
        conversationMessages: [],
        executionContext: {},
        turnIndex: 0,
      })
      expect(result.userMessage).toBeUndefined()
    })

    it('returns undefined userMessage for whitespace-only prompt', async () => {
      const pipeline = new AgentContextPipeline()
      const result = await pipeline.transformContext({
        userMessage: '   ',
        contextMessages: [],
        conversationMessages: [],
        executionContext: {},
        turnIndex: 0,
      })
      expect(result.userMessage).toBeUndefined()
    })
  })

  describe('convertToLlm', () => {
    it('assembles messages in correct order', () => {
      const pipeline = new AgentContextPipeline()
      const result = pipeline.convertToLlm({
        contextMessages: [{ role: 'system', content: 'context' }],
        conversationMessages: [{ role: 'user', content: 'history' }],
        userMessage: { role: 'user', content: 'now' },
        model: {} as any,
        enablePromptCaching: false,
      })
      expect(result.map((m) => m.content)).toEqual([
        'context',
        'history',
        'now',
      ])
    })

    it('handles empty context and conversation', () => {
      const pipeline = new AgentContextPipeline()
      const result = pipeline.convertToLlm({
        contextMessages: [],
        conversationMessages: [],
        userMessage: { role: 'user', content: 'hello' },
        model: {} as any,
        enablePromptCaching: false,
      })
      expect(result).toHaveLength(1)
      expect(result[0]!.content).toBe('hello')
    })
  })
})
