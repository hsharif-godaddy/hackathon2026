import { describe, expect, it } from 'vitest'

import type { ChatMessage, StreamingMessage, ToolCall } from '@/stores/useStreamingConversationStore'
import {
  calculateTotalTokens,
  calculateTotalToolTime,
  countMessagesByRole,
  extractTextContent,
  extractToolCalls,
  filterMessagesByRole,
  getCompletedTools,
  getErrorDetails,
  getErrorMessages,
  getErrorSummary,
  getFailedTools,
  getIncompleteTools,
  getLastAssistantMessage,
  getLastUserMessage,
  getRunningTools,
  getToolUsageSummary,
  hasFailedTools,
  hasToolCalls,
  isAssistantMessage,
  isErrorMessage,
  isStreaming,
  isUserMessage,
} from './index'

const createMessage = (overrides?: Partial<ChatMessage>): ChatMessage => ({
  id: 'msg-1',
  role: 'assistant',
  content: 'Test message',
  timestamp: new Date(),
  ...overrides
})

const createStreamingMessage = (overrides?: Partial<StreamingMessage>): StreamingMessage => ({
  id: 'msg-1',
  role: 'assistant',
  content: 'Test message',
  segments: [],
  toolCalls: [],
  timestamp: new Date(),
  isComplete: false,
  ...overrides
})

const createToolCall = (overrides?: Partial<ToolCall>): ToolCall => ({
  id: 'tool-1',
  name: 'test_tool',
  input: {},
  status: 'completed',
  ...overrides
})

