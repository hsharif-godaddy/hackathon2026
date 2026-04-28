/**
 * Clean interfaces for WebSocket server message and context management
 * These interfaces allow for flexible, testable, and generic message injection
 */

import type { ModelMessage } from 'ai'

/**
 * Error types that are non-terminal — the agent retries and the stream continues.
 * Used by ConversationEventChannel to skip clearing pendingMessageIds.
 */
export const TOOL_VALIDATION_ERROR_TYPE = 'TOOL_VALIDATION_ERROR' as const
export const NON_TERMINAL_ERROR_TYPES = [TOOL_VALIDATION_ERROR_TYPE] as const

/**
 * Tool call structure for assistant messages
 */
export interface ToolCall {
  id: string
  type: string
  function: {
    name: string
    arguments: string
  }
}

/**
 * Represents a message that can be injected into the conversation stream
 * Uses AI SDK v6 ModelMessage format with optional extensions
 */
export type ConversationMessage = ModelMessage & {
  /** Optional cache point for cost optimization */
  cachePoint?: { type: 'ephemeral' }
  /** Tool calls made by assistant (for role='assistant', OpenAI format) - legacy support */
  tool_calls?: ToolCall[]
}

/**
 * Provider for loading conversation history messages
 * Implementations should load previous messages from the conversation
 */
export interface MessageProvider {
  /**
   * Load conversation messages to inject into the stream
   * @param conversationId - The conversation ID to load messages for
   * @param context - Additional context that might be needed
   * @returns Array of conversation messages in chronological order
   */
  loadMessages(
    conversationId: string,
    context: Record<string, unknown>
  ): Promise<ConversationMessage[]>
}

/**
 * Persisted message format for UI display (raw database rows)
 * Different from ConversationMessage which is AI SDK format for LLM
 * Database schema stores sender as 'user' or 'agent'; HistoryProvider normalizes 'agent' to 'assistant'
 * before mapping records into this interface.
 */
export interface PersistedMessage {
  id: string
  conversationId: string
  sender: 'user' | 'assistant'  // Value already normalized by HistoryProvider from DB's 'agent' → 'assistant'
  content: string
  messageType?: string
  toolCalls?: any[]
  segments?: any[]
  metadata?: Record<string, unknown>
  contextAttachments?: any[]
  origin?: 'support' | 'customer'
  createdAt: string
}

/**
 * Pagination options for loading history
 */
export interface HistoryPaginationOptions {
  /** Message ID cursor - fetch messages older than this */
  before?: string
  /** Max messages to return (default 20, max 100) */
  limit?: number
}

/**
 * Paginated history result
 */
export interface PaginatedHistoryResult {
  messages: PersistedMessage[]
  hasMore: boolean
  nextCursor: string | null
  total?: number
}

/**
 * Provider for loading raw conversation history for UI display
 * Separate from MessageProvider which returns summarized LLM context
 */
export interface HistoryProvider {
  /**
   * Load raw conversation messages for UI display
   * Returns complete database rows without summarization or truncation
   * @param conversationId - The conversation ID
   * @param appId - The app ID (required for repository lookup)
   * @param options - Pagination options (optional for backwards compatibility)
   * @returns Paginated result with messages and cursor, or legacy array
   */
  loadHistory(
    conversationId: string,
    appId: string,
    options?: HistoryPaginationOptions
  ): Promise<PaginatedHistoryResult | PersistedMessage[]>
}

/**
 * Data structure for recovery_status WebSocket message
 */
export interface RecoveryStatusData {
  isRecovering: boolean
  hasBufferedEvents: boolean
  bufferedEventCount: number
  streamCompleted?: boolean
  conversationId?: string
  agentName?: string
  recoveryMode?: string
  requiresAck?: boolean
  lastSequence?: number
  lossDetected?: boolean
  lostEventCount?: number
  eventsReplayed?: number

  // History streaming
  historyStreaming?: boolean
  historyMessageCount?: number
}

/**
 * Data structure for server_config WebSocket message
 * Sent immediately after connection (before authentication) so the client has
 * timeout values and capability flags available when it sends the authenticate event.
 */
export interface ServerConfigData {
  /** Stream recovery window timeout in milliseconds */
  streamRecoveryWindow: number
  /** Acknowledgement timeout in milliseconds */
  ackTimeout: number
  /** Whether server supports WebSocket-based conversation history loading (for backwards compatibility) */
  supportsWebSocketHistory?: boolean
  /** Server version for capability negotiation */
  serverVersion?: string
}

