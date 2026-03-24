/**
 * Streaming-First Conversation Store
 *
 * Clean architecture designed for real-time AI streaming responses.
 * No backward compatibility - built for streaming from the ground up.
 */

import { create } from 'zustand'

import { logger } from '@/lib/request-context'
import type { AgentConversationMessagePayload, AgentSegmentPayload, AgentToolCallPayload } from '@/types/agent-conversation'
import type { StructuredError } from '@/types/errors'
import type { AiEditContext } from '../app/develop/components/types'

// Development plan item
export interface PlanItem {
  id: string
  title: string
  description: string
  status: 'pending' | 'in_progress' | 'complete'
  tasks: string[]
  estimatedTime: string
}

// Core streaming segment types
export interface StreamSegment {
  id: string
  type: 'text' | 'tool_start' | 'tool_result' | 'tool_call' | 'content'
  content: string
  timestamp: Date
  toolCall?: ToolCall
}

export interface Conversation {
  id: string
  appId: string
  agentId: string
  title?: string
  createdAt: Date
  updatedAt: Date
  messageCount: number
}

export type ToolStatus = 'running' | 'completed' | 'error' | 'incomplete'

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  result?: Record<string, unknown> | string
  /** running = in progress; completed = got result; error = tool failed; incomplete = no result (e.g. stream truncated or timeout) */
  status: ToolStatus
  error?: string
  startTime?: number
  endTime?: number
  duration?: number
  partialInput?: string  // Accumulated partial input from deltas
}

export interface AgentSummary {
  id: string
  name?: string
  description?: string
}

// Server capabilities (for backwards compatibility)
export interface ServerCapabilities {
  supportsWebSocketHistory: boolean
  version?: string
}

// Streaming message (actively being built)
export interface StreamingMessage {
  id: string
  role: 'user' | 'assistant'
  content: string                  // Accumulated text content
  segments: StreamSegment[]        // Chronological segments
  toolCalls: ToolCall[]           // Tool invocations
  timestamp: Date
  isComplete: boolean
  maxStepsReached?: boolean        // True when agent hit max steps limit
  outputTokenLimitReached?: boolean // True when LLM hit maxOutputTokens (text truncation or incomplete tools)
  connectionLost?: boolean         // True when stream was aborted due to disconnect timeout
  userStopped?: boolean            // True when user clicked stop button
  upstreamError?: boolean           // True if an error from upstream service, if any
  budgetExceeded?: boolean         // True if user exceeded their usage budget
  error?: string                   // Error message
  errorType?: string               // Structured error type (e.g., 'RETRY_ERROR', 'NETWORK_ERROR')
  errorCode?: number               // HTTP status code
  retryAttempts?: number           // Number of retry attempts for retry errors
  retryReason?: string             // Reason for retry failure (e.g., 'maxRetriesExceeded', 'errorNotRetryable')
  selectedAssets?: any[]           // Attached files/assets (only for user messages, kept for type compatibility)
  referencedFiles?: Array<{ path: string; content: string }> // Referenced code files (only for user messages, kept for type compatibility)
  metadata?: {
    usage?: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
    }
    agentId?: string
    step?: number
  }
}

// Completed message (finalized)
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  segments?: StreamSegment[]       // Preserved for rich display
  toolCalls?: ToolCall[]
  timestamp: Date
  maxStepsReached?: boolean        // True when agent hit max steps limit
  outputTokenLimitReached?: boolean // True when LLM hit maxOutputTokens (text truncation or incomplete tools)
  connectionLost?: boolean         // True when stream was aborted due to disconnect timeout
  userStopped?: boolean            // True when user clicked stop button
  upstreamError?: boolean          // True if an error from upstream service, if any
  budgetExceeded?: boolean         // True if user exceeded their usage budget
  error?: string                   // Error message
  errorType?: string               // Structured error type (e.g., 'RETRY_ERROR', 'NETWORK_ERROR')
  errorCode?: number               // HTTP status code
  retryAttempts?: number           // Number of retry attempts for retry errors
  retryReason?: string             // Reason for retry failure (e.g., 'maxRetriesExceeded', 'errorNotRetryable')
  selectedAssets?: any[]           // Attached files/assets for user messages
  referencedFiles?: Array<{ path: string; content: string }> // Referenced code files for user messages
  metadata?: {
    usage?: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
    }
    agentId?: string
    totalSteps?: number
  }
}

// WebSocket connection state
export interface WebSocketState {
  connected: boolean
  status: 'idle' | 'connecting' | 'authenticating' | 'streaming' | 'completing' | 'error'
  error?: StructuredError
}

// Connection retry state - survives component remounts
export interface ConnectionRetryState {
  isRetrying: boolean
  retryStartedAt: number | null
  wasStreamingOnDisconnect: boolean
  disconnectSocketId: string | null
  escalationTimeoutId: ReturnType<typeof setTimeout> | null
}

// Recovery state (for state machine adapter)
export interface RecoveryState {
  isRecovering: boolean
  expectedEvents: number
  receivedEvents: number
}

// Retry state (for state machine adapter)
export interface RetryState {
  isRetrying: boolean
  retryCount: number
  nextRetryMs?: number
  exhausted?: boolean
}

// Main store state
export interface StreamingConversationState {
  // Core data
  messages: ChatMessage[]                    // Only completed messages
  activeStream: StreamingMessage | null     // Current streaming message

  // Stream state
  streamingState: 'idle' | 'streaming' | 'completing' | 'retrying' | 'error'
  currentStep: number

  // App context
  currentAppId: string | null
  inputValue: string
  isLoading: boolean