describe('Message Utilities', () => {
  describe('isErrorMessage', () => {
    it('returns false for messages without errors', () => {
      const msg = createMessage()
      expect(isErrorMessage(msg)).toBe(false)
    })

    it('returns true for messages with error field', () => {
      const msg = createMessage({ error: 'Something went wrong' })
      expect(isErrorMessage(msg)).toBe(true)
    })

    it('returns true for messages with upstreamError', () => {
      const msg = createMessage({ upstreamError: true })
      expect(isErrorMessage(msg)).toBe(true)
    })

    it('returns true for messages with budgetExceeded', () => {
      const msg = createMessage({ budgetExceeded: true })
      expect(isErrorMessage(msg)).toBe(true)
    })

    it('returns true for messages with maxStepsReached', () => {
      const msg = createMessage({ maxStepsReached: true })
      expect(isErrorMessage(msg)).toBe(true)
    })

    it('returns true for messages with connectionLost', () => {
      const msg = createMessage({ connectionLost: true })
      expect(isErrorMessage(msg)).toBe(true)
    })

    it('returns true for messages with userStopped', () => {
      const msg = createMessage({ userStopped: true })
      expect(isErrorMessage(msg)).toBe(true)
    })
  })

  describe('getErrorSummary', () => {
    it('returns null for messages without errors', () => {
      const msg = createMessage()
      expect(getErrorSummary(msg)).toBeNull()
    })

    it('returns budget exceeded message', () => {
      const msg = createMessage({ budgetExceeded: true })
      expect(getErrorSummary(msg)).toBe('Usage budget exceeded')
    })

    it('returns max steps message', () => {
      const msg = createMessage({ maxStepsReached: true })
      expect(getErrorSummary(msg)).toBe('Maximum steps reached')
    })

    it('returns connection lost message', () => {
      const msg = createMessage({ connectionLost: true })
      expect(getErrorSummary(msg)).toBe('Connection lost')
    })

    it('returns user stopped message', () => {
      const msg = createMessage({ userStopped: true })
      expect(getErrorSummary(msg)).toBe('Generation stopped by user')
    })

    it('returns custom error message', () => {
      const msg = createMessage({ error: 'Custom error' })
      expect(getErrorSummary(msg)).toBe('Custom error')
    })

    it('prioritizes budget exceeded over other errors', () => {
      const msg = createMessage({ budgetExceeded: true, error: 'Other error' })
      expect(getErrorSummary(msg)).toBe('Usage budget exceeded')
    })
  })

  describe('Tool Call Utilities', () => {
    it('extractToolCalls returns empty array for messages without tools', () => {
      const msg = createMessage()
      expect(extractToolCalls(msg)).toEqual([])
    })

    it('extractToolCalls returns tool calls array', () => {
      const tools = [createToolCall(), createToolCall({ id: 'tool-2' })]
      const msg = createMessage({ toolCalls: tools })
      expect(extractToolCalls(msg)).toEqual(tools)
    })

    it('getCompletedTools filters only completed tools', () => {
      const tools = [
        createToolCall({ id: 'tool-1', status: 'completed' }),
        createToolCall({ id: 'tool-2', status: 'running' }),
        createToolCall({ id: 'tool-3', status: 'completed' })
      ]
      const msg = createMessage({ toolCalls: tools })
      const completed = getCompletedTools(msg)
      expect(completed).toHaveLength(2)
      expect(completed.every(t => t.status === 'completed')).toBe(true)
    })

    it('getFailedTools filters only failed tools', () => {
      const tools = [
        createToolCall({ id: 'tool-1', status: 'completed' }),
        createToolCall({ id: 'tool-2', status: 'error' }),
        createToolCall({ id: 'tool-3', status: 'error' })
      ]
      const msg = createMessage({ toolCalls: tools })
      const failed = getFailedTools(msg)
      expect(failed).toHaveLength(2)
      expect(failed.every(t => t.status === 'error')).toBe(true)
    })

    it('getRunningTools filters only running tools', () => {
      const tools = [
        createToolCall({ id: 'tool-1', status: 'completed' }),
        createToolCall({ id: 'tool-2', status: 'running' })
      ]
      const msg = createMessage({ toolCalls: tools })
      const running = getRunningTools(msg)
      expect(running).toHaveLength(1)
      expect(running[0].status).toBe('running')
    })

    it('getIncompleteTools filters only incomplete tools', () => {
      const tools = [
        createToolCall({ id: 'tool-1', status: 'completed' }),
        createToolCall({ id: 'tool-2', status: 'incomplete' })
      ]
      const msg = createMessage({ toolCalls: tools })
      const incomplete = getIncompleteTools(msg)
      expect(incomplete).toHaveLength(1)
      expect(incomplete[0].status).toBe('incomplete')
    })

    it('hasToolCalls returns true when tools exist', () => {
      const msg = createMessage({ toolCalls: [createToolCall()] })
      expect(hasToolCalls(msg)).toBe(true)
    })

    it('hasToolCalls returns false when no tools exist', () => {
      const msg = createMessage()
      expect(hasToolCalls(msg)).toBe(false)
    })

    it('hasFailedTools returns true when failed tools exist', () => {
      const msg = createMessage({
        toolCalls: [createToolCall({ status: 'error' })]
      })
      expect(hasFailedTools(msg)).toBe(true)
    })

    it('hasFailedTools returns false when no failed tools exist', () => {
      const msg = createMessage({
        toolCalls: [createToolCall({ status: 'completed' })]
      })
      expect(hasFailedTools(msg)).toBe(false)
    })
  })

  describe('extractTextContent', () => {
    it('returns message content', () => {
      const msg = createMessage({ content: 'Hello world' })
      expect(extractTextContent(msg)).toBe('Hello world')
    })
  })

  describe('calculateTotalTokens', () => {
    it('returns zero for empty message array', () => {
      expect(calculateTotalTokens([])).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      })
    })

    it('sums token usage across messages', () => {
      const messages = [
        createMessage({
          metadata: { usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } }
        }),
        createMessage({
          metadata: { usage: { inputTokens: 5, outputTokens: 15, totalTokens: 20 } }
        })
      ]
      expect(calculateTotalTokens(messages)).toEqual({
        inputTokens: 15,
        outputTokens: 35,
        totalTokens: 50
      })
    })

    it('handles messages without usage metadata', () => {
      const messages = [
        createMessage({ metadata: { usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } } }),
        createMessage() // No metadata
      ]
      expect(calculateTotalTokens(messages)).toEqual({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30
      })
    })
  })

  describe('Role Filtering', () => {
    const userMsg = createMessage({ id: 'user-1', role: 'user' })
    const assistantMsg = createMessage({ id: 'asst-1', role: 'assistant' })

    it('filterMessagesByRole filters user messages', () => {
      const messages = [userMsg, assistantMsg, userMsg]
      const filtered = filterMessagesByRole(messages, 'user')
      expect(filtered).toHaveLength(2)
      expect(filtered.every(m => m.role === 'user')).toBe(true)
    })

    it('filterMessagesByRole filters assistant messages', () => {
      const messages = [userMsg, assistantMsg, assistantMsg]
      const filtered = filterMessagesByRole(messages, 'assistant')
      expect(filtered).toHaveLength(2)
      expect(filtered.every(m => m.role === 'assistant')).toBe(true)
    })

    it('getLastUserMessage returns last user message', () => {
      const messages = [
        createMessage({ id: 'user-1', role: 'user' }),
        createMessage({ id: 'asst-1', role: 'assistant' }),
        createMessage({ id: 'user-2', role: 'user' })
      ]
      const last = getLastUserMessage(messages)
      expect(last?.id).toBe('user-2')
    })

    it('getLastUserMessage returns null when no user messages', () => {
      const messages = [createMessage({ role: 'assistant' })]
      expect(getLastUserMessage(messages)).toBeNull()
    })

    it('getLastAssistantMessage returns last assistant message', () => {
      const messages = [
        createMessage({ id: 'asst-1', role: 'assistant' }),
        createMessage({ id: 'user-1', role: 'user' }),
        createMessage({ id: 'asst-2', role: 'assistant' })
      ]
      const last = getLastAssistantMessage(messages)
      expect(last?.id).toBe('asst-2')
    })
  })

  describe('Message Type Checks', () => {
    it('isStreaming returns true for incomplete streaming messages', () => {
      const msg = createStreamingMessage({ isComplete: false })
      expect(isStreaming(msg)).toBe(true)
    })

    it('isStreaming returns false for complete streaming messages', () => {
      const msg = createStreamingMessage({ isComplete: true })
      expect(isStreaming(msg)).toBe(false)
    })

    it('isStreaming returns false for regular chat messages', () => {
      const msg = createMessage()
      expect(isStreaming(msg)).toBe(false)
    })

    it('isUserMessage returns true for user messages', () => {
      const msg = createMessage({ role: 'user' })
      expect(isUserMessage(msg)).toBe(true)
    })

    it('isAssistantMessage returns true for assistant messages', () => {
      const msg = createMessage({ role: 'assistant' })
      expect(isAssistantMessage(msg)).toBe(true)
    })
  })

  describe('getErrorDetails', () => {
    it('returns null details for non-error messages', () => {
      const msg = createMessage()
      expect(getErrorDetails(msg)).toEqual({
        type: null,
        code: null,
        message: null,
        retryable: false
      })
    })

    it('returns error details with type and code', () => {
      const msg = createMessage({
        error: 'Test error',
        errorType: 'NETWORK_ERROR',
        errorCode: 500
      })
      const details = getErrorDetails(msg)
      expect(details.type).toBe('NETWORK_ERROR')
      expect(details.code).toBe(500)
      expect(details.message).toBe('Test error')
      expect(details.retryable).toBe(false)
    })

    it('marks retry errors as retryable', () => {
      const msg = createMessage({
        error: 'Retry failed',
        errorType: 'RETRY_ERROR',
        retryAttempts: 3
      })
      const details = getErrorDetails(msg)
      expect(details.retryable).toBe(true)
    })

    it('marks retry errors as retryable even without retry attempts', () => {
      const msg = createMessage({
        error: 'Fresh retry error',
        errorType: 'RETRY_ERROR'
        // No retryAttempts field
      })
      const details = getErrorDetails(msg)
      expect(details.retryable).toBe(true)
    })
  })

  describe('countMessagesByRole', () => {
    it('counts messages by role', () => {
      const messages = [
        createMessage({ id: '1', role: 'user' }),
        createMessage({ id: '2', role: 'assistant' }),
        createMessage({ id: '3', role: 'user' }),
        createMessage({ id: '4', role: 'assistant' }),
        createMessage({ id: '5', role: 'assistant' })
      ]
      expect(countMessagesByRole(messages)).toEqual({
        user: 2,
        assistant: 3,
        total: 5
      })
    })

    it('returns zeros for empty array', () => {
      expect(countMessagesByRole([])).toEqual({
        user: 0,
        assistant: 0,
        total: 0
      })
    })
  })

  describe('getErrorMessages', () => {
    it('filters only error messages', () => {
      const messages = [
        createMessage({ id: '1' }),
        createMessage({ id: '2', error: 'Error 1' }),
        createMessage({ id: '3' }),
        createMessage({ id: '4', budgetExceeded: true })
      ]
      const errors = getErrorMessages(messages)
      expect(errors).toHaveLength(2)
      expect(errors.map(m => m.id)).toEqual(['2', '4'])
    })
  })

  describe('calculateTotalToolTime', () => {
    it('sums tool duration across messages', () => {
      const messages = [
        createMessage({
          toolCalls: [
            createToolCall({ duration: 100 }),
            createToolCall({ duration: 200 })
          ]
        }),
        createMessage({
          toolCalls: [createToolCall({ duration: 150 })]
        })
      ]
      expect(calculateTotalToolTime(messages)).toBe(450)
    })

    it('handles messages without durations', () => {
      const messages = [
        createMessage({
          toolCalls: [
            createToolCall({ duration: 100 }),
            createToolCall() // No duration
          ]
        })
      ]
      expect(calculateTotalToolTime(messages)).toBe(100)
    })

    it('returns zero for messages without tools', () => {
      const messages = [createMessage(), createMessage()]
      expect(calculateTotalToolTime(messages)).toBe(0)
    })
  })

  describe('getToolUsageSummary', () => {
    it('summarizes tool usage across messages', () => {
      const messages = [
        createMessage({
          toolCalls: [
            createToolCall({ id: '1', name: 'tool_a', status: 'completed' }),
            createToolCall({ id: '2', name: 'tool_b', status: 'error' })
          ]
        }),
        createMessage({
          toolCalls: [
            createToolCall({ id: '3', name: 'tool_a', status: 'completed' }),
            createToolCall({ id: '4', name: 'tool_c', status: 'running' })
          ]
        })
      ]
      const summary = getToolUsageSummary(messages)
      expect(summary.totalTools).toBe(4)
      expect(summary.completedTools).toBe(2)
      expect(summary.failedTools).toBe(1)
      expect(summary.runningTools).toBe(1)
      expect(summary.incompleteTools).toBe(0)
      expect(summary.uniqueToolNames).toEqual(['tool_a', 'tool_b', 'tool_c'])
    })

    it('returns empty summary for no messages', () => {
      const summary = getToolUsageSummary([])
      expect(summary.totalTools).toBe(0)
      expect(summary.completedTools).toBe(0)
      expect(summary.uniqueToolNames).toEqual([])
    })
  })
})
