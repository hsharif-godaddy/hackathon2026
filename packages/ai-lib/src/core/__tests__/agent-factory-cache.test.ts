/**
 * Tests for cache point preservation in AgentWrapper
 * Tests that cachePoint metadata on conversationMessages is properly converted to providerOptions
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AgentWrapper } from '../agent-factory.js'
import type { AgentConfig, ModelMessage } from '../types.js'

vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof import('ai')>()
  const MockToolLoopAgent = vi.fn()
  return {
    ...actual,
    ToolLoopAgent: MockToolLoopAgent
  }
})

describe('AgentWrapper - Cache Point Preservation', () => {
  let mockAgent: {
    generate: ReturnType<typeof vi.fn>
    stream: ReturnType<typeof vi.fn>
  }
  let agentWrapper: AgentWrapper
  let lastSettings: any
  let MockToolLoopAgent: any

  beforeEach(async () => {
    mockAgent = {
      generate: vi.fn(),
      stream: vi.fn()
    }

    const aiModule = await import('ai')
    MockToolLoopAgent = aiModule.ToolLoopAgent as any
    MockToolLoopAgent.mockImplementation((settings: any) => {
      lastSettings = settings
      return mockAgent
    })

    const mockModel = {
      provider: 'bedrock',
      modelId: 'anthropic.claude-3-sonnet',
      doGenerate: vi.fn(),
      doStream: vi.fn()
    }

    const config: AgentConfig = {
      name: 'test-agent',
      model: mockModel as any,
      system: 'Test system prompt'
    }

    agentWrapper = new AgentWrapper(config)
  })

  it('should preserve cachePoint metadata from conversationMessages by converting to providerOptions', async () => {
    // Mock conversation messages with cachePoint metadata (as would come from afterHistoryMessages)
    const conversationMessages: any[] = [
      {
        role: 'user',
        content: 'Previous message'
      },
      {
        role: 'assistant',
        content: 'Previous response'
      },
      {
        role: 'user',
        content: 'Context with cache point',
        cachePoint: { type: 'ephemeral' }
      }
    ]

    mockAgent.stream.mockResolvedValue({
      textStream: (async function* () {
        yield 'test response'
      })(),
      baseStream: null,
      usage: Promise.resolve({ totalTokens: 100, promptTokens: 50, completionTokens: 50 }),
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([])
    })

    await agentWrapper.streamGenerate('Current prompt', {
      messages: conversationMessages as ModelMessage[]
    })

    // Verify that ToolLoopAgent was called
    expect(MockToolLoopAgent).toHaveBeenCalled()

    // Get the prepared call parameters
    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    // Check that messages were passed
    expect(prepared.messages).toBeDefined()
    expect(prepared.messages.length).toBeGreaterThan(0)

    // Find the message that had cachePoint
    const messageWithCache = prepared.messages.find((msg: any) =>
      msg.content === 'Context with cache point'
    )

    expect(messageWithCache).toBeDefined()

    // Verify cachePoint was converted to providerOptions
    expect(messageWithCache.cachePoint).toBeUndefined() // Should be removed
    expect(messageWithCache.providerOptions).toBeDefined()
    expect(messageWithCache.providerOptions.bedrock).toBeDefined()
    expect(messageWithCache.providerOptions.bedrock.cachePoint).toBe('ephemeral')
  })

  it('should handle conversationMessages without cachePoint', async () => {
    const conversationMessages: any[] = [
      {
        role: 'user',
        content: 'Message without cache point'
      },
      {
        role: 'assistant',
        content: 'Response without cache point'
      }
    ]

    mockAgent.stream.mockResolvedValue({
      textStream: (async function* () {
        yield 'test response'
      })(),
      baseStream: null,
      usage: Promise.resolve({ totalTokens: 100, promptTokens: 50, completionTokens: 50 }),
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([])
    })

    await agentWrapper.streamGenerate('Current prompt', {
      messages: conversationMessages as ModelMessage[]
    })

    expect(MockToolLoopAgent).toHaveBeenCalled()

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    // Verify messages are passed through without modification
    const userMessage = prepared.messages.find((msg: any) =>
      msg.content === 'Message without cache point'
    )

    expect(userMessage).toBeDefined()
    expect(userMessage.cachePoint).toBeUndefined()
    expect(userMessage.providerOptions).toBeUndefined()
  })

  it('should preserve cachePoint for contextMessages (existing behavior)', async () => {
    const contextMessages = [
      {
        role: 'user' as const,
        content: 'Context message with cache',
        cachePoint: { type: 'ephemeral' as const }
      }
    ]

    mockAgent.stream.mockResolvedValue({
      textStream: (async function* () {
        yield 'test response'
      })(),
      baseStream: null,
      usage: Promise.resolve({ totalTokens: 100, promptTokens: 50, completionTokens: 50 }),
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([])
    })

    await agentWrapper.streamGenerate('Current prompt', {
      context: contextMessages
    })

    expect(MockToolLoopAgent).toHaveBeenCalled()

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    // Context message content may be in different format (string or array)
    const contextMessage = prepared.messages.find((msg: any) => {
      if (typeof msg.content === 'string') {
        return msg.content === 'Context message with cache'
      }
      if (Array.isArray(msg.content)) {
        const textParts = msg.content.filter((part: any) => part.type === 'text')
        return textParts.some((part: any) => part.text === 'Context message with cache')
      }
      return false
    })

    expect(contextMessage).toBeDefined()
    expect(contextMessage.providerOptions).toBeDefined()
    expect(contextMessage.providerOptions.bedrock).toBeDefined()
    expect(contextMessage.providerOptions.bedrock.cachePoint).toBe('ephemeral')
  })

  it('should handle mixed messages with and without cachePoint', async () => {
    const conversationMessages: any[] = [
      {
        role: 'user',
        content: 'Message 1 without cache'
      },
      {
        role: 'assistant',
        content: 'Response 1'
      },
      {
        role: 'user',
        content: 'Message 2 with cache',
        cachePoint: { type: 'ephemeral' }
      },
      {
        role: 'assistant',
        content: 'Response 2'
      },
      {
        role: 'user',
        content: 'Message 3 without cache'
      }
    ]

    mockAgent.stream.mockResolvedValue({
      textStream: (async function* () {
        yield 'test response'
      })(),
      baseStream: null,
      usage: Promise.resolve({ totalTokens: 100, promptTokens: 50, completionTokens: 50 }),
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([])
    })

    await agentWrapper.streamGenerate('Current prompt', {
      messages: conversationMessages as ModelMessage[]
    })

    expect(MockToolLoopAgent).toHaveBeenCalled()

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    // Verify message without cache has no providerOptions
    const msg1 = prepared.messages.find((msg: any) =>
      msg.content === 'Message 1 without cache'
    )
    expect(msg1.providerOptions).toBeUndefined()

    // Verify message with cache has providerOptions
    const msg2 = prepared.messages.find((msg: any) =>
      msg.content === 'Message 2 with cache'
    )
    expect(msg2.providerOptions).toBeDefined()
    expect(msg2.providerOptions.bedrock.cachePoint).toBe('ephemeral')
    expect(msg2.cachePoint).toBeUndefined()

    // Verify message without cache has no providerOptions
    const msg3 = prepared.messages.find((msg: any) =>
      msg.content === 'Message 3 without cache'
    )
    expect(msg3.providerOptions).toBeUndefined()
  })
})