  // Additional context
  aiEditContext: AiEditContext | null
  buildErrorContext: { error: string; details: string; exitCode?: number } | null
  availableAgents: AgentSummary[]
  defaultAgentId: string | null
  currentAgentName: string | null
  developmentPlan: PlanItem[]

  // Per-app chat cache: messages and active streams
  appChatHistory: Record<string, { messages: ChatMessage[], activeStream: StreamingMessage | null }>

  // WebSocket state
  websocket: WebSocketState

  // Connection retry state - survives component remounts
  connectionRetry: ConnectionRetryState

  // State machine lifecycle state (synced by StoreSyncAdapter)
  recoveryState: RecoveryState
  retryState: RetryState
  lastError: Error | null

  // History loading state (for WebSocket history streaming)
  historyLoadingComplete: boolean

  // History pagination state
  historyHasMore: boolean
  historyNextCursor: string | null
  historyLoadingMore: boolean

  // Server capabilities (for backwards compatibility)
  serverCapabilities: ServerCapabilities | null

  // === CORE STREAMING ACTIONS ===

  // Stream lifecycle
  startNewStream: (userMessage: string, selectedAssets?: any[], referencedFiles?: Array<{ path: string; content: string }>) => void
  appendToStream: (content: string) => void
  addToolToStream: (toolCall: ToolCall) => void
  updateToolInStream: (toolId: string, updates: Partial<ToolCall>) => void
  updateToolDelta: (toolId: string, toolName: string, delta: string) => void
  finalizeStream: (metadata?: any) => void
  clearActiveStream: () => void

  // Stream content updates
  updateStreamContent: (content: string) => void
  appendTextSegment: (content: string) => void
  addToolStartSegment: (toolCall: ToolCall) => void
  addToolCallSegment: (toolCall: ToolCall) => void
  addToolResultSegment: (toolCall: ToolCall) => void
  markMaxStepsReached: () => void
  markUpstreamError: (error: StructuredError) => void
  markBudgetExceeded: () => void

  // === APP CONTEXT ACTIONS ===

  setCurrentAppId: (appId: string | null) => void
  setInputValue: (value: string) => void
  setIsLoading: (loading: boolean) => void
  setAiEditContext: (context: AiEditContext | null) => void
  setBuildErrorContext: (context: { error: string; details: string; exitCode?: number } | null) => void
  setAgentCatalog: (agents: AgentSummary[], defaultAgentId: string | null) => void
  setCurrentAgentName: (agentName: string | null) => void
  setDevelopmentPlan: (plan: PlanItem[]) => void

  // === WEBSOCKET ACTIONS ===

  setWebSocketState: (state: Partial<WebSocketState>) => void
  setStreamingState: (state: 'idle' | 'streaming' | 'completing' | 'retrying' | 'error') => void

  // State machine lifecycle actions (called by StoreSyncAdapter)
  setRecoveryState: (state: RecoveryState) => void
  setRetryState: (state: RetryState) => void
  setError: (error: Error) => void
  startStream: (conversationId: string, messageId: string) => void

  // History loading actions
  setHistoryLoadingComplete: (complete: boolean) => void

  // History pagination actions
  setHistoryPagination: (pagination: { hasMore: boolean; nextCursor: string | null }) => void
  setHistoryLoadingMore: (loading: boolean) => void
  resetHistoryPagination: () => void

  // === CONNECTION RETRY ACTIONS ===

  startConnectionRetry: (socketId: string) => void
  setEscalationTimeout: (timeoutId: ReturnType<typeof setTimeout>) => void
  clearConnectionRetry: () => void
  checkStaleRetry: () => boolean

  // === UTILITY ACTIONS ===

  addCompletedMessage: (message: ChatMessage) => void
  clearMessages: () => void
  cleanup: () => void

  // === UTILITY FUNCTIONS ===

  getMessageCount: () => number
  autoSendInitialMessage: (message: string, appId: string) => boolean

  // === UNIFIED HISTORY PERSISTENCE ===

  persistHistory: (params: {
    appId: string
    messages: ChatMessage[]
    activeStream?: StreamingMessage | null
    mode: 'replace' | 'append' | 'prepend'
  }) => void

  loadAndPersistHistory: (params: {
    appId: string
    rawMessages: any[]
    mode: 'replace' | 'append' | 'prepend'
    detectInProgress?: boolean
  }) => void
}

