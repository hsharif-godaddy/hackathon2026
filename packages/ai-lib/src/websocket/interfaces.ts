/**
 * Clean interfaces for WebSocket server message and context management
 * These interfaces allow for flexible, testable, and generic message injection
 */

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
 * Supports full LLM message format including tool calls
 * AI SDK uses OpenAI format internally (tool_calls) and converts to provider format
 */
export interface ConversationMessage {
  /** Message role */
  role: 'user' | 'assistant' | 'system' | 'tool'
  /** Message content - must be string (AI SDK requirement) */
  content: string
  /** Optional cache point for cost optimization */
  cachePoint?: { type: 'ephemeral' }
  /** Tool calls made by assistant (for role='assistant', OpenAI format) */
  tool_calls?: ToolCall[]
  /** Tool call ID this message responds to (for role='tool') */
  tool_call_id?: string
  /** Tool name (for role='tool') */
  name?: string
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
 * Represents a context message with insertion ordering
 * Context messages use restricted roles (no 'tool' role as tools are part of conversation history)
 */
export interface ContextMessage {
  /** Message role - restricted for context messages */
  role: 'user' | 'assistant' | 'system'
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
  socketId: string
  agentName: string
  appId?: string
  userId?: string
  sessionId?: string
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
  ): Promise<void>

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
  | 'recovery_status'

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
   * @throws Error to signal subscriber failure (triggers fail-fast)
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
}