/**
 * Represents a context message with insertion ordering
 * Context messages use restricted roles (no 'tool' role as tools are part of conversation history)
 */
export interface ContextMessage {
  /** Message role - restricted for context messages */
  role: 'user' | 'system'
  /** Message content */
  content: string
  /** Optional cache point for cost optimization */
  cachePoint?: { type: 'ephemeral' }
  /** When to insert this message relative to conversation history */
  insertionOrder: 'before_history' | 'after_history'
}

/**
 * Provider for loading arbitrary context messages
 * Implementations can inject app context, templates, system prompts, etc.
 */
export interface ContextProvider {
  /**
   * Load context messages that should be injected into the conversation
   * @param context - Context data that might influence what messages to load
   * @returns Array of context messages with insertion ordering
   */
  loadContextMessages(context: Record<string, unknown>): Promise<ContextMessage[]>
}

/**
 * Event captured during streaming for persistence
 */
export interface PersistenceStreamingEvent {
  type: string
  content?: string | undefined
  data?: any
  timestamp: Date
}

/**
 * Context for conversation persistence operations
 */
export interface ConversationContext {
  /** Transport-neutral connection identifier. Optional during migration from socketId. */
  connectionId?: string
  /** @deprecated Use connectionId. Retained for backward compat with ai-lib/ai-grants consumers. */
  socketId: string
  agentName: string
  appId?: string
  userId?: string
  sessionId?: string
  bmsBudgetId?: string
  budgetSessionId?: string
  /** Whether this task was completed for free (assessment-based, legacy mode only) */
  usedFreeGrants?: boolean
  [key: string]: any
}

/**
 * Provider for conversation persistence and recording
 */
export interface ConversationPersistence {
  /**
   * Start a new conversation
   * @param message - Initial user message
   * @param context - Conversation context
   * @returns Promise resolving to conversation ID
   */
  startConversation(message: string, context: ConversationContext): Promise<string>

  /**
   * Continue an existing conversation (optional method)
   * @param conversationId - The conversation ID
   * @param message - New user message
   * @param context - Conversation context
   */
  continueConversation?(
    conversationId: string, 
    message: string, 
    context: ConversationContext
  ): Promise<string | undefined>

  /**
   * Start an agent response turn (creates placeholder message)
   * @param conversationId - The conversation ID
   * @param context - Conversation context
   * @returns Promise resolving to message ID for tracking updates
   */
  startAgentTurn?(
    conversationId: string,
    context: ConversationContext
  ): Promise<string>

  /**
   * Update an in-progress agent message with new content/tools
   * @param conversationId - The conversation ID
   * @param messageId - The message ID to update
   * @param updates - Incremental updates to apply
   * @param updates.content - Additional content to append
   * @param updates.segments - Message segments to add/update
   * @param updates.toolCalls - Tool calls to add/update
   * @param context - Conversation context
   */
  updateAgentTurn?(
    conversationId: string,
    messageId: string,
    updates: {
      content?: string
      segments?: any[]
      toolCalls?: any[]
    },
    context: ConversationContext
  ): Promise<void>

  /**
   * Complete a conversation with final results
   * @param conversationId - The conversation ID
   * @param events - Streaming events captured during the conversation
   * @param result - Final conversation result
   * @param context - Conversation context
   */
  completeConversation(
    conversationId: string,
    events: PersistenceStreamingEvent[],
    result: any,
    context: ConversationContext
  ): Promise<void>

  /**
   * Handle conversation error
   * @param conversationId - The conversation ID
   * @param error - Error that occurred
   * @param message - User message that caused the error
   * @param context - Conversation context
   */
  handleConversationError(
    conversationId: string,
    error: Error,
    message: string,
    context: ConversationContext
  ): Promise<void>

  /**
   * Capture a streaming event for persistence
   * @param conversationId - The conversation ID
   * @param event - Streaming event to capture
   * @param context - Conversation context
   */
  captureStreamingEvent(
    conversationId: string,
    event: PersistenceStreamingEvent,
    context: ConversationContext
  ): Promise<void>
}

/**
 * Optional persistence extension for handling disconnections
 */
export interface ConversationPersistenceWithCleanup extends ConversationPersistence {
  /**
   * Handle client disconnection cleanup
   * @param socketId - The socket ID that disconnected
   * @param conversationIds - Array of conversation IDs to clean up
   */
  handleDisconnection(socketId: string, conversationIds: string[]): Promise<void>
}

