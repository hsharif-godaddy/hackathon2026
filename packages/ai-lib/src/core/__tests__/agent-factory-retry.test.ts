import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AgentWrapper } from '../agent-factory.js'
import type { AgentConfig } from '../types.js'
import {
  createMockConversationMessages,
  createMockContextMessages,
  createMockFiles
} from '../../utils/__tests__/test-helpers.js'

const getMessageContent = (message: { content?: unknown }): string | undefined => {
  if (!message.content) {
    return undefined
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part: any) => {
        if (part?.type === 'text') {
          return part.text
        }
        return ''
      })
      .join('')
  }
  return message.content as string
}

vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof import('ai')>()
  const MockToolLoopAgent = vi.fn()
  return {
    ...actual,
    ToolLoopAgent: MockToolLoopAgent,
    stepCountIs: vi.fn((value: number) => ({ type: 'step_count', value })),
    hasToolCall: vi.fn((name: string) => ({ type: 'has_tool_call', value: name }))
  }
})

describe('AgentWrapper integration with ToolLoopAgent settings', () => {
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
    MockToolLoopAgent.mockImplementation((settings: unknown) => {
      lastSettings = settings
      return mockAgent
    })

    const config: AgentConfig = {
      name: 'test-agent',
      model: 'test-model' as any,
      system: 'You are a helpful assistant',
      tools: {},
      maxSteps: 5,
      retryConfig: {
        maxAttempts: 4
      }
    }

    agentWrapper = new AgentWrapper(config)
  })

  afterEach(() => {
    vi.clearAllMocks()
    lastSettings = undefined
  })

  it('includes full conversation history in the prepared call', async () => {
    const messages = createMockConversationMessages()
    const mockResponse = {
      text: 'Here is your joke',
      usage: Promise.resolve({ totalTokens: 100, promptTokens: 50, completionTokens: 50 }),
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([])
    }

    mockAgent.generate.mockResolvedValueOnce(mockResponse)

    const result = await agentWrapper.generate('Tell me a joke', { messages })
    expect(result.content).toBe('Here is your joke')

    expect(mockAgent.generate).toHaveBeenCalledTimes(1)
    const callArgs = mockAgent.generate.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    expect(prepared.messages).toHaveLength(messages.length + 1)
    messages.forEach((message, index) => {
      expect(prepared.messages[index].role).toEqual(message.role)
      expect(getMessageContent(prepared.messages[index])).toEqual(message.content)
    })
    expect(getMessageContent(prepared.messages[messages.length])).toBe('Tell me a joke')
  })

  it('interleaves context messages before conversation history', async () => {
    const contextMessages = createMockContextMessages()
    const conversationMessages = createMockConversationMessages()

    mockAgent.stream.mockResolvedValueOnce({
      textStream: (async function* () {
        yield 'chunk'
      })(),
      baseStream: null,
      usage: Promise.resolve({ totalTokens: 20, promptTokens: 10, completionTokens: 10 }),
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([])
    })

    const streamResult = await agentWrapper.streamGenerate('What now?', {
      context: contextMessages,
      messages: conversationMessages
    })

    const chunks: string[] = []
    for await (const chunk of streamResult.textStream) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['chunk'])

    const callArgs = mockAgent.stream.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)
    const expectedLength = contextMessages.length + conversationMessages.length + 1
    expect(prepared.messages).toHaveLength(expectedLength)

    contextMessages.forEach((msg, index) => {
      const expectedProviderOptions = msg.cachePoint
        ? {
            bedrock: {
              cachePoint: msg.cachePoint.type
            }
          }
        : undefined
      expect(prepared.messages[index]).toMatchObject({
        role: msg.role,
        content: msg.content,
        ...(expectedProviderOptions ? { providerOptions: expectedProviderOptions } : {})
      })
    })

    conversationMessages.forEach((msg, index) => {
      const messageIndex = contextMessages.length + index
      expect(prepared.messages[messageIndex].role).toEqual(msg.role)
      expect(getMessageContent(prepared.messages[messageIndex])).toEqual(msg.content)
    })
  })

  it('includes execution context and files for vision prompts', async () => {
    const files = createMockFiles()

    mockAgent.generate.mockResolvedValueOnce({
      text: 'Vision response',
      usage: Promise.resolve({ totalTokens: 60, promptTokens: 30, completionTokens: 30 }),
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([])
    })

    await agentWrapper.generate('Describe this image', {
      files: files as any,
      executionContext: { appId: 'app-1' }
    })

    const callArgs = mockAgent.generate.mock.calls[0][0]
    const prepared = await lastSettings.prepareCall(callArgs)

    expect(prepared.messages).toHaveLength(1)
    expect(prepared.experimental_context).toEqual({ appId: 'app-1' })
    expect(prepared.messages[0].role).toBe('user')
  })

  it('derives maxRetries from retryConfig.maxAttempts', () => {
    expect(lastSettings.maxRetries).toBe(3) // 4 attempts => 3 retries
  })

  it('invokes structured logger hooks for steps and completion', async () => {
    const info = vi.fn()
    const error = vi.fn()
    const warn = vi.fn()

    const configWithLogger: AgentConfig = {
      name: 'logger-agent',
      model: 'test-model' as any,
      tools: {},
      logger: { info, error, warn }
    }

    new AgentWrapper(configWithLogger)
    const loggerSettings = MockToolLoopAgent.mock.calls[1][0]

    const mockStepResult = {
      finishReason: 'stop',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
    }

    await loggerSettings.prepareStep?.({
      stepNumber: 1,
      steps: [],
      model: 'test-model' as any,
      messages: []
    })
    expect(info).toHaveBeenCalledWith('agent.step.begin', expect.objectContaining({
      agentName: 'logger-agent',
      stepNumber: 1,
      messageCount: 0
    }))

    await loggerSettings.onStepFinish?.(mockStepResult)
    expect(info).toHaveBeenCalledWith('agent.step.finish', expect.objectContaining({
      agentName: 'logger-agent',
      finishReason: 'stop',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      toolCallCount: 0
    }))

    const mockFinishEvent = {
      finishReason: 'stop',
      steps: [mockStepResult],
      totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
    }
    await loggerSettings.onFinish?.(mockFinishEvent)
    expect(info).toHaveBeenCalledWith('agent.run.finish', expect.objectContaining({
      agentName: 'logger-agent',
      finishReason: 'stop',
      steps: 1,
      totalUsage: mockFinishEvent.totalUsage
    }))
  })
})
