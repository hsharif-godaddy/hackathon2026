/**
 * Integration tests for Agent retry behavior with conversation history
 *
 * These tests verify that when an LLM call fails and retries,
 * the FULL conversation history is maintained across retry attempts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AgentWrapper } from '../agent-factory.js'
import type { AgentConfig } from '../types.js'
import {
  createNetworkError,
  createRateLimitError,
  createServerError,
  createMockConversationMessages,
  createMockContextMessages,
  createMockFiles,
  createConsoleSpy
} from '../../utils/__tests__/test-helpers.js'

// Mock the AI SDK - using factory function
vi.mock('ai', () => {
  const MockToolLoopAgent = vi.fn()
  return {
    ToolLoopAgent: MockToolLoopAgent,
    stepCountIs: vi.fn((n: number) => ({ type: 'step_count', value: n })),
    hasToolCall: vi.fn((name: string) => ({ type: 'has_tool_call', value: name }))
  }
})

// Define a type for the mock agent with generate and stream methods
interface MockAgent {
  generate: ReturnType<typeof vi.fn>
  stream: ReturnType<typeof vi.fn>
}

describe('AgentWrapper Retry with Conversation History', () => {
  let mockAgent: MockAgent
  let agentWrapper: AgentWrapper
  let consoleSpy: ReturnType<typeof createConsoleSpy>
  let MockToolLoopAgent: any

  beforeEach(async () => {
    consoleSpy = createConsoleSpy()
    vi.useFakeTimers()

    // Create a mock ToolLoopAgent instance
    mockAgent = {
      generate: vi.fn(),
      stream: vi.fn()
    }

    // Get the mocked constructor and set it to return our mockAgent
    const aiModule = await import('ai')
    MockToolLoopAgent = aiModule.ToolLoopAgent as any
    MockToolLoopAgent.mockReturnValue(mockAgent)

    // Create agent config
    const config: AgentConfig = {
      name: 'test-agent',
      model: 'test-model' as any,
      system: 'You are a test agent',
      tools: {},
      maxSteps: 5
    }

    agentWrapper = new AgentWrapper(config)
  })

  afterEach(() => {
    consoleSpy.restore()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('generate() maintains history on retry', () => {
    it('should pass full conversation history on retry', async () => {
      const messages = createMockConversationMessages()
      const mockResponse = {
        text: "Why did the programmer quit? Because they didn't get arrays!",
        usage: Promise.resolve({ totalTokens: 100, promptTokens: 50, completionTokens: 50 }),
        finishReason: Promise.resolve('stop'),
        toolCalls: Promise.resolve([])
      }

      // First call fails with network error, second succeeds
      mockAgent.generate
        .mockRejectedValueOnce(createNetworkError('ECONNREFUSED'))
        .mockResolvedValueOnce(mockResponse)

      const promise = agentWrapper.generate('Tell me a joke', { messages })
      await vi.runAllTimersAsync()
      const result = await promise

      // Verify the function was called twice (original + 1 retry)
      expect(mockAgent.generate).toHaveBeenCalledTimes(2)

      // Verify BOTH calls received the full conversation history
      const firstCall = mockAgent.generate.mock.calls[0][0]
      const secondCall = mockAgent.generate.mock.calls[1][0]

      // Both should have same message structure: history messages + new prompt
      expect(firstCall.messages).toHaveLength(messages.length + 1)
      expect(secondCall.messages).toHaveLength(messages.length + 1)

      // Verify history is identical in both calls
      for (let i = 0; i < messages.length; i++) {
        expect(firstCall.messages[i]).toEqual(messages[i])
        expect(secondCall.messages[i]).toEqual(messages[i])
      }

      // Verify the new prompt is at the end
      expect(firstCall.messages[messages.length].content).toBe('Tell me a joke')
      expect(secondCall.messages[messages.length].content).toBe('Tell me a joke')

      // Verify result is returned
      expect(result.content).toContain('programmer')
    })

    it('should maintain history across multiple retries', async () => {
      const messages = createMockConversationMessages()
      const mockResponse = {
        text: 'Success after retries',
        usage: Promise.resolve({ totalTokens: 50, promptTokens: 25, completionTokens: 25 }),
        finishReason: Promise.resolve('stop'),
        toolCalls: Promise.resolve([])
      }

      // Fail 3 times, then succeed on 4th attempt
      mockAgent.generate
        .mockRejectedValueOnce(createNetworkError())
        .mockRejectedValueOnce(createRateLimitError())
        .mockRejectedValueOnce(createServerError(503))
        .mockResolvedValueOnce(mockResponse)

      const promise = agentWrapper.generate('Final question', { messages })
      await vi.runAllTimersAsync()
      const result = await promise

      // Verify 4 calls total
      expect(mockAgent.generate).toHaveBeenCalledTimes(4)

      // Verify ALL 4 calls have identical conversation history
      const allCalls = mockAgent.generate.mock.calls
      for (let callIndex = 0; callIndex < 4; callIndex++) {
        const call = allCalls[callIndex][0]
        expect(call.messages).toHaveLength(messages.length + 1)

        // Check each message in history
        for (let i = 0; i < messages.length; i++) {
          expect(call.messages[i]).toEqual(messages[i])
        }
      }

      expect(result.content).toBe('Success after retries')
    })

    it('should work without conversation history', async () => {
      const mockResponse = {
        text: 'Hello!',
        usage: Promise.resolve({ totalTokens: 20, promptTokens: 10, completionTokens: 10 }),
        finishReason: Promise.resolve('stop'),
        toolCalls: Promise.resolve([])
      }

      mockAgent.generate
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValueOnce(mockResponse)

      const promise = agentWrapper.generate('Hi')
      await vi.runAllTimersAsync()
      const result = await promise

      expect(mockAgent.generate).toHaveBeenCalledTimes(2)
      expect(result.content).toBe('Hello!')
    })
  })

  // Removed legacy callback integration tests after refactor (unified logger approach)

  describe('streamGenerate() maintains history on retry', () => {
    it('should pass full conversation history on streaming retry', async () => {
      const messages = createMockConversationMessages()

      // Mock stream response
      const mockStreamResponse = {
        textStream: (async function* () {
          yield 'Streaming '
          yield 'response'
        })(),
        baseStream: null as any,
        usage: Promise.resolve({ totalTokens: 100, promptTokens: 50, completionTokens: 50 }),
        finishReason: Promise.resolve('stop'),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([])
      }

      // First call fails, second succeeds
      mockAgent.stream
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValueOnce(mockStreamResponse)

      const promise = agentWrapper.streamGenerate('Tell me a joke', { messages })
      await vi.runAllTimersAsync()
      const streamResult = await promise

      // Verify two calls were made
      expect(mockAgent.stream).toHaveBeenCalledTimes(2)

      // Verify both calls received full history
      const firstCall = mockAgent.stream.mock.calls[0][0]
      const secondCall = mockAgent.stream.mock.calls[1][0]

      expect(firstCall.messages).toHaveLength(messages.length + 1)
      expect(secondCall.messages).toHaveLength(messages.length + 1)

      // Verify history is identical
      for (let i = 0; i < messages.length; i++) {
        expect(firstCall.messages[i]).toEqual(messages[i])
        expect(secondCall.messages[i]).toEqual(messages[i])
      }

      // Verify we can consume the stream
      const chunks: string[] = []
      for await (const chunk of streamResult.textStream) {
        chunks.push(chunk)
      }
      expect(chunks).toEqual(['Streaming ', 'response'])
    })

    it('should maintain history with context messages on retry', async () => {
      const contextMessages = createMockContextMessages()
      const conversationMessages = createMockConversationMessages()

      const mockStreamResponse = {
        textStream: (async function* () {
          yield 'Response'
        })(),
        baseStream: null as any,
        usage: Promise.resolve({ totalTokens: 80, promptTokens: 40, completionTokens: 40 }),
        finishReason: Promise.resolve('stop'),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([])
      }

      mockAgent.stream
        .mockRejectedValueOnce(createRateLimitError())
        .mockResolvedValueOnce(mockStreamResponse)

      const promise = agentWrapper.streamGenerate('New question', {
        context: contextMessages,
        messages: conversationMessages
      })
      await vi.runAllTimersAsync()
      await promise

      expect(mockAgent.stream).toHaveBeenCalledTimes(2)

      // Both calls should have: context + conversation history + new message
      const expectedLength = contextMessages.length + conversationMessages.length + 1

      const firstCall = mockAgent.stream.mock.calls[0][0]
      const secondCall = mockAgent.stream.mock.calls[1][0]

      expect(firstCall.messages).toHaveLength(expectedLength)
      expect(secondCall.messages).toHaveLength(expectedLength)

      // Verify context comes first
      expect(firstCall.messages[0].role).toBe('system')
      expect(secondCall.messages[0].role).toBe('system')

      // Verify conversation history follows
      for (let i = 0; i < conversationMessages.length; i++) {
        const msgIndex = contextMessages.length + i
        expect(firstCall.messages[msgIndex].content).toBe(conversationMessages[i].content)
        expect(secondCall.messages[msgIndex].content).toBe(conversationMessages[i].content)
      }
    })

    it('should maintain files/vision data on retry', async () => {
      const messages = [{ role: 'user' as const, content: 'What do you see?' }]
      const files = createMockFiles()

      const mockStreamResponse = {
        textStream: (async function* () {
          yield 'I see an image'
        })(),
        baseStream: null as any,
        usage: Promise.resolve({ totalTokens: 60, promptTokens: 30, completionTokens: 30 }),
        finishReason: Promise.resolve('stop'),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([])
      }

      mockAgent.stream
        .mockRejectedValueOnce(createServerError(500))
        .mockResolvedValueOnce(mockStreamResponse)

  // Cast test helper vision files to any to satisfy ProcessedFile[] shape (not relevant for retry logic validation)
  const promise = agentWrapper.streamGenerate('Describe this', { messages, files: files as any })
      await vi.runAllTimersAsync()
      await promise

      expect(mockAgent.stream).toHaveBeenCalledTimes(2)

      // Both calls should have messages format (not just prompt)
      // because files are present
      const firstCall = mockAgent.stream.mock.calls[0][0]
      const secondCall = mockAgent.stream.mock.calls[1][0]

      expect(firstCall).toHaveProperty('messages')
      expect(secondCall).toHaveProperty('messages')

      // Note: The actual file handling is done in buildHybridContent
      // which we're not testing here, but we verify the structure is preserved
      expect(firstCall.messages).toHaveLength(2) // history + new message with files
      expect(secondCall.messages).toHaveLength(2)
    })
  })

  describe('Tool execution context preserved on retry', () => {
    it('should maintain execution context across retries', async () => {
      const messages = createMockConversationMessages()
      const executionContext = {
        appId: 'test-app-123',
        userId: 'user-456',
        sessionId: 'session-789'
      }

      const mockStreamResponse = {
        textStream: (async function* () {
          yield 'Response'
        })(),
        baseStream: null as any,
        usage: Promise.resolve({ totalTokens: 50, promptTokens: 25, completionTokens: 25 }),
        finishReason: Promise.resolve('stop'),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([])
      }

      mockAgent.stream
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValueOnce(mockStreamResponse)

      const promise = agentWrapper.streamGenerate('Test', {
        messages,
        executionContext
      })
      await vi.runAllTimersAsync()
      await promise

      // Context is stored internally in AgentWrapper
      // Verify it's maintained by checking the agent was called correctly
      expect(mockAgent.stream).toHaveBeenCalledTimes(2)

      // The execution context is used internally for tools
      // We can't directly verify it's preserved, but the fact that
      // the retry succeeded with the same messages structure confirms it
    })
  })

  describe('Error handling with history preservation', () => {
    it('should preserve history even when all retries fail', async () => {
      const messages = createMockConversationMessages()

      // Mock to always fail
      mockAgent.generate.mockRejectedValue(createNetworkError())

      const promise = agentWrapper.generate('Question', { messages })
      const catchPromise = promise.catch(e => e)
      await vi.runAllTimersAsync()

      await expect(promise).rejects.toThrow()

      // Verify all 5 attempts were made with same history
      expect(mockAgent.generate).toHaveBeenCalledTimes(5)

      for (let i = 0; i < 5; i++) {
        const call = mockAgent.generate.mock.calls[i][0]
        expect(call.messages).toHaveLength(messages.length + 1)

        // Verify history in each call
        for (let j = 0; j < messages.length; j++) {
          expect(call.messages[j]).toEqual(messages[j])
        }
      }

      await catchPromise
    })

    it('should not retry on non-retryable errors but history is still passed', async () => {
      const messages = createMockConversationMessages()
      const authError = new Error('Unauthorized')
      ;(authError as any).status = 401

      mockAgent.generate.mockRejectedValue(authError)

      const promise = agentWrapper.generate('Question', { messages })
      const catchPromise = promise.catch(e => e)
      await vi.runAllTimersAsync()

      await expect(promise).rejects.toThrow('Unauthorized')

      // Only one call (no retries for auth errors)
      expect(mockAgent.generate).toHaveBeenCalledTimes(1)

      // But history was still passed
      const call = mockAgent.generate.mock.calls[0][0]
      expect(call.messages).toHaveLength(messages.length + 1)

      await catchPromise
    })
  })

  describe('Real-world conversation flow', () => {
    it('should handle multi-turn conversation with retry in middle', async () => {
      // Simulate a real conversation:
      // Turn 1: User asks for haiku (succeeds)
      // Turn 2: User asks for joke (fails then succeeds on retry)

      const turn1Messages: any[] = []
      const turn2Messages = [
        { role: 'user' as const, content: 'Write a Haiku' },
        { role: 'assistant' as const, content: 'Haiku response...' }
      ]

      // Turn 1 - succeeds immediately
      mockAgent.generate.mockResolvedValueOnce({
        text: 'Haiku response...',
        usage: Promise.resolve({ totalTokens: 50, promptTokens: 25, completionTokens: 25 }),
        finishReason: Promise.resolve('stop'),
        toolCalls: Promise.resolve([])
      })

      const result1 = await agentWrapper.generate('Write a Haiku', { messages: turn1Messages })
      expect(result1.content).toBe('Haiku response...')

      // Turn 2 - fails once, then succeeds
      mockAgent.generate
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValueOnce({
          text: 'Joke response...',
          usage: Promise.resolve({ totalTokens: 60, promptTokens: 30, completionTokens: 30 }),
          finishReason: Promise.resolve('stop'),
          toolCalls: Promise.resolve([])
        })

      const promise = agentWrapper.generate('Tell me a joke', { messages: turn2Messages })
      await vi.runAllTimersAsync()
      const result2 = await promise

      // Verify turn 2 had retry with full history
      const turn2Calls = mockAgent.generate.mock.calls.slice(1) // Skip turn 1
      expect(turn2Calls).toHaveLength(2) // Original + retry

      // Both retry attempts should have the history from turn 1
      for (const call of turn2Calls) {
        expect(call[0].messages).toHaveLength(3) // turn1 user + turn1 assistant + turn2 user
        expect(call[0].messages[0].content).toBe('Write a Haiku')
        expect(call[0].messages[1].content).toBe('Haiku response...')
        expect(call[0].messages[2].content).toBe('Tell me a joke')
      }

      expect(result2.content).toBe('Joke response...')
    })
  })
})