/**
 * Event types for streaming events
 */
export type StreamingEventType =
  | 'chunk'
  | 'tool_start'
  | 'tool_input_delta'
  | 'tool_call'
  | 'tool_result'
  | 'step_start'
  | 'step_complete'
  | 'complete'
  | 'error'
  | 'validation_message'
  | 'recovery_status'
  | 'conversation_info'
  | 'agents_available'
  | 'replay_complete'
  | 'catchup_status'
  | 'catchup_complete'
  | 'server_config'
  | 'client_action'
  | 'budget_update'
  | 'video'
  | 'request_grant_refresh'

/**
 * Normalized streaming event structure for event channel
 * All events flow through the event channel with this schema
 */
export interface StreamingEvent {
  /** Unique event ID */
  id: string

  /** Conversation this event belongs to */
  conversationId: string

  /** Monotonically increasing sequence number for ordering */
  sequence: number

  /** Event type classification */
  type: StreamingEventType

  /** Text content (for chunks, descriptions) */
  content: string

  /** Structured data (tool info, usage, etc.) */
  data: Record<string, unknown>

  /** Event creation timestamp */
  timestamp: Date

  /** Agent that generated this event */
  agentName: string

  /** Optional step number for multi-step reasoning */
  step?: number

  /** Subscriber IDs that have received this event */
  deliveredTo?: Set<string>

  /** Whether event has been persisted to database */
  persisted?: boolean
}

/**
 * Metadata about a conversation's event buffer
 * Used for replay and diagnostics
 */
export interface EventMetadata {
  /** Conversation ID */
  conversationId: string

  /** Sequence number of first event in buffer */
  firstSequence: number

  /** Sequence number of last event in buffer */
  lastSequence: number

  /** Total number of events in buffer */
  totalEvents: number

  /** Timestamp of oldest event */
  oldestTimestamp: Date

  /** Timestamp of newest event */
  newestTimestamp: Date

  /** NEW: Track which messages are actively streaming (incomplete) */
  pendingMessageIds: string[]
}

/**
 * Returns a coalesce key for a message, or null if non-coalesceable.
 * This is the single source of truth for which event types can be coalesced.
 * Events with the same key can be merged.
 *
 * Coalesceable types:
 * - chunk: content string concatenation (key: "chunk")
 * - tool_input_delta: data.delta concatenation, keyed by toolId so
 *   deltas for different tool calls don't merge (key: "tid:{toolId}")
 */
export function getCoalesceKey(type: string, data: Record<string, unknown>): string | null {
  if (type === 'chunk') return 'chunk'
  if (type === 'tool_input_delta') return `tid:${data.toolId}`
  return null
}

/**
 * Merge data for a coalesced event into the pending event's data.
 * For tool_input_delta, concatenates data.delta. For all others, replaces data.
 */
export function mergeCoalescedData(
  type: string,
  pendingData: Record<string, unknown>,
  incomingData: Record<string, unknown>
): Record<string, unknown> {
  if (type === 'tool_input_delta') {
    const prevDelta = (pendingData.delta as string) ?? ''
    const newDelta = (incomingData.delta as string) ?? ''
    return { ...incomingData, delta: prevDelta + newDelta }
  }
  return incomingData
}

/**
 * Configuration for circular buffer
 */
export interface CircularBufferConfig {
  /** Maximum number of events to buffer */
  capacity: number

  /** Time-to-live for events in milliseconds */
  ttl: number
}

/**
 * Event subscriber interface for receiving streaming events
 * Subscribers register with the event channel to receive events
 */
export interface EventSubscriber {
  /** Unique subscriber ID */
  id: string

  /**
   * Handle a streaming event
   * @param event - The streaming event to process
   * @throws Error to signal subscriber failure (triggers fail-fast for blocking subscribers)
   */
  onEvent(event: StreamingEvent): Promise<void>

  /**
   * Handle an error that occurred during event processing
   * @param error - The error that occurred
   */
  onError(error: Error): void

  /**
   * Optional filter to selectively receive events
   * @param event - The event to filter
   * @returns true to receive this event, false to skip
   */
  filter?(event: StreamingEvent): boolean

  /**
   * If true, publish() awaits this subscriber and propagates errors (fail-fast).
   * If false, subscriber runs fire-and-forget with errors captured via onError().
   * Default: true (for backward compatibility with existing subclasses)
   */
  blocking?: boolean
}