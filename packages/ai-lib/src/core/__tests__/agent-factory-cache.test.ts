/**
 * Tests for cache point preservation in AgentWrapper
 * Tests that cachePoint metadata on conversationMessages is properly converted to providerOptions
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AgentWrapper } from '../agent-factory.js'
import type { AgentConfig, ModelMessage, ProcessedFile } from '../types.js'
import type { ContextPipeline } from '../context-pipeline.js'
import { defaultConvertToLlm, buildUserMessage } from '../context-normalization.js'

// Create a mock pipeline that uses the real defaultConvertToLlm
// so that prompt caching, cachePoint conversion, etc. are tested end-to-end
const createMockPipeline = (): ContextPipeline => ({
  transformContext: async (input) => ({
    contextMessages: input.contextMessages,
    conversationMessages: input.conversationMessages,
    userMessage: buildUserMessage(input.userMessage, input.files),
  }),
  convertToLlm: (input) => defaultConvertToLlm(input),
})

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
      system: 'Test system prompt',
      contextPipeline: createMockPipeline(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
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

describe('AgentWrapper - Automatic Prompt Caching', () => {
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
      provider: 'anthropic',
      modelId: 'claude-3-5-sonnet-20241022',
      doGenerate: vi.fn(),
      doStream: vi.fn()
    }

    const config: AgentConfig = {
      name: 'test-agent',
      model: mockModel as any,
      system: 'Test system prompt',
      enablePromptCaching: true,
      contextPipeline: createMockPipeline(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    agentWrapper = new AgentWrapper(config)
  })

  it('should apply cache breakpoint to last history message, not new user message', async () => {
    const conversationMessages: any[] = [
      {
        role: 'user',
        content: 'First message'
      },
      {
        role: 'assistant',
        content: 'First response'
      },
      {
        role: 'user',
        content: 'Second message'
      },
      {
        role: 'assistant',
        content: 'Second response'
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

    await agentWrapper.streamGenerate('Third message', {
      messages: conversationMessages as ModelMessage[]
    })

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    // Find the last history message (should have cache control)
    const lastHistoryMessage = prepared.messages.find((msg: any) =>
      msg.content === 'Second response'
    )

    // Find the new user message (should NOT have cache control)
    const newUserMessage = prepared.messages.find((msg: any) =>
      msg.content === 'Third message'
    )

    expect(lastHistoryMessage).toBeDefined()
    expect(newUserMessage).toBeDefined()

    // Last history message should have cache control
    expect(lastHistoryMessage.providerOptions?.anthropic?.cacheControl).toBeDefined()
    expect(lastHistoryMessage.providerOptions.anthropic.cacheControl.type).toBe('ephemeral')

    // New user message should NOT have cache control
    expect(newUserMessage.providerOptions?.anthropic?.cacheControl).toBeUndefined()
  })

  it('should cache last history message but not system context on subsequent turns', async () => {
    const conversationMessages: any[] = [
      {
        role: 'user',
        content: 'First message'
      },
      {
        role: 'assistant',
        content: 'First response'
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

    await agentWrapper.streamGenerate('Second message', {
      messages: conversationMessages as ModelMessage[],
      context: [
        {
          role: 'system',
          content: 'Injected system context'
        }
      ]
    })

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    const injectedSystem = prepared.messages.find((msg: any) =>
      msg.content === 'Injected system context'
    )
    const lastHistoryMessage = prepared.messages.find((msg: any) =>
      msg.content === 'First response'
    )

    expect(injectedSystem).toBeDefined()
    expect(lastHistoryMessage).toBeDefined()
    // Subsequent turns: system messages should NOT consume cache breakpoints
    // (system prompt is already cached at ToolLoopAgent level)
    expect(injectedSystem.providerOptions?.anthropic?.cacheControl).toBeUndefined()
    // Last history message should get a cache breakpoint
    expect(lastHistoryMessage.providerOptions?.anthropic?.cacheControl).toBeDefined()
  })

  it('should apply cache breakpoint to system prompt when enabled', async () => {
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

    await agentWrapper.streamGenerate('First message', {})

    // Check that ToolLoopAgent was initialized with cached system prompt
    const initArgs = MockToolLoopAgent.mock.calls[0][0]
    expect(initArgs.instructions).toBeDefined()

    // System prompt should be converted to object with providerOptions
    if (typeof initArgs.instructions === 'object') {
      expect(initArgs.instructions.role).toBe('system')
      expect(initArgs.instructions.providerOptions?.anthropic?.cacheControl).toBeDefined()
      expect(initArgs.instructions.providerOptions.anthropic.cacheControl.type).toBe('ephemeral')
    }
  })

  it('should not apply caching when enablePromptCaching is false', async () => {
    const mockModel = {
      provider: 'anthropic',
      modelId: 'claude-3-5-sonnet-20241022',
      doGenerate: vi.fn(),
      doStream: vi.fn()
    }

    const config: AgentConfig = {
      name: 'test-agent',
      model: mockModel as any,
      system: 'Test system prompt',
      enablePromptCaching: false,
      contextPipeline: createMockPipeline(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    const nonCachedAgent = new AgentWrapper(config)

    const conversationMessages: any[] = [
      {
        role: 'user',
        content: 'First message'
      },
      {
        role: 'assistant',
        content: 'First response'
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

    await nonCachedAgent.streamGenerate('Second message', {
      messages: conversationMessages as ModelMessage[]
    })

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    // No messages should have cache control
    const messagesWithCache = prepared.messages.filter((msg: any) =>
      msg.providerOptions?.anthropic?.cacheControl
    )

    expect(messagesWithCache).toHaveLength(0)
  })

  it('should apply caching to conversation messages via pipeline', async () => {
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

    // Conversation history with multiple exchanges
    const conversationMessages: any[] = [
      { role: 'user', content: 'Message 1' },
      { role: 'assistant', content: 'Response 1' },
    ]

    await agentWrapper.streamGenerate('Message 2', {
      messages: conversationMessages as ModelMessage[]
    })

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    expect(prepared.messages).toBeDefined()
    expect(prepared.messages.length).toBe(3)

    // Second message (last history message) should have cache control
    const secondMessage = prepared.messages[1]
    expect(secondMessage.providerOptions?.anthropic?.cacheControl).toBeDefined()
    expect(secondMessage.providerOptions.anthropic.cacheControl.type).toBe('ephemeral')

    // Last message (new user message) should NOT have cache control
    const lastMessage = prepared.messages[2]
    expect(lastMessage.providerOptions?.anthropic?.cacheControl).toBeUndefined()
  })

  it('should include file attachments on first-turn request (no history)', async () => {
    // Mock file attachment (vision-compatible image)
    const mockFile = {
      input: {
        type: 'url' as const,
        url: 'https://example.com/test.png'
      },
      base64Content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      metadata: {
        size: 95,
        mimeType: 'image/png',
        filename: 'test.png',
        extractedAt: new Date(),
        processingTime: 10
      }
    }

    mockAgent.stream.mockResolvedValue({
      textStream: (async function* () {
        yield 'I can see the image'
      })(),
      baseStream: null,
      usage: Promise.resolve({ totalTokens: 100, promptTokens: 50, completionTokens: 50 }),
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([])
    })

    // First turn with file attachment, no conversation history
    await agentWrapper.streamGenerate('What is in this image?', {
      files: [mockFile]
    })

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    // Find the user message with the file
    const userMessage = prepared.messages.find((msg: any) => msg.role === 'user')

    expect(userMessage).toBeDefined()

    // Message content should be an array (multi-modal content with text + image)
    expect(Array.isArray(userMessage.content)).toBe(true)

    // Should contain a text block
    const textBlock = (userMessage.content as any[]).find((block: any) => block.type === 'text')
    expect(textBlock).toBeDefined()
    expect(textBlock.text).toBe('What is in this image?')

    // Should contain an image block with base64 data
    const imageBlock = (userMessage.content as any[]).find((block: any) => block.type === 'image')
    expect(imageBlock).toBeDefined()
    expect(imageBlock.image).toContain('data:image/png;base64,')
    expect(imageBlock.image).toContain(mockFile.base64Content)
  })

  it('should apply cache control to first user message on initial request', async () => {
    mockAgent.stream.mockResolvedValue({
      textStream: (async function* () {
        yield 'Hello!'
      })(),
      baseStream: null,
      usage: Promise.resolve({ totalTokens: 100, promptTokens: 50, completionTokens: 50 }),
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([])
    })

    // First turn with no conversation history
    await agentWrapper.streamGenerate('First message', {})

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    // Should have exactly one user message
    const userMessages = prepared.messages.filter((msg: any) => msg.role === 'user')
    expect(userMessages.length).toBe(1)

    // First user message should have cache control (so it's cached on request #1)
    const firstUserMessage = userMessages[0]
    expect(firstUserMessage.providerOptions?.anthropic?.cacheControl).toBeDefined()
    expect(firstUserMessage.providerOptions.anthropic.cacheControl.type).toBe('ephemeral')
  })

  it('should apply cache control to first user message even when context exists', async () => {
    mockAgent.stream.mockResolvedValue({
      textStream: (async function* () {
        yield 'Response'
      })(),
      baseStream: null,
      usage: Promise.resolve({ totalTokens: 100, promptTokens: 50, completionTokens: 50 }),
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([])
    })

    // Context messages (system reminders, etc.)
    const contextMessages = [
      { role: 'user' as const, content: 'System context 1' },
      { role: 'user' as const, content: 'System context 2' }
    ]

    // First turn with context but no conversation history
    await agentWrapper.streamGenerate('First user message', {
      context: contextMessages
    })

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    // Find the first real user message (not context)
    const userMessages = prepared.messages.filter((msg: any) => msg.role === 'user')
    const firstUserMessage = userMessages.find((msg: any) => msg.content === 'First user message')

    expect(firstUserMessage).toBeDefined()

    // First user message should have cache control even though context exists
    expect(firstUserMessage.providerOptions?.anthropic?.cacheControl).toBeDefined()
    expect(firstUserMessage.providerOptions.anthropic.cacheControl.type).toBe('ephemeral')
  })

  it('should cache last history message when history ends with assistant', async () => {
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

    // Conversation history ending with assistant message
    const conversationMessages: any[] = [
      { role: 'user', content: 'User 1' },
      { role: 'assistant', content: 'Assistant 1' },
      { role: 'user', content: 'User 2' },
      { role: 'assistant', content: 'Assistant 2' }
    ]

    await agentWrapper.streamGenerate('User 3', {
      messages: conversationMessages as ModelMessage[]
    })

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    expect(prepared.messages).toBeDefined()
    expect(prepared.messages.length).toBe(5) // 4 history + 1 new user message

    // Last assistant message (last in history) should have cache control
    const lastAssistantMessage = prepared.messages[3]
    expect(lastAssistantMessage.role).toBe('assistant')
    expect(lastAssistantMessage.content).toBe('Assistant 2')
    expect(lastAssistantMessage.providerOptions?.anthropic?.cacheControl).toBeDefined()
    expect(lastAssistantMessage.providerOptions.anthropic.cacheControl.type).toBe('ephemeral')
  })

  it('should cache single assistant message in short history', async () => {
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

    // Short history: just one assistant response
    const conversationMessages: any[] = [
      { role: 'assistant', content: 'Previous assistant response' },
    ]

    await agentWrapper.streamGenerate('New user input', {
      messages: conversationMessages as ModelMessage[]
    })

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    expect(prepared.messages).toBeDefined()
    expect(prepared.messages.length).toBe(2)

    // The single assistant message should be cached
    const assistantMessage = prepared.messages[0]
    expect(assistantMessage.role).toBe('assistant')
    expect(assistantMessage.content).toBe('Previous assistant response')
    expect(assistantMessage.providerOptions?.anthropic?.cacheControl).toBeDefined()
    expect(assistantMessage.providerOptions.anthropic.cacheControl.type).toBe('ephemeral')

    // New user message should NOT be cached
    const userMessage = prepared.messages[1]
    expect(userMessage.role).toBe('user')
    expect(userMessage.providerOptions?.anthropic?.cacheControl).toBeUndefined()
  })

  it('should cache first user message with context present (first turn)', async () => {
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

    // First turn with context but no conversation history
    const contextMessages = [
      { role: 'system' as const, content: 'System context' }
    ]

    await agentWrapper.streamGenerate('First user message', {
      context: contextMessages
    })

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    expect(prepared.messages).toBeDefined()
    expect(prepared.messages.length).toBe(2)

    // System context should be cached
    const systemMessage = prepared.messages[0]
    expect(systemMessage.role).toBe('system')
    expect(systemMessage.providerOptions?.anthropic?.cacheControl).toBeDefined()

    // First user message should ALSO be cached (first-turn behavior)
    const userMessage = prepared.messages[1]
    expect(userMessage.role).toBe('user')
    expect(userMessage.content).toBe('First user message')
    expect(userMessage.providerOptions?.anthropic?.cacheControl).toBeDefined()
    expect(userMessage.providerOptions.anthropic.cacheControl.type).toBe('ephemeral')
  })

  it('should preserve existing cache metadata on conversation messages', async () => {
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

    // Conversation messages with existing providerOptions cache metadata
    const conversationMessages: any[] = [
      {
        role: 'user',
        content: 'Previous user message',
        providerOptions: {
          anthropic: {
            cacheControl: { type: 'ephemeral' as const }
          },
          bedrock: {
            cachePoint: 'ephemeral' as const
          }
        }
      },
      {
        role: 'assistant',
        content: 'Previous response'
      },
    ]

    // Context message with existing cache metadata
    const contextMessages = [
      {
        role: 'system' as const,
        content: 'System with existing cache',
        cachePoint: { type: 'ephemeral' as const }
      }
    ]

    await agentWrapper.streamGenerate('New user message', {
      messages: conversationMessages as ModelMessage[],
      context: contextMessages
    })

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    expect(prepared.messages).toBeDefined()
    expect(prepared.messages.length).toBe(4) // 1 context + 2 history + 1 new user

    // Context message should have cache metadata from cachePoint conversion
    const systemMessage = prepared.messages[0]
    expect(systemMessage.role).toBe('system')
    expect(systemMessage.content).toBe('System with existing cache')
    expect(systemMessage.providerOptions?.anthropic?.cacheControl).toBeDefined()
    expect(systemMessage.providerOptions.anthropic.cacheControl.type).toBe('ephemeral')

    // First user message should preserve existing cache metadata
    const firstUserMessage = prepared.messages[1]
    expect(firstUserMessage.role).toBe('user')
    expect(firstUserMessage.content).toBe('Previous user message')
    expect(firstUserMessage.providerOptions?.anthropic?.cacheControl).toBeDefined()
    expect(firstUserMessage.providerOptions.anthropic.cacheControl.type).toBe('ephemeral')

    // Assistant message should have cache metadata (last history message)
    const assistantMessage = prepared.messages[2]
    expect(assistantMessage.role).toBe('assistant')
    expect(assistantMessage.content).toBe('Previous response')
    expect(assistantMessage.providerOptions?.anthropic?.cacheControl).toBeDefined()

    // New user message should NOT have cache metadata
    const newUserMessage = prepared.messages[3]
    expect(newUserMessage.role).toBe('user')
    expect(newUserMessage.content).toBe('New user message')
    expect(newUserMessage.providerOptions?.anthropic?.cacheControl).toBeUndefined()
  })

  it('should merge files into user message via pipeline', async () => {
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

    // Create mock file
    const mockFile: ProcessedFile = {
      input: {
        source: Buffer.from('test image'),
        mimeType: 'image/png',
        filename: 'test.png'
      },
      base64Content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      metadata: {
        size: 100,
        mimeType: 'image/png',
        filename: 'test.png',
        extractedAt: new Date(),
        processingTime: 10
      }
    }

    // Context message + file attachment via streamGenerate
    const contextMessages = [
      { role: 'system' as const, content: 'System prompt' }
    ]

    await agentWrapper.streamGenerate('Analyze this image', {
      context: contextMessages,
      files: [mockFile]
    })

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    expect(prepared.messages).toBeDefined()
    expect(prepared.messages.length).toBe(2) // 1 context + 1 user with file

    // User message should have hybrid content (text + image)
    const userMessage = prepared.messages[1]
    expect(userMessage.role).toBe('user')
    expect(Array.isArray(userMessage.content)).toBe(true)

    const contentBlocks = userMessage.content as any[]
    // Should have text block + image block
    expect(contentBlocks.length).toBeGreaterThan(1)
    const imageBlock = contentBlocks.find((block: any) => block.type === 'image')
    expect(imageBlock).toBeDefined()
    expect(imageBlock.image).toContain('data:image/png;base64,')
  })
})

describe('AgentWrapper - advanceCacheBreakpoint via prepareStep', () => {
  let mockAgent: { generate: ReturnType<typeof vi.fn>; stream: ReturnType<typeof vi.fn> }
  let lastSettings: any
  let MockToolLoopAgent: any

  beforeEach(async () => {
    mockAgent = { generate: vi.fn(), stream: vi.fn() }

    const aiModule = await import('ai')
    MockToolLoopAgent = aiModule.ToolLoopAgent as any
    MockToolLoopAgent.mockImplementation((settings: any) => {
      lastSettings = settings
      return mockAgent
    })

    const mockModel = {
      provider: 'anthropic',
      modelId: 'claude-3-5-sonnet-20241022',
      doGenerate: vi.fn(),
      doStream: vi.fn()
    }

    const config: AgentConfig = {
      name: 'test-agent',
      model: mockModel as any,
      system: 'Test system prompt',
      enablePromptCaching: true,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }

    new AgentWrapper(config)
  })

  it('should not advance breakpoint on step 0', async () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' }
    ]

    const result = await lastSettings.prepareStep({ stepNumber: 0, steps: [], model: 'test', messages })
    // Step 0 breakpoints are set by prepareCall, not prepareStep
    expect(result?.messages).toBeUndefined()
  })

  it('should place breakpoint on last message at step 1+', async () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'Do something' }
    ]

    const result = await lastSettings.prepareStep({ stepNumber: 1, steps: [], model: 'test', messages })
    expect(result.messages).toBeDefined()

    const lastMsg = result.messages[result.messages.length - 1] as any
    expect(lastMsg.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })
    expect(lastMsg.providerOptions?.bedrock?.cachePoint).toBe('ephemeral')
  })

  it('should preserve user message breakpoints (e.g. conversation summary)', async () => {
    const messages = [
      {
        role: 'user',
        content: '[CONVERSATION SUMMARY]',
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
          bedrock: { cachePoint: 'ephemeral' }
        }
      },
      { role: 'assistant', content: 'Response' },
      { role: 'user', content: 'Next question' }
    ]

    const result = await lastSettings.prepareStep({ stepNumber: 1, steps: [], model: 'test', messages })

    // Summary breakpoint preserved (user message, not removed)
    const summaryMsg = result.messages[0] as any
    expect(summaryMsg.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })

    // Last message gets new breakpoint
    const lastMsg = result.messages[result.messages.length - 1] as any
    expect(lastMsg.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })
  })

  it('should remove old advancing breakpoint from assistant messages', async () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: 'Previous response',
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
          bedrock: { cachePoint: 'ephemeral' }
        }
      },
      { role: 'user', content: 'New message' },
      { role: 'assistant', content: 'New response' }
    ]

    const result = await lastSettings.prepareStep({ stepNumber: 2, steps: [], model: 'test', messages })

    // Old assistant breakpoint removed
    const oldAssistant = result.messages[1] as any
    expect(oldAssistant.providerOptions?.anthropic?.cacheControl).toBeUndefined()

    // New last message gets breakpoint
    const lastMsg = result.messages[result.messages.length - 1] as any
    expect(lastMsg.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })
  })

  it('should skip if last message already has a breakpoint', async () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      {
        role: 'user',
        content: 'Already cached',
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } }
        }
      }
    ]

    const result = await lastSettings.prepareStep({ stepNumber: 1, steps: [], model: 'test', messages })
    // advanceCacheBreakpoint returns null when last message already has breakpoint
    expect(result?.messages).toBeUndefined()
  })
})