// Helper function to generate unique IDs
const generateId = () => `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

const parseDateValue = (value: unknown, fallback: Date | number = Date.now()): Date => {
  if (!value) return new Date(fallback)
  const date = new Date(value as string | number | Date)
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date
}

const normalizeToolCall = (toolCall?: AgentToolCallPayload): ToolCall | undefined => {
  if (!toolCall) return undefined

  return {
    id: toolCall.id ?? generateId(),
    name: toolCall.name ?? toolCall.toolName ?? 'unknown-tool',
    input: toolCall.input ?? {},
    result: toolCall.result,
    status: (toolCall.status ?? 'running') as ToolCall['status'],
    error: toolCall.error,
    startTime: toolCall.startTime ?? toolCall.start_time,
    endTime: toolCall.endTime ?? toolCall.end_time,
    duration: toolCall.duration,
    partialInput: toolCall.partialInput ?? toolCall.partial_input
  }
}

const normalizeSegments = (
  segments: AgentSegmentPayload[] | undefined,
  fallbackDate: Date
): StreamSegment[] => {
  if (!Array.isArray(segments)) return []

  return segments.map((segment) => {
    const normalizedToolCall = normalizeToolCall(segment.toolCall ?? segment.tool_call)

    return {
      id: segment.id ?? `${generateId()}_segment`,
      type: (segment.type ?? 'text') as StreamSegment['type'],
      content: segment.content ?? '',
      timestamp: parseDateValue(segment.timestamp ?? segment.createdAt, fallbackDate),
      ...(normalizedToolCall ? { toolCall: normalizedToolCall } : {})
    }
  })
}

const normalizeToolCalls = (toolCalls: AgentToolCallPayload[] | undefined): ToolCall[] => {
  if (!Array.isArray(toolCalls)) return []

  return toolCalls
    .map((toolCall) => normalizeToolCall(toolCall))
    .filter((toolCall): toolCall is ToolCall => Boolean(toolCall))
}

/**
 * Normalize backend conversation payloads into the shape the chat UI expects.
 */
export const normalizeConversationMessages = (
  rawMessages: AgentConversationMessagePayload[] | undefined
): ChatMessage[] => {
  if (!Array.isArray(rawMessages)) return []

  return rawMessages.map((msg) => {
    const role = msg.sender === 'user' || msg.role === 'user' ? 'user' : 'assistant'
    const createdAtValue = msg.createdAt ?? msg.timestamp ?? Date.now()
    const createdAtDate = parseDateValue(createdAtValue)

    const normalizedSegments = normalizeSegments(msg.segments, createdAtDate)
    const normalizedToolCalls = normalizeToolCalls(msg.toolCalls ?? msg.tool_calls)

    return {
      id: msg.id ?? generateId(),
      role,
      content: msg.content ?? '',
      timestamp: createdAtDate,
      toolCalls: normalizedToolCalls,
      segments: normalizedSegments,
      metadata: msg.metadata,
      maxStepsReached: msg.maxStepsReached ?? (
        typeof msg.metadata?.maxStepsReached === 'boolean'
          ? msg.metadata.maxStepsReached
          : undefined
      ),
      upstreamError: msg.upstreamError,
      budgetExceeded: msg.budgetExceeded,
      error: msg.error,
      errorType: msg.errorType,
      errorCode: msg.errorCode,
      retryAttempts: msg.retryAttempts,
      retryReason: msg.retryReason
    }
  })
}

// Create the store
export const useStreamingConversationStore = create<StreamingConversationState>()((set, get) => ({
  // === INITIAL STATE ===

  messages: [],
  activeStream: null,
  streamingState: 'idle',
  currentStep: 0,
  currentAppId: null,
  inputValue: '',
  isLoading: false,
  aiEditContext: null,
  buildErrorContext: null,
  availableAgents: [],
  defaultAgentId: null,
  currentAgentName: null,
  developmentPlan: [],
  appChatHistory: {},
  websocket: {
    connected: false,
    status: 'idle'
  },
  connectionRetry: {
    isRetrying: false,
    retryStartedAt: null,
    wasStreamingOnDisconnect: false,
    disconnectSocketId: null,
    escalationTimeoutId: null
  },
  recoveryState: {
    isRecovering: false,
    expectedEvents: 0,
    receivedEvents: 0
  },
  retryState: {
    isRetrying: false,
    retryCount: 0
  },
  lastError: null,
  historyLoadingComplete: false,
  historyHasMore: true, // Assume there might be more until we know
  historyNextCursor: null,
  historyLoadingMore: false,
  serverCapabilities: null,

  // === CORE STREAMING ACTIONS ===

  startNewStream: (userMessage: string, selectedAssets?: any[], referencedFiles?: Array<{ path: string; content: string }>) => {
    const userMsgId = generateId()
    const assistantMsgId = generateId()

    if (process.env.NODE_ENV === 'development') {
      logger.debug('streaming-store.start-stream', { userMessage, userMsgId, assistantMsgId, hasAssets: !!selectedAssets?.length, hasReferencedFiles: !!referencedFiles?.length })
    }

    // Add user message to completed messages
    const userChatMessage: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
      ...(selectedAssets && selectedAssets.length > 0 && { selectedAssets }),
      ...(referencedFiles && referencedFiles.length > 0 && { referencedFiles })
    }

    // Create new streaming message for assistant
    const streamingMessage: StreamingMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      segments: [],
      toolCalls: [],
      timestamp: new Date(),
      isComplete: false
    }

    set((state) => ({
      messages: [...state.messages, userChatMessage],
      activeStream: streamingMessage,
      streamingState: 'streaming',
      currentStep: 1,
      inputValue: '', // Clear input
      isLoading: true
    }))
  },

  appendToStream: (content: string) => {
    const { activeStream } = get()
    if (!activeStream) return

    const updatedStream = {
      ...activeStream,
      content: activeStream.content + content
    }

    set({ activeStream: updatedStream })
  },

  updateStreamContent: (content: string) => {
    const { activeStream } = get()
    if (!activeStream) return

    set({
      activeStream: {
        ...activeStream,
        content: content
      }
    })
  },

  appendTextSegment: (content: string) => {
    const { activeStream } = get()
    if (!activeStream) return

    const segment: StreamSegment = {
      id: generateId(),
      type: 'text',
      content,
      timestamp: new Date()
    }

    const updatedStream = {
      ...activeStream,
      content: activeStream.content + content,
      segments: [...activeStream.segments, segment]
    }


    set({ activeStream: updatedStream })
  },

  addToolToStream: (toolCall: ToolCall) => {
    const { activeStream } = get()
    if (!activeStream) return

    const updatedStream = {
      ...activeStream,
      toolCalls: [...activeStream.toolCalls, toolCall]
    }

    set({ activeStream: updatedStream })
  },

  addToolStartSegment: (toolCall: ToolCall) => {
    const { activeStream } = get()
    if (!activeStream) return

    logger.debug('streaming-store.tool.start', {
      toolId: toolCall.id,
      toolName: toolCall.name
    })

    // Check if tool already exists (created early by a tool_input_delta that arrived before this tool_start)
    const existingTool = activeStream.toolCalls.find(tc => tc.id === toolCall.id)

    if (existingTool) {
      // Update existing tool and its segment with the correct name/data from the authoritative tool_start event
      const updatedToolCalls = activeStream.toolCalls.map(tc =>
        tc.id === toolCall.id ? { ...tc, ...toolCall } : tc
      )
      const updatedSegments = activeStream.segments.map(segment => {
        if ((segment.type === 'tool_start' || segment.type === 'tool_call') && segment.toolCall?.id === toolCall.id) {
          return {
            ...segment,
            content: `Starting ${toolCall.name}...`,
            toolCall: { ...segment.toolCall, ...toolCall }
          }
        }
        return segment
      })

      set({
        activeStream: {
          ...activeStream,
          toolCalls: updatedToolCalls,
          segments: updatedSegments
        }
      })
    } else {
      const segment: StreamSegment = {
        id: generateId(),
        type: 'tool_start',
        content: `Starting ${toolCall.name}...`,
        timestamp: new Date(),
        toolCall
      }

      set({
        activeStream: {
          ...activeStream,
          segments: [...activeStream.segments, segment],
          toolCalls: [...activeStream.toolCalls, toolCall]
        }
      })
    }
  },

  addToolCallSegment: (toolCall: ToolCall) => {
    const { activeStream } = get()
    if (!activeStream) return

    // Find and update the existing tool_start segment with the input and name
    const updatedSegments = activeStream.segments.map(segment => {
      if (segment.type === 'tool_start' && segment.toolCall?.id === toolCall.id) {
        const resolvedName = toolCall.name || segment.toolCall.name
        return {
          ...segment,
          content: resolvedName !== segment.toolCall.name ? `Starting ${resolvedName}...` : segment.content,
          toolCall: {
            ...segment.toolCall,
            name: resolvedName,
            input: toolCall.input
          }
        }
      }
      return segment
    })

    // Also update the toolCall in the toolCalls array with the input and name
    const updatedToolCalls = activeStream.toolCalls.map(tc =>
      tc.id === toolCall.id ? { ...tc, name: toolCall.name || tc.name, input: toolCall.input } : tc
    )

    const updatedStream = {
      ...activeStream,
      segments: updatedSegments,
      toolCalls: updatedToolCalls
    }

    set({ activeStream: updatedStream })
  },

  addToolResultSegment: (toolCall: ToolCall) => {
    const { activeStream, messages } = get()

    logger.debug('streaming-store.tool.result', {
      toolId: toolCall.id,
      toolName: toolCall.name,
      status: toolCall.status,
      duration: toolCall.duration
    })

    // Apply to active stream only if it has this tool (otherwise treat as late result from a previous stream)
    if (activeStream?.toolCalls?.some(tc => tc.id === toolCall.id)) {
      const segment: StreamSegment = {
        id: generateId(),
        type: 'tool_result',
        content: typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result),
        timestamp: new Date(),
        toolCall
      }

      set({
        activeStream: {
          ...activeStream,
          segments: [...activeStream.segments, segment],
          toolCalls: activeStream.toolCalls.map(tc =>
            tc.id === toolCall.id ? toolCall : tc
          )
        }
      })
      return
    }

    // Race condition: tool_result arrived after finalizeStream, or belongs to a previous stream.
    // Apply the result to the most recent assistant message that has a matching tool
    // (search back in case last message is not assistant).
    let targetIndex = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'assistant' && msg.toolCalls?.some(tc => tc.id === toolCall.id)) {
        targetIndex = i
        break
      }
    }
    if (targetIndex < 0) {
      const assistantSummary = messages
        .map((m, i) => m.role === 'assistant' ? { index: i, messageId: m.id, toolIds: m.toolCalls?.map(tc => tc.id) ?? [] } : null)
        .filter(Boolean)
      logger.warn('streaming-store.tool.result.dropped', {
        toolId: toolCall.id,
        toolName: toolCall.name,
        reason: 'no_matching_tool_in_messages',
        assistantMessagesChecked: assistantSummary
      })
      return
    }

    const lastMessage = messages[targetIndex]
    logger.info('streaming-store.tool.result.late_apply', {
      toolId: toolCall.id,
      toolName: toolCall.name,
      messageId: lastMessage.id
    })

    const resultSegment: StreamSegment = {
      id: generateId(),
      type: 'tool_result',
      content: typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result),
      timestamp: new Date(),
      toolCall
    }

    const updatedMessage: ChatMessage = {
      ...lastMessage,
      segments: [...(lastMessage.segments || []), resultSegment],
      toolCalls: lastMessage.toolCalls?.map(tc =>
        tc.id === toolCall.id ? toolCall : tc
      )
    }

    set({
      messages: [...messages.slice(0, targetIndex), updatedMessage, ...messages.slice(targetIndex + 1)]
    })
  },

  markMaxStepsReached: () => {
    const { activeStream } = get()
    if (!activeStream) return

    const updatedStream = {
      ...activeStream,
      maxStepsReached: true
    }

    set({ activeStream: updatedStream })
  },

  markUpstreamError: (error: StructuredError) => {
    const { activeStream, currentAppId } = get()
    if (!activeStream) {
      logger.error('streaming-store.mark-upstream-error.no-active-stream', {
        appId: currentAppId ?? undefined,
        message: 'No active stream to mark as error'
      })
      return
    }

    const updatedStream = {
      ...activeStream,
      upstreamError: true,
      error: error.message,
      errorType: error.type,
      errorCode: error.statusCode,
      ...(error.retryAttempts !== undefined && { retryAttempts: error.retryAttempts }),
      ...(error.retryReason && { retryReason: error.retryReason })
    }

    set({ activeStream: updatedStream })
  },

  markBudgetExceeded: () => {
    const { activeStream } = get();
    if (!activeStream) return;

    const updatedStream = {
      ...activeStream,
      budgetExceeded: true
    }

    set({ activeStream: updatedStream });
  },

  updateToolInStream: (toolId: string, updates: Partial<ToolCall>) => {
    const { activeStream } = get()
    if (!activeStream) return

    const updatedStream = {
      ...activeStream,
      toolCalls: activeStream.toolCalls.map(tc =>
        tc.id === toolId ? { ...tc, ...updates } : tc
      )
    }

    set({ activeStream: updatedStream })
  },

  updateToolDelta: (toolId: string, toolName: string, delta: string) => {
    const { activeStream } = get()
    if (!activeStream) return

    // Check if tool exists in toolCalls array
    const existingTool = activeStream.toolCalls.find(tc => tc.id === toolId)

    // If toolName is missing/unknown, try to find it from existing tool or segments
    let resolvedToolName = toolName
    if (!existingTool && (toolName === 'unknown-tool' || !toolName)) {
      // Try to find tool name from segments
      const segmentWithTool = activeStream.segments.find(
        s => (s.type === 'tool_start' || s.type === 'tool_call') && s.toolCall?.id === toolId
      )
      if (segmentWithTool?.toolCall?.name) {
        resolvedToolName = segmentWithTool.toolCall.name
      }
    } else if (existingTool && existingTool.name) {
      resolvedToolName = existingTool.name
    }

    if (!existingTool) {
      // Tool doesn't exist yet - create it (handles race condition where delta arrives before tool_start)
      const newToolCall: ToolCall = {
        id: toolId,
        name: resolvedToolName,
        input: {},
        status: 'running',
        startTime: Date.now(),
        partialInput: delta
      }

      const segment: StreamSegment = {
        id: generateId(),
        type: 'tool_start',
        content: `Starting ${resolvedToolName}...`,
        timestamp: new Date(),
        toolCall: newToolCall
      }

      const updatedStream = {
        ...activeStream,
        toolCalls: [...activeStream.toolCalls, newToolCall],
        segments: [...activeStream.segments, segment]
      }

      set({ activeStream: updatedStream })
      return
    }

    // Tool exists - update it
    const updatedStream = {
      ...activeStream,
      toolCalls: activeStream.toolCalls.map(tc => {
        if (tc.id === toolId) {
          const currentPartial = tc.partialInput || ''
          return {
            ...tc,
            partialInput: currentPartial + delta
          }
        }
        return tc
      }),
      segments: activeStream.segments.map(segment => {
        if ((segment.type === 'tool_start' || segment.type === 'tool_call') && segment.toolCall?.id === toolId) {
          const currentPartial = segment.toolCall.partialInput || ''
          return {
            ...segment,
            toolCall: {
              ...segment.toolCall,
              partialInput: currentPartial + delta
            }
          }
        }
        return segment
      })
    }

    set({ activeStream: updatedStream })
  },

  finalizeStream: (metadata?: any) => {
    const { activeStream } = get()
    if (!activeStream) return

    // Mark any tools still in 'running' state as 'incomplete'
    // This happens when the LLM hits maxOutputTokens mid-tool-call,
    // so tool-input-start fires but tool-call/tool-result never arrive
    const runningToolIds: string[] = []
    const finalizedToolCalls = activeStream.toolCalls.map(tc => {
      if (tc.status === 'running') {
        runningToolIds.push(tc.id)
        return { ...tc, status: 'incomplete' as const }
      }
      return tc
    })

    const finalizedSegments = activeStream.segments.map(segment => {
      const isToolSegment = (segment.type === 'tool_start' || segment.type === 'tool_call') &&
        segment.toolCall?.status === 'running'
      if (isToolSegment) {
        return {
          ...segment,
          toolCall: { ...segment.toolCall, status: 'incomplete' as const }
        }
      }
      return segment
    })

    if (runningToolIds.length > 0) {
      logger.warn('streaming-store.stream.finalize.incomplete_tools', {
        messageId: activeStream.id,
        incompleteToolIds: runningToolIds,
        incompleteToolCount: runningToolIds.length
      })
    }

    // Detect output token limit: LLM hit maxOutputTokens (text truncation or incomplete tools)
    const outputTokenLimitReached = metadata?.finishReason === 'length'
    // Detect connection lost: stream aborted due to disconnect grace period timeout
    const connectionLost = metadata?.finishReason === 'aborted'
    // Detect user-initiated stop
    const userStopped = metadata?.finishReason === 'user_stopped'

    if (outputTokenLimitReached) {
      logger.warn('streaming-store.stream.finalize.output_limit', {
        messageId: activeStream.id,
        finishReason: metadata?.finishReason,
        incompleteToolCount: runningToolIds.length
      })
    }

    if (connectionLost) {
      logger.warn('streaming-store.stream.finalize.connection_lost', {
        messageId: activeStream.id,
        finishReason: metadata?.finishReason,
      })
    }

    if (userStopped) {
      logger.info('streaming-store.stream.finalize.user_stopped', {
        messageId: activeStream.id,
      })
    }

    logger.debug('streaming-store.stream.finalize', {
      messageId: activeStream.id,
      contentLength: activeStream.content.length,
      toolCallCount: activeStream.toolCalls.length,
      segmentCount: activeStream.segments.length,
      maxStepsReached: activeStream.maxStepsReached,
      outputTokenLimitReached,
      upstreamError: activeStream.upstreamError,
      budgetExceeded: activeStream.budgetExceeded
    })

    // Convert streaming message to completed message
    const completedMessage: ChatMessage = {
      id: activeStream.id,
      role: activeStream.role,
      content: activeStream.content,
      segments: finalizedSegments,
      toolCalls: finalizedToolCalls,
      timestamp: new Date(),
      maxStepsReached: activeStream.maxStepsReached,
      outputTokenLimitReached: outputTokenLimitReached || undefined,
      connectionLost: connectionLost || undefined,
      userStopped: userStopped || undefined,
      upstreamError: activeStream.upstreamError,
      budgetExceeded: activeStream.budgetExceeded,
      ...(activeStream.error && { error: activeStream.error }),
      ...(activeStream.errorType && { errorType: activeStream.errorType }),
      ...(activeStream.errorCode !== undefined && { errorCode: activeStream.errorCode }),
      ...(activeStream.retryAttempts !== undefined && { retryAttempts: activeStream.retryAttempts }),
      ...(activeStream.retryReason && { retryReason: activeStream.retryReason }),
      metadata: {
        ...activeStream.metadata,
        ...metadata
      }
    }

    set((state) => ({
      messages: state.messages.some((m) => m.id === completedMessage.id)
        ? state.messages
        : [...state.messages, completedMessage],
      activeStream: null,
      streamingState: 'idle',
      isLoading: false
    }))
  },

  clearActiveStream: () => {
    set({
      activeStream: null,
      streamingState: 'idle',
      isLoading: false
    })
  },

  // === APP CONTEXT ACTIONS ===

  setCurrentAppId: (appId) => {
    set((state) => {
      if (state.currentAppId === appId) {
        return state; // Same app, no-op
      }

      const newAppChatHistory = { ...state.appChatHistory };

      // Save current app's messages and active stream
      if (state.currentAppId) {
        newAppChatHistory[state.currentAppId] = {
          messages: state.messages,
          activeStream: state.activeStream
        };
      }

      // Clear escalation timeout when switching apps
      if (state.connectionRetry.escalationTimeoutId) {
        clearTimeout(state.connectionRetry.escalationTimeoutId);
      }

      // Get saved state for the new app (or defaults)
      const savedState = appId ? newAppChatHistory[appId] : null;

      return {
        currentAppId: appId,
        messages: savedState?.messages ?? [],
        activeStream: null, // Always null - let recovery determine stream state
        streamingState: 'idle' as const, // Always idle - recovery will set streaming if needed
        isLoading: false, // Always false - recovery will set loading if needed
        currentStep: 0,
        inputValue: '',
        aiEditContext: null,
        buildErrorContext: null,
        availableAgents: [],
        defaultAgentId: null,
        currentAgentName: null, // Reset agent name when switching apps
        appChatHistory: newAppChatHistory,
        websocket: { connected: false, status: 'idle' as const },
        connectionRetry: {
          isRetrying: false,
          retryStartedAt: null,
          wasStreamingOnDisconnect: false,
          disconnectSocketId: null,
          escalationTimeoutId: null
        },
        historyLoadingComplete: false,
        // Reset pagination when switching apps
        historyHasMore: true,
        historyNextCursor: null,
        historyLoadingMore: false,
        serverCapabilities: null // Reset capabilities when switching apps
      };
    });
  },
  setInputValue: (value) => set({ inputValue: value }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setAiEditContext: (context) => set({ aiEditContext: context }),
  setBuildErrorContext: (context) => set({ buildErrorContext: context }),
  setAgentCatalog: (agents, defaultAgentId) => set({
    availableAgents: agents,
    defaultAgentId: defaultAgentId ?? null
  }),
  setCurrentAgentName: (agentName) => set({ currentAgentName: agentName }),
  setDevelopmentPlan: (plan) => set({ developmentPlan: plan }),

  // === WEBSOCKET ACTIONS ===

  setWebSocketState: (state) => {
    set((prevState) => ({
      websocket: { ...prevState.websocket, ...state }
    }))
  },

  setStreamingState: (state) => set({ streamingState: state }),

  // State machine lifecycle actions (called by StoreSyncAdapter)
  setRecoveryState: (state) => set({ recoveryState: state }),

  setRetryState: (state) => set({ retryState: state }),

  setError: (error) => set({ lastError: error }),

  startStream: (_conversationId, _messageId) => {
    set({
      streamingState: 'streaming',
      currentStep: 1,
      isLoading: true,
      // Note: Conversation/message management is handled by StreamingWebSocketController
      // This action is called by StoreSyncAdapter to sync machine state to store
    })
  },

  // History loading actions
  setHistoryLoadingComplete: (complete) => set({ historyLoadingComplete: complete }),

  // History pagination actions
  setHistoryPagination: (pagination) => {
    set({
      historyHasMore: pagination.hasMore,
      historyNextCursor: pagination.nextCursor
    })
  },

  setHistoryLoadingMore: (loading) => {
    set({ historyLoadingMore: loading })
  },

  resetHistoryPagination: () => {
    set({
      historyHasMore: true,
      historyNextCursor: null,
      historyLoadingMore: false
    })
  },

  // === CONNECTION RETRY ACTIONS ===

  startConnectionRetry: (socketId: string) => {
    logger.info('streaming-store.connection-retry.start', { socketId })
    set({
      connectionRetry: {
        isRetrying: true,
        retryStartedAt: Date.now(),
        wasStreamingOnDisconnect: true,
        disconnectSocketId: socketId,
        escalationTimeoutId: null
      },
      streamingState: 'retrying'
    })
  },

  setEscalationTimeout: (timeoutId: ReturnType<typeof setTimeout>) => {
    set((state) => ({
      connectionRetry: {
        ...state.connectionRetry,
        escalationTimeoutId: timeoutId
      }
    }))
  },

  clearConnectionRetry: () => {
    const currentState = get();

    // Clear escalation timeout if active
    if (currentState.connectionRetry.escalationTimeoutId) {
      clearTimeout(currentState.connectionRetry.escalationTimeoutId);
    }

    logger.info('streaming-store.connection-retry.clear', {
      wasRetrying: currentState.connectionRetry.isRetrying,
      elapsedMs: currentState.connectionRetry.retryStartedAt
        ? Date.now() - currentState.connectionRetry.retryStartedAt
        : null
    });

    set((state) => ({
      connectionRetry: {
        isRetrying: false,
        retryStartedAt: null,
        wasStreamingOnDisconnect: false,
        disconnectSocketId: null,
        escalationTimeoutId: null
      },
      streamingState: state.activeStream ? 'streaming' : 'idle'
    }));
  },

  checkStaleRetry: () => {
    const { connectionRetry } = get()
    if (!connectionRetry.isRetrying || !connectionRetry.retryStartedAt) {
      return false
    }
    const elapsedMs = Date.now() - connectionRetry.retryStartedAt
    const CONNECTION_RETRY_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
    const isStale = elapsedMs > CONNECTION_RETRY_TIMEOUT_MS
    if (isStale) {
      logger.warn('streaming-store.connection-retry.stale-detected', {
        elapsedMs,
        retryStartedAt: connectionRetry.retryStartedAt
      })
    }
    return isStale
  },

  // === UTILITY ACTIONS ===

  addCompletedMessage: (message) => {
    set((state) => ({
      messages: [...state.messages, message]
    }))
  },

  clearMessages: () => {
    set({
      messages: [],
      activeStream: null,
      streamingState: 'idle'
    })
  },

  cleanup: () => {
    const currentState = get()

    // Clear escalation timeout before resetting state
    if (currentState.connectionRetry.escalationTimeoutId) {
      clearTimeout(currentState.connectionRetry.escalationTimeoutId)
    }

    set({
      messages: [],
      activeStream: null,
      streamingState: 'idle',
      currentStep: 0,
      currentAppId: null,
      inputValue: '',
      isLoading: false,
      aiEditContext: null,
      appChatHistory: {},
      websocket: { connected: false, status: 'idle' },
      connectionRetry: {
        isRetrying: false,
        retryStartedAt: null,
        wasStreamingOnDisconnect: false,
        disconnectSocketId: null,
        escalationTimeoutId: null
      },
      serverCapabilities: null,
      historyLoadingComplete: false
    });
  },

  // === UTILITY FUNCTIONS ===

  getMessageCount: () => {
    const { messages, activeStream } = get()
    return messages.length + (activeStream ? 1 : 0)
  },

  // Auto-send initial message for new apps
  autoSendInitialMessage: (message: string, appId: string) => {
    const state = get()

    // Only auto-send if we have no messages for this app and we're not currently loading
    const hasNoMessages = state.messages.length === 0 && !state.activeStream
    const isCorrectApp = state.currentAppId === appId
    const isNotLoading = !state.isLoading && state.streamingState === 'idle'

    if (hasNoMessages && isCorrectApp && isNotLoading && message.trim()) {
      // Set the input value and trigger the send
      set({ inputValue: message.trim() })
      return true
    }

    return false
  },

  // === UNIFIED HISTORY PERSISTENCE ===

  /**
   * Unified action for persisting history to both messages and appChatHistory
   * Used by HTTP loaders and WebSocket handlers to maintain consistency
   */
  persistHistory: (params: {
    appId: string
    messages: ChatMessage[]
    activeStream?: StreamingMessage | null
    mode: 'replace' | 'append' | 'prepend'
  }) => {
    const { appId, messages, activeStream = null, mode } = params

    set((state) => {
      let updatedMessages: ChatMessage[]

      switch (mode) {
        case 'replace':
          updatedMessages = messages
          break
        case 'append': {
          const existingIds = new Set(state.messages.map((m) => m.id))
          updatedMessages = [...state.messages, ...messages.filter((m) => !existingIds.has(m.id))]
          break
        }
        case 'prepend': {
          // Deduplicate by ID before sorting — state may already contain some of these
          // messages if appChatHistory was restored or a recovery overlapped with pagination
          const existingIds = new Set(state.messages.map((m) => m.id))
          const newMessages = messages.filter((m) => !existingIds.has(m.id))
          updatedMessages = [...newMessages, ...state.messages].sort(
            (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
          )
          break
        }
      }

      return {
        messages: updatedMessages,
        appChatHistory: {
          ...state.appChatHistory,
          [appId]: {
            messages: updatedMessages,
            activeStream: activeStream ?? state.activeStream
          }
        }
      }
    })

    logger.debug('streaming-store.history-persisted', {
      appId,
      messageCount: messages.length,
      totalMessages: get().messages.length,
      mode
    })
  },

  /**
   * Unified action for normalizing and persisting history
   * Handles in-progress message detection and extraction
   */
  loadAndPersistHistory: (params: {
    appId: string
    rawMessages: any[]
    mode: 'replace' | 'append' | 'prepend'
    detectInProgress?: boolean
  }) => {
    const { appId, rawMessages, mode, detectInProgress = false } = params
    const normalized = normalizeConversationMessages(rawMessages)

    let messages = normalized
    let activeStream: StreamingMessage | null = null

    // Extract in-progress message if requested
    if (detectInProgress && normalized.length > 0) {
      const lastMsg = normalized[normalized.length - 1]
      const isInProgress = lastMsg.role === 'assistant' &&
        (lastMsg.metadata as any)?.inProgress === true

      if (isInProgress) {
        activeStream = {
          id: lastMsg.id,
          role: 'assistant',
          content: lastMsg.content || '',
          segments: lastMsg.segments || [],
          toolCalls: lastMsg.toolCalls || [],
          timestamp: lastMsg.timestamp,
          isComplete: false,
        }
        messages = normalized.slice(0, -1)

        logger.debug('streaming-store.in-progress-detected', {
          messageId: activeStream.id,
          contentLength: activeStream.content.length
        })
      }
    }

    get().persistHistory({
      appId,
      messages,
      activeStream,
      mode
    })

    // If we detected an in-progress message, also update the streaming state
    if (activeStream) {
      set({
        activeStream,
        streamingState: 'streaming',
        isLoading: true,
      })
    }
  },
}))

// === SELECTORS ===

export const useMessages = () => useStreamingConversationStore(state => state.messages)
export const useActiveStream = () => useStreamingConversationStore(state => state.activeStream)

// Simple approach: remove the problematic combined selector
// Components should use useMessages and useActiveStream separately and combine with useMemo
export const useStreamingState = () => useStreamingConversationStore(state => state.streamingState)

// Memoized selector for streaming check
const isActivelyStreamingSelector = (state: StreamingConversationState) =>
  state.streamingState === 'streaming' && !!state.activeStream

export const useIsActivelyStreaming = () => useStreamingConversationStore(isActivelyStreamingSelector)
export const useInputValue = () => useStreamingConversationStore(state => state.inputValue)
export const useIsLoading = () => useStreamingConversationStore(state => state.isLoading)
export const useCurrentAppId = () => useStreamingConversationStore(state => state.currentAppId)
export const useWebSocketState = () => useStreamingConversationStore(state => state.websocket)

// Individual action selectors to prevent infinite loops
export const useStartNewStream = () => useStreamingConversationStore(state => state.startNewStream)
export const useAppendTextSegment = () => useStreamingConversationStore(state => state.appendTextSegment)
export const useAddToolStartSegment = () => useStreamingConversationStore(state => state.addToolStartSegment)
export const useAddToolCallSegment = () => useStreamingConversationStore(state => state.addToolCallSegment)
export const useAddToolResultSegment = () => useStreamingConversationStore(state => state.addToolResultSegment)
export const useMarkMaxStepsReached = () => useStreamingConversationStore(state => state.markMaxStepsReached)
export const useMarkUpstreamError = () => useStreamingConversationStore(state => state.markUpstreamError)
export const useMarkBudgetExceeded = () => useStreamingConversationStore(state => state.markBudgetExceeded)

// Derived selector: check if the most recent message or active stream has budgetExceeded
const hasBudgetExceededSelector = (state: StreamingConversationState) => {
  if (state.activeStream?.budgetExceeded) return true
  const lastMessage = state.messages[state.messages.length - 1]
  return lastMessage?.budgetExceeded === true
}

export const useBudgetExceeded = () => useStreamingConversationStore(hasBudgetExceededSelector)
export const useFinalizeStream = () => useStreamingConversationStore(state => state.finalizeStream)
export const useAutoSendInitialMessage = () => useStreamingConversationStore(state => state.autoSendInitialMessage)

export const useSetCurrentAppId = () => useStreamingConversationStore(state => state.setCurrentAppId)
export const useSetInputValue = () => useStreamingConversationStore(state => state.setInputValue)
export const useSetIsLoading = () => useStreamingConversationStore(state => state.setIsLoading)
export const useSetAiEditContext = () => useStreamingConversationStore(state => state.setAiEditContext)
export const useSetBuildErrorContext = () => useStreamingConversationStore(state => state.setBuildErrorContext)
export const useSetAgentCatalog = () => useStreamingConversationStore(state => state.setAgentCatalog)
export const useSetDevelopmentPlan = () => useStreamingConversationStore(state => state.setDevelopmentPlan)

export const useSetWebSocketState = () => useStreamingConversationStore(state => state.setWebSocketState)
export const useSetStreamingState = () => useStreamingConversationStore(state => state.setStreamingState)

// History loading selectors
export const useHistoryLoadingComplete = () => useStreamingConversationStore(state => state.historyLoadingComplete)
export const useSetHistoryLoadingComplete = () => useStreamingConversationStore(state => state.setHistoryLoadingComplete)

// Connection retry selectors
export const useConnectionRetry = () => useStreamingConversationStore(state => state.connectionRetry)
export const useStartConnectionRetry = () => useStreamingConversationStore(state => state.startConnectionRetry)
export const useSetEscalationTimeout = () => useStreamingConversationStore(state => state.setEscalationTimeout)
export const useClearConnectionRetry = () => useStreamingConversationStore(state => state.clearConnectionRetry)
export const useCheckStaleRetry = () => useStreamingConversationStore(state => state.checkStaleRetry)

export const useDevelopmentPlan = () => useStreamingConversationStore(state => state.developmentPlan)
export const useAiEditContext = () => useStreamingConversationStore(state => state.aiEditContext)
export const useBuildErrorContext = () => useStreamingConversationStore(state => state.buildErrorContext)
export const useAvailableAgents = () => useStreamingConversationStore(state => state.availableAgents)
export const useDefaultAgentId = () => useStreamingConversationStore(state => state.defaultAgentId)
export const useCurrentAgentName = () => useStreamingConversationStore(state => state.currentAgentName)
