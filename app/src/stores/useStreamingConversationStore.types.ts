/**
 * Type definitions for the streaming-first conversation store.
 * Extracted from useStreamingConversationStore.ts; re-exported from there to
 * preserve the public import surface.
 */

import type { MessageOrigin } from '@airo/shared/auth'

import type { AiEditContext } from '@/app/[market]/develop/components/types'
import type { ValidationStatus } from '@/stores/validationToolCall'
import type { StructuredError } from '@/types/errors'

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
  usedFreeGrants?: boolean         // True if task used free grants (publish/domain/fix task budget)
  selectedAssets?: any[]           // Attached files/assets (only for user messages, kept for type compatibility)
  referencedFiles?: Array<{ path: string; content: string }> // Referenced code files (only for user messages, kept for type compatibility)
  origin?: MessageOrigin            // Message origin for visibility filtering
  metadata?: {
    usage?: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
    }
    agentId?: string
    step?: number
    source?: string
    displayAs?: string
    validationStatus?: ValidationStatus
    [key: string]: unknown
  }
}

export interface AppChatHistoryEntry {
  messages: ChatMessage[]
  activeStream: StreamingMessage | null
  resolvedSecretsComposerToolCallIds: Record<string, true>
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
  usedFreeGrants?: boolean         // True if task used free grants (publish/domain/fix task budget)
  selectedAssets?: any[]           // Attached files/assets for user messages
  referencedFiles?: Array<{ path: string; content: string }> // Referenced code files for user messages
  uploadedFileName?: string        // Name of file uploaded via HTTP to the agent
  origin?: MessageOrigin            // Message origin for visibility filtering
  commitHash?: string               // Git commit hash produced by this message (for undo)
  metadata?: {
    usage?: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
    }
    agentId?: string
    totalSteps?: number
    source?: string
    displayAs?: string
    validationStatus?: ValidationStatus
    pinnedSkill?: string             // Server-pushed: name of the conversation's pinned orchestrator skill (e.g. 'deep-build'). Drives mode-specific UI like the build overlay copy.
    feedback?: 'positive' | 'negative' | null // Per-message thumbs feedback persisted on the agent message
    [key: string]: unknown
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
  // Multi-element selection (flag: appbuilder-multi-element-select)
  aiEditContexts: AiEditContext[]
  buildErrorContext: { error: string; details: string; exitCode?: number } | null
  availableAgents: AgentSummary[]
  defaultAgentId: string | null
  currentAgentName: string | null
  developmentPlan: PlanItem[]

  // Per-app chat cache: messages, active streams, and resolved secrets composer tool calls
  appChatHistory: Record<string, AppChatHistoryEntry>

  // WebSocket state
  websocket: WebSocketState

  // Connection retry state - survives component remounts
  connectionRetry: ConnectionRetryState

  // State machine lifecycle state (synced by StoreSyncAdapter)
  recoveryState: RecoveryState
  retryState: RetryState
  lastError: Error | null

  // History loading state (for WebSocket history streaming)
  historyLoadRequested: boolean
  historyLoadingComplete: boolean

  // History pagination state
  historyHasMore: boolean
  historyNextCursor: string | null
  historyLoadingMore: boolean

  // Server capabilities (for backwards compatibility)
  serverCapabilities: ServerCapabilities | null

  /** requestSecrets toolCallIds dismissed or saved in the secrets composer (mirrored per app in appChatHistory) */
  resolvedSecretsComposerToolCallIds: Record<string, true>

  // Subagent events keyed by tool ID
  subagentEvents: Record<string, Array<{ event: string; agent: string; detail: string }>>

  // === CORE STREAMING ACTIONS ===

  addSubagentEvent: (toolId: string, event: { event: string; agent: string; detail: string }) => void
  clearSubagentEvents: () => void

  // Stream lifecycle
  startNewStream: (
    userMessage: string,
    selectedAssets?: any[],
    referencedFiles?: Array<{ path: string; content: string }>,
    origin?: MessageOrigin,
    uploadedFileName?: string,
    userMessageMetadata?: ChatMessage['metadata'],
  ) => void
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
  clearStreamForRetry: () => void

  // === APP CONTEXT ACTIONS ===

  setCurrentAppId: (appId: string | null) => void
  setInputValue: (value: string) => void
  setIsLoading: (loading: boolean) => void
  setAiEditContext: (context: AiEditContext | null) => void
  // Multi-element selection actions (flag: appbuilder-multi-element-select)
  addAiEditContext: (context: AiEditContext) => number
  removeAiEditContext: (number: number) => void
  clearAiEditContexts: () => void
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
  setHistoryLoadRequested: (requested: boolean) => void
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
  mergeMessageMetadata: (messageId: string, metadataUpdates: Record<string, unknown>) => void
  clearMessages: () => void
  cleanup: () => void
  resolveSecretsComposerToolCall: (toolCallId: string) => void
  cancelSecretsComposerToolCall: (toolCallId: string, allSecretNames: string[]) => void

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
