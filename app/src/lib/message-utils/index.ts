/**
 * Message Utilities
 *
 * Pure utility functions for working with ChatMessage and StreamingMessage objects.
 * Provides reusable, testable logic for common message operations.
 */

import type { ChatMessage, StreamingMessage, ToolCall } from '@/stores/useStreamingConversationStore'

/**
 * Check if a message represents an error state
 */
export function isErrorMessage(message: ChatMessage | StreamingMessage): boolean {
  return !!(
    message.error ||
    message.upstreamError ||
    message.budgetExceeded ||
    message.maxStepsReached ||
    message.connectionLost ||
    message.userStopped
  )
}

/**
 * Get a human-readable error summary from a message
 * Returns null if the message has no error
 */
export function getErrorSummary(message: ChatMessage | StreamingMessage): string | null {
  if (message.budgetExceeded) return 'Usage budget exceeded'
  if (message.maxStepsReached) return 'Maximum steps reached'
  if (message.connectionLost) return 'Connection lost'
  if (message.userStopped) return 'Generation stopped by user'
  if (message.upstreamError) return 'Upstream error'
  if (message.error) return message.error
  return null
}

/**
 * Extract all tool calls from a message
 */
export function extractToolCalls(message: ChatMessage | StreamingMessage): ToolCall[] {
  return message.toolCalls ?? []
}

/**
 * Get only completed tool calls
 */
export function getCompletedTools(message: ChatMessage | StreamingMessage): ToolCall[] {
  return extractToolCalls(message).filter(tc => tc.status === 'completed')
}

/**
 * Get only failed tool calls
 */
export function getFailedTools(message: ChatMessage | StreamingMessage): ToolCall[] {
  return extractToolCalls(message).filter(tc => tc.status === 'error')
}

/**
 * Get only running tool calls
 */
export function getRunningTools(message: ChatMessage | StreamingMessage): ToolCall[] {
  return extractToolCalls(message).filter(tc => tc.status === 'running')
}

/**
 * Get incomplete tool calls (no result received)
 */
export function getIncompleteTools(message: ChatMessage | StreamingMessage): ToolCall[] {
  return extractToolCalls(message).filter(tc => tc.status === 'incomplete')
}

/**
 * Check if a message has any tool calls
 */
export function hasToolCalls(message: ChatMessage | StreamingMessage): boolean {
  return extractToolCalls(message).length > 0
}

/**
 * Check if a message has any failed tools
 */
export function hasFailedTools(message: ChatMessage | StreamingMessage): boolean {
  return getFailedTools(message).length > 0
}

/**
 * Extract plain text content from a message
 */
export function extractTextContent(message: ChatMessage | StreamingMessage): string {
  return message.content
}

/**
 * Calculate total token usage across multiple messages
 */
export function calculateTotalTokens(messages: ChatMessage[]): {
  inputTokens: number
  outputTokens: number
  totalTokens: number
} {
  return messages.reduce(
    (acc, msg) => ({
      inputTokens: acc.inputTokens + (msg.metadata?.usage?.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (msg.metadata?.usage?.outputTokens ?? 0),
      totalTokens: acc.totalTokens + (msg.metadata?.usage?.totalTokens ?? 0)
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  )
}

/**
 * Filter messages by role
 */
export function filterMessagesByRole(
  messages: ChatMessage[],
  role: 'user' | 'assistant'
): ChatMessage[] {
  return messages.filter(m => m.role === role)
}

/**
 * Get the last user message from a conversation
 */
export function getLastUserMessage(messages: ChatMessage[]): ChatMessage | null {
  const userMessages = filterMessagesByRole(messages, 'user')
  return userMessages[userMessages.length - 1] ?? null
}

/**
 * Get the last assistant message from a conversation
 */
export function getLastAssistantMessage(messages: ChatMessage[]): ChatMessage | null {
  const assistantMessages = filterMessagesByRole(messages, 'assistant')
  return assistantMessages[assistantMessages.length - 1] ?? null
}

/**
 * Check if a message is still streaming (not complete)
 */
export function isStreaming(message: ChatMessage | StreamingMessage): boolean {
  return 'isComplete' in message && !message.isComplete
}

/**
 * Check if a message is from the user
 */
export function isUserMessage(message: ChatMessage | StreamingMessage): boolean {
  return message.role === 'user'
}

/**
 * Check if a message is from the assistant
 */
export function isAssistantMessage(message: ChatMessage | StreamingMessage): boolean {
  return message.role === 'assistant'
}

/**
 * Get error type and details for structured error handling
 */
export function getErrorDetails(message: ChatMessage | StreamingMessage): {
  type: string | null
  code: number | null
  message: string | null
  retryable: boolean
} {
  if (!isErrorMessage(message)) {
    return { type: null, code: null, message: null, retryable: false }
  }

  return {
    type: message.errorType ?? null,
    code: message.errorCode ?? null,
    message: getErrorSummary(message),
    retryable: message.errorType === 'RETRY_ERROR'
  }
}

/**
 * Count messages by role
 */
export function countMessagesByRole(messages: ChatMessage[]): {
  user: number
  assistant: number
  total: number
} {
  const counts = messages.reduce(
    (acc, msg) => {
      if (msg.role === 'user') acc.user++
      if (msg.role === 'assistant') acc.assistant++
      return acc
    },
    { user: 0, assistant: 0 }
  )

  return {
    ...counts,
    total: messages.length
  }
}

/**
 * Get all messages with errors
 */
export function getErrorMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(isErrorMessage)
}

/**
 * Calculate total tool execution time across messages
 */
export function calculateTotalToolTime(messages: ChatMessage[]): number {
  return messages.reduce((total, msg) => {
    const toolTime = extractToolCalls(msg).reduce(
      (sum, tool) => sum + (tool.duration ?? 0),
      0
    )
    return total + toolTime
  }, 0)
}

/**
 * Get a summary of tool usage across messages
 */
export function getToolUsageSummary(messages: ChatMessage[]): {
  totalTools: number
  completedTools: number
  failedTools: number
  runningTools: number
  incompleteTools: number
  uniqueToolNames: string[]
} {
  const allTools = messages.flatMap(extractToolCalls)
  const uniqueNames = new Set(allTools.map(t => t.name))

  return {
    totalTools: allTools.length,
    completedTools: allTools.filter(t => t.status === 'completed').length,
    failedTools: allTools.filter(t => t.status === 'error').length,
    runningTools: allTools.filter(t => t.status === 'running').length,
    incompleteTools: allTools.filter(t => t.status === 'incomplete').length,
    uniqueToolNames: Array.from(uniqueNames)
  }
}
