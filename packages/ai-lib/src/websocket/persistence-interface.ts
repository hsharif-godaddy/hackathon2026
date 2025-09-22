/**
 * WebSocket Message Persistence Interface
 * 
 * This interface defines how the WebSocket server can persist conversations
 * and streaming events to external storage systems.
 */

export interface PersistenceStreamingEvent {
  type: string
  content?: string | undefined
  data?: any
  timestamp: Date
}

export interface MessagePersistenceContext {
  socketId: string
  agentName: string
  appId?: string
  userId?: string
  sessionId?: string
  [key: string]: unknown
}

export interface ConversationResult {
  agentName: string
  duration: string
  usage?: any
  toolCalls?: any[]
}

/**
 * Interface for persisting WebSocket conversations and streaming events
 */
export interface MessagePersistence {
  /**
   * Called when a new conversation starts
   * Should return a conversation ID that will be used for subsequent calls
   */
  startConversation(
    message: string,
    context: MessagePersistenceContext
  ): Promise<string>

  /**
   * Called to continue an existing conversation with a new message
   * Used when reusing a conversation on the same WebSocket connection
   */
  continueConversation?(
    conversationId: string,
    message: string,
    context: MessagePersistenceContext
  ): Promise<string>

  /**
   * Called for each streaming event (chunks, tool calls, etc.)
   * This allows real-time capture of streaming data
   */
  captureStreamingEvent(
    conversationId: string,
    event: PersistenceStreamingEvent,
    context: MessagePersistenceContext
  ): Promise<void>

  /**
   * Called when the conversation completes successfully
   * Receives all collected streaming events and final result
   */
  completeConversation(
    conversationId: string,
    streamingEvents: PersistenceStreamingEvent[],
    result: ConversationResult,
    context: MessagePersistenceContext
  ): Promise<void>

  /**
   * Called when an error occurs during the conversation
   */
  handleConversationError(
    conversationId: string | undefined,
    error: Error,
    message?: string,
    context?: MessagePersistenceContext
  ): Promise<void>
}

/**
 * Optional interface for persistence implementations that need cleanup
 */
export interface MessagePersistenceWithCleanup extends MessagePersistence {
  /**
   * Called when a socket disconnects
   * Allows cleanup of any pending conversations
   */
  handleDisconnection(
    socketId: string,
    pendingConversationIds: string[]
  ): Promise<void>
}
