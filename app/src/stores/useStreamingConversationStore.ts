/**
 * Streaming-First Conversation Store
 *
 * Clean architecture designed for real-time AI streaming responses.
 * No backward compatibility - built for streaming from the ground up.
 */

import { create } from 'zustand'

import { logger } from '@/lib/request-context'
import type { StructuredError } from '@/types/errors'
import type { AgentConversationMessagePayload, AgentSegmentPayload, AgentToolCallPayload } from '@/types/agent-conversation'
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

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  result?: Record<string, unknown> | string
  status: 'running' | 'completed' | 'error'
  error?: string
  startTime?: number
  endTime?: number
  duration?: number
  partialInput?: string  // Accumulated partial input from deltas
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
  upstreamError?: boolean           // True if an error from upstream service, if any
  budgetExceeded?: boolean         // True if user exceeded their usage budget
  error?: string                   // Error message
  errorType?: string               // Structured error type (e.g., 'RETRY_ERROR', 'NETWORK_ERROR')
  errorCode?: number               // HTTP status code
  retryAttempts?: number           // Number of retry attempts for retry errors
  retryReason?: string             // Reason for retry failure (e.g., 'maxRetriesExceeded', 'errorNotRetryable')
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
  upstreamError?: boolean           // True if an error from upstream service, if any
  budgetExceeded?: boolean         // True if user exceeded their usage budget
  error?: string                   // Error message
  errorType?: string               // Structured error type (e.g., 'RETRY_ERROR', 'NETWORK_ERROR')
  errorCode?: number               // HTTP status code
  retryAttempts?: number           // Number of retry attempts for retry errors
  retryReason?: string             // Reason for retry failure (e.g., 'maxRetriesExceeded', 'errorNotRetryable')
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
  status: 'idle' | 'connecting' | 'streaming' | 'completing' | 'error'
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
  developmentPlan: PlanItem[]
  conversations: Conversation[]

  // Pagination state
  conversationPagination: {
    total: number
    loaded: number
    hasMore: boolean
    isLoading: boolean
  }

  // Per-app chat history cache (for future enhancement)
  appChatHistory: Record<string, ChatMessage[]>

  // WebSocket state
  websocket: WebSocketState

  // Connection retry state - survives component remounts
  connectionRetry: ConnectionRetryState

  // State machine lifecycle state (synced by StoreSyncAdapter)
  recoveryState: RecoveryState
  retryState: RetryState
  lastError: Error | null

  // === CORE STREAMING ACTIONS ===

  // Stream lifecycle
  startNewStream: (userMessage: string) => void
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
  setDevelopmentPlan: (plan: PlanItem[]) => void
  setConversations: (conversations: Conversation[]) => void

  // === WEBSOCKET ACTIONS ===

  setWebSocketState: (state: Partial<WebSocketState>) => void
  setStreamingState: (state: 'idle' | 'streaming' | 'completing' | 'retrying' | 'error') => void

  // State machine lifecycle actions (called by StoreSyncAdapter)
  setRecoveryState: (state: RecoveryState) => void
  setRetryState: (state: RetryState) => void
  setError: (error: Error) => void
  startStream: (conversationId: string, messageId: string) => void

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
  loadConversationHistory: (appId: string) => Promise<void>
  loadMoreConversations: (appId: string) => Promise<void>
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
  developmentPlan: [],
  conversations: [],
  conversationPagination: {
    total: 0,
    loaded: 0,
    hasMore: false,
    isLoading: false
  },
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

  // === CORE STREAMING ACTIONS ===

  startNewStream: (userMessage: string) => {
    const userMsgId = generateId()
    const assistantMsgId = generateId()

    if (process.env.NODE_ENV === 'development') {
      logger.debug('streaming-store.start-stream', { userMessage, userMsgId, assistantMsgId })
    }

    // Add user message to completed messages
    const userChatMessage: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: userMessage,
      timestamp: new Date()
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

    const segment: StreamSegment = {
      id: generateId(),
      type: 'tool_start',
      content: `Starting ${toolCall.name}...`,
      timestamp: new Date(),
      toolCall
    }

    const updatedStream = {
      ...activeStream,
      segments: [...activeStream.segments, segment],
      toolCalls: [...activeStream.toolCalls, toolCall]
    }

    set({ activeStream: updatedStream })
  },

  addToolCallSegment: (toolCall: ToolCall) => {
    const { activeStream } = get()
    if (!activeStream) return

    // Find and update the existing tool_start segment with the input
    const updatedSegments = activeStream.segments.map(segment => {
      if (segment.type === 'tool_start' && segment.toolCall?.id === toolCall.id) {
        return {
          ...segment,
          toolCall: {
            ...segment.toolCall,
            input: toolCall.input
          }
        }
      }
      return segment
    })

    // Also update the toolCall in the toolCalls array with the input
    const updatedToolCalls = activeStream.toolCalls.map(tc =>
      tc.id === toolCall.id ? { ...tc, input: toolCall.input } : tc
    )

    const updatedStream = {
      ...activeStream,
      segments: updatedSegments,
      toolCalls: updatedToolCalls
    }

    set({ activeStream: updatedStream })
  },

  addToolResultSegment: (toolCall: ToolCall) => {
    const { activeStream } = get()
    if (!activeStream) return

    logger.debug('streaming-store.tool.result', {
      toolId: toolCall.id,
      toolName: toolCall.name,
      status: toolCall.status,
      duration: toolCall.duration
    })

    const segment: StreamSegment = {
      id: generateId(),
      type: 'tool_result',
      content: typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result),
      timestamp: new Date(),
      toolCall
    }

    const updatedStream = {
      ...activeStream,
      segments: [...activeStream.segments, segment],
      toolCalls: activeStream.toolCalls.map(tc =>
        tc.id === toolCall.id ? toolCall : tc
      )
    }

    set({ activeStream: updatedStream })
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
    const { activeStream } = get()
    if (!activeStream) {
      logger.error('streaming-store.mark-upstream-error.no-active-stream', {
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
    const { activeStream, messages } = get()
    if (!activeStream) return

    logger.debug('streaming-store.stream.finalize', {
      messageId: activeStream.id,
      contentLength: activeStream.content.length,
      toolCallCount: activeStream.toolCalls.length,
      segmentCount: activeStream.segments.length,
      maxStepsReached: activeStream.maxStepsReached,
      upstreamError: activeStream.upstreamError,
      budgetExceeded: activeStream.budgetExceeded
    })

    // Convert streaming message to completed message
    const completedMessage: ChatMessage = {
      id: activeStream.id,
      role: activeStream.role,
      content: activeStream.content,
      segments: activeStream.segments,
      toolCalls: activeStream.toolCalls,
      timestamp: new Date(), // Update timestamp to completion time
      maxStepsReached: activeStream.maxStepsReached,
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

    set({
      messages: [...messages, completedMessage],
      activeStream: null,
      streamingState: 'idle',
      isLoading: false
    })
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
    const currentState = get()

    // If switching to a different app, save current chat and load new app's chat
    if (currentState.currentAppId !== appId) {
      const newAppChatHistory = { ...currentState.appChatHistory }

      // Save current app's chat history if we have one
      if (currentState.currentAppId && currentState.messages.length > 0) {
        newAppChatHistory[currentState.currentAppId] = currentState.messages
      }

      // Load new app's chat history (or empty array if new app)
      const newAppMessages = appId ? (newAppChatHistory[appId] || []) : []

      // Clear escalation timeout before resetting retry state when switching apps
      if (currentState.connectionRetry.escalationTimeoutId) {
        clearTimeout(currentState.connectionRetry.escalationTimeoutId)
      }

      set({
        currentAppId: appId,
        messages: newAppMessages,
        activeStream: null,
        streamingState: 'idle',
        currentStep: 0,
        inputValue: '',
        // Don't reset isLoading - let loadConversationHistory manage it
        aiEditContext: null,
        buildErrorContext: null,
        conversations: [],
        conversationPagination: {
          total: 0,
          loaded: 0,
          hasMore: false,
          isLoading: false
        },
        appChatHistory: newAppChatHistory,
        websocket: { connected: false, status: 'idle' },
        connectionRetry: {
          isRetrying: false,
          retryStartedAt: null,
          wasStreamingOnDisconnect: false,
          disconnectSocketId: null,
          escalationTimeoutId: null
        }
      })
    } else {
      // Same app, just update the ID
      set({ currentAppId: appId })
    }
  },
  setInputValue: (value) => set({ inputValue: value }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setAiEditContext: (context) => set({ aiEditContext: context }),
  setBuildErrorContext: (context) => set({ buildErrorContext: context }),
  setDevelopmentPlan: (plan) => set({ developmentPlan: plan }),
  setConversations: (conversations) => set({ conversations }),

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

  startStream: (conversationId, messageId) => {
    set({
      streamingState: 'streaming',
      currentStep: 1,
      isLoading: true,
      // Note: Conversation/message management is handled by StreamingWebSocketController
      // This action is called by StoreSyncAdapter to sync machine state to store
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
    const currentState = get()

    // Clear escalation timeout if active
    if (currentState.connectionRetry.escalationTimeoutId) {
      clearTimeout(currentState.connectionRetry.escalationTimeoutId)
    }

    logger.info('streaming-store.connection-retry.clear', {
      wasRetrying: currentState.connectionRetry.isRetrying,
      elapsedMs: currentState.connectionRetry.retryStartedAt
        ? Date.now() - currentState.connectionRetry.retryStartedAt
        : null
    })

    // Restore streamingState: 'streaming' if stream still active, else 'idle'
    const restoredStreamingState = currentState.activeStream ? 'streaming' : 'idle'

    set({
      connectionRetry: {
        isRetrying: false,
        retryStartedAt: null,
        wasStreamingOnDisconnect: false,
        disconnectSocketId: null,
        escalationTimeoutId: null
      },
      streamingState: restoredStreamingState
    })
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
      conversations: [],
      conversationPagination: {
        total: 0,
        loaded: 0,
        hasMore: false,
        isLoading: false
      },
      appChatHistory: {},
      websocket: { connected: false, status: 'idle' },
      connectionRetry: {
        isRetrying: false,
        retryStartedAt: null,
        wasStreamingOnDisconnect: false,
        disconnectSocketId: null,
        escalationTimeoutId: null
      }
    })
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

  // Load conversation history from backend
  loadConversationHistory: async (appId: string) => {
    const state = get()

    // Don't load if already loading
    if (state.isLoading) return

    // Don't load if we already have messages for this app in cache AND they're not just empty
    const cachedMessages = state.appChatHistory[appId]
    if (state.currentAppId === appId && cachedMessages && cachedMessages.length > 0) return

    try {
      set({ isLoading: true })

      // Add timeout protection
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Conversation history request timeout')), 10000)
      })

      // Import buildDynamicAgentUrl dynamically to avoid circular imports
      const { buildDynamicAgentUrl } = await import('../config/dynamic-api')

      // Build dynamic agent URL for conversations endpoint (no /apps/{appId}/ prefix)
      const conversationsUrl = await buildDynamicAgentUrl(`agent/conversations/${appId}?limit=1&offset=0`, appId)

      // Import agentFetch dynamically to avoid circular imports
      const { agentFetch } = await import('../lib/agent-fetch')

      // Fetch conversations for this app with timeout protection
      const response = await Promise.race([
        agentFetch(conversationsUrl, { siteId: appId }),
        timeoutPromise
      ]) as Response
      if (!response.ok) {
        throw new Error(`Failed to fetch conversations: ${response.status}`)
      }

      const data = await response.json()
      const conversations = data.conversations || []

      if (conversations.length === 0) {
        set({
          isLoading: false,
          conversationPagination: {
            total: data.pagination?.total || 0,
            loaded: 0,
            hasMore: false,
            isLoading: false
          },
          // Ensure we cache empty results to prevent repeated attempts
          appChatHistory: { ...get().appChatHistory, [appId]: [] }
        })
        return
      }

      // Get the most recent conversation (conversations are ordered by updated_at DESC)
      const latestConversation = conversations[0]

      // Build dynamic agent URL for messages endpoint (no /apps/{appId}/ prefix)
      const messagesUrl = await buildDynamicAgentUrl(`agent/conversations/${appId}/${latestConversation.id}`, appId)

      // Fetch messages for the latest conversation
      const messagesResponse = await agentFetch(messagesUrl, { siteId: appId })
      if (!messagesResponse.ok) {
        throw new Error(`Failed to fetch messages: ${messagesResponse.status}`)
      }

      const conversationData = await messagesResponse.json()
      const messages = conversationData.messages || []

      // Convert backend messages to frontend format (no normalization needed - backend uses correct field names)
      const convertedMessages = normalizeConversationMessages(messages)

      // Convert conversation dates from strings to Date objects
      const convertedConversations: Conversation[] = conversations.map((conv: any) => ({
        ...conv,
        createdAt: new Date(conv.createdAt),
        updatedAt: new Date(conv.updatedAt)
      }))

      // Update the store with loaded messages and cache them
      set((state) => {
        // Update both the current messages and the app cache
        const newAppChatHistory = { ...state.appChatHistory }
        newAppChatHistory[appId] = convertedMessages

        return {
          messages: convertedMessages,
          conversations: convertedConversations,
          conversationPagination: {
            total: data.pagination?.total || 0,
            loaded: convertedConversations.length,
            hasMore: data.pagination?.hasMore || false,
            isLoading: false
          },
          appChatHistory: newAppChatHistory,
          isLoading: false
        }
      })

      logger.debug('streaming-store.load-history.success', {
        appId,
        conversationCount: convertedConversations.length,
        messageCount: convertedMessages.length
      })

    } catch (error) {
      logger.error('streaming-store.load-history.failure', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      })
      set({
        isLoading: false,
        conversationPagination: {
          total: 0,
          loaded: 0,
          hasMore: false,
          isLoading: false
        },
        // Cache empty result to prevent repeated failed attempts
        appChatHistory: { ...get().appChatHistory, [appId]: [] }
      })

      // Don't throw - just log and continue with empty history
      logger.warn('streaming-store.load-history.continue-empty', { appId })
    }
  },

  // Load more conversations from previous history
  loadMoreConversations: async (appId: string) => {
    const state = get()

    // Don't load if already loading or no more to load
    if (state.conversationPagination.isLoading || !state.conversationPagination.hasMore) return

    try {
      set((state) => ({
        conversationPagination: {
          ...state.conversationPagination,
          isLoading: true
        }
      }))

      // Import buildDynamicAgentUrl dynamically to avoid circular imports
      const { buildDynamicAgentUrl } = await import('../config/dynamic-api')

      const offset = state.conversationPagination.loaded
      const limit = 5 // Load 5 more conversations at a time

      // Import agentFetch dynamically to avoid circular imports
      const { agentFetch } = await import('../lib/agent-fetch')

      // Fetch older conversations
      const conversationsUrl = await buildDynamicAgentUrl(`agent/conversations/${appId}?limit=${limit}&offset=${offset}`, appId)

      const response = await agentFetch(conversationsUrl, { siteId: appId })
      if (!response.ok) {
        throw new Error(`Failed to fetch more conversations: ${response.status}`)
      }

      const data = await response.json()
      const newConversations = data.conversations || []

      if (newConversations.length === 0) {
        set((state) => ({
          conversationPagination: {
            ...state.conversationPagination,
            hasMore: false,
            isLoading: false
          }
        }))
        return
      }

      // Convert conversations
      const convertedNewConversations = newConversations.map((conv: any) => ({
        ...conv,
        createdAt: new Date(conv.createdAt),
        updatedAt: new Date(conv.updatedAt)
      }))

      // Load messages for all new conversations
      const conversationIds = newConversations.map((conv: any) => conv.id).join(',')
      const messagesUrl = await buildDynamicAgentUrl(`agent/conversations/${appId}/messages?conversationIds=${conversationIds}`, appId)

      const messagesResponse = await agentFetch(messagesUrl, { siteId: appId })
      if (!messagesResponse.ok) {
        throw new Error(`Failed to fetch conversation messages: ${messagesResponse.status}`)
      }

      const messagesData = await messagesResponse.json()
      const newMessages = messagesData.messages || []

      // Convert backend messages to frontend format
      const convertedNewMessages = normalizeConversationMessages(newMessages)

      // Update store with new conversations and messages
      set((state) => {
        const combinedMessages = [...convertedNewMessages, ...state.messages].sort(
          (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
        )

        const newAppChatHistory = { ...state.appChatHistory }
        newAppChatHistory[appId] = combinedMessages

        return {
          messages: combinedMessages,
          conversations: [...state.conversations, ...convertedNewConversations],
          conversationPagination: {
            total: data.pagination?.total || state.conversationPagination.total,
            loaded: state.conversationPagination.loaded + convertedNewConversations.length,
            hasMore: data.pagination?.hasMore || false,
            isLoading: false
          },
          appChatHistory: newAppChatHistory
        }
      })

    } catch (error) {
      logger.error('streaming-store.load-more.failure', { error: error instanceof Error ? error.message : String(error) })
      set((state) => ({
        conversationPagination: {
          ...state.conversationPagination,
          isLoading: false
        }
      }))
    }
  }
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
export const useFinalizeStream = () => useStreamingConversationStore(state => state.finalizeStream)
export const useAutoSendInitialMessage = () => useStreamingConversationStore(state => state.autoSendInitialMessage)
export const useLoadConversationHistory = () => useStreamingConversationStore(state => state.loadConversationHistory)
export const useLoadMoreConversations = () => useStreamingConversationStore(state => state.loadMoreConversations)
export const useConversationPagination = () => useStreamingConversationStore(state => state.conversationPagination)

export const useSetCurrentAppId = () => useStreamingConversationStore(state => state.setCurrentAppId)
export const useSetInputValue = () => useStreamingConversationStore(state => state.setInputValue)
export const useSetIsLoading = () => useStreamingConversationStore(state => state.setIsLoading)
export const useSetAiEditContext = () => useStreamingConversationStore(state => state.setAiEditContext)
export const useSetBuildErrorContext = () => useStreamingConversationStore(state => state.setBuildErrorContext)
export const useSetDevelopmentPlan = () => useStreamingConversationStore(state => state.setDevelopmentPlan)
export const useSetConversations = () => useStreamingConversationStore(state => state.setConversations)

export const useSetWebSocketState = () => useStreamingConversationStore(state => state.setWebSocketState)
export const useSetStreamingState = () => useStreamingConversationStore(state => state.setStreamingState)

// Connection retry selectors
export const useConnectionRetry = () => useStreamingConversationStore(state => state.connectionRetry)
export const useStartConnectionRetry = () => useStreamingConversationStore(state => state.startConnectionRetry)
export const useSetEscalationTimeout = () => useStreamingConversationStore(state => state.setEscalationTimeout)
export const useClearConnectionRetry = () => useStreamingConversationStore(state => state.clearConnectionRetry)
export const useCheckStaleRetry = () => useStreamingConversationStore(state => state.checkStaleRetry)

export const useDevelopmentPlan = () => useStreamingConversationStore(state => state.developmentPlan)
export const useAiEditContext = () => useStreamingConversationStore(state => state.aiEditContext)
export const useBuildErrorContext = () => useStreamingConversationStore(state => state.buildErrorContext)
export const useConversations = () => useStreamingConversationStore(state => state.conversations)
