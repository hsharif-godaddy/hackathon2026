/**
 * Agent conversation payload types returned from the backend.
 * Mirrors the DTO shape so UI normalization can be typed safely.
 */
export interface AgentToolCallPayload {
  id?: string
  name?: string
  toolName?: string
  status?: 'running' | 'completed' | 'error' | string
  input?: Record<string, unknown>
  result?: Record<string, unknown> | string
  error?: string
  startTime?: number
  endTime?: number
  duration?: number
  start_time?: number
  end_time?: number
  partialInput?: string
  partial_input?: string
}

export interface AgentSegmentPayload {
  id?: string
  type?: string
  content?: string
  timestamp?: string | number | Date
  createdAt?: string | number | Date
  toolCall?: AgentToolCallPayload
  tool_call?: AgentToolCallPayload
}

export interface AgentConversationMessagePayload {
  id?: string
  sender?: 'user' | 'assistant' | string
  role?: 'user' | 'assistant'
  content?: string
  createdAt?: string | number | Date
  timestamp?: string | number | Date
  segments?: AgentSegmentPayload[]
  toolCalls?: AgentToolCallPayload[]
  tool_calls?: AgentToolCallPayload[]
  metadata?: Record<string, unknown>
  maxStepsReached?: boolean
  usedFreeGrants?: boolean
  upstreamError?: boolean
  budgetExceeded?: boolean
  error?: string
  errorType?: string
  errorCode?: number
  retryAttempts?: number
  retryReason?: string
}
