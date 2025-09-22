/**
 * MessagePersistence implementation for the agents server
 * 
 * This class implements the ai-lib MessagePersistence interface to handle
 * conversation and streaming event persistence using the existing ConversationBridge.
 */

import type { 
  MessagePersistence, 
  MessagePersistenceWithCleanup, 
  PersistenceStreamingEvent, 
  MessagePersistenceContext, 
  ConversationResult 
} from '@airo/ai-lib'
import { ConversationBridge } from '../agents/ai-lib-agents/conversation-bridge.js'
import type { EnhancedAgentContext } from '../agents/ai-lib-agents/types.js'
import { AppRepository } from '../database/repositories/AppRepository.js'
import { MAX_PROMPT_LENGTH } from '../services/features.js'

export class AgentsMessagePersistence implements MessagePersistenceWithCleanup {
  private conversationBridge: ConversationBridge
  private appRepository: AppRepository
  
  // Track conversations for cleanup
  private activeConversations = new Map<string, {
    conversationId: string
    userMessageId: string
    context: MessagePersistenceContext
  }>()

  constructor() {
    this.conversationBridge = new ConversationBridge()
    this.appRepository = new AppRepository()
  }

  async startConversation(
    message: string,
    context: MessagePersistenceContext
  ): Promise<string> {
    console.log('💾 Starting conversation persistence:', {
      socketId: context.socketId,
      agentName: context.agentName,
      appId: context.appId
    })

    // Validate appId
    if (!context.appId) {
      throw new Error('appId is required in context')
    }
    
    if (message && message.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Message exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`)
    }

    // Validate that the app exists
    const app = this.appRepository.findById(context.appId)
    if (!app) {
      throw new Error(`App with ID '${context.appId}' not found`)
    }

    // Create enhanced context for ConversationBridge
    const enhancedContext: EnhancedAgentContext = {
      metadata: {
        appId: context.appId,
        agentId: context.agentName,
        userId: context.userId,
        sessionId: context.sessionId
      }
      // Other properties are optional and will be added as needed
    }

    // Create or get conversation
    const conversationId = await this.conversationBridge.ensureConversation(
      context.appId,
      context.agentName,
      enhancedContext
    )

    // Update context with conversation ID
    enhancedContext.conversation = { conversationId }

    // Save user message
    const userMessageId = await this.conversationBridge.saveUserMessage(
      conversationId,
      message,
      enhancedContext
    )

    // Track for cleanup
    this.activeConversations.set(context.socketId, {
      conversationId,
      userMessageId,
      context
    })

    console.log('💾 Conversation started:', { conversationId, userMessageId })
    return conversationId
  }

  async captureStreamingEvent(
    conversationId: string,
    event: PersistenceStreamingEvent,
    context: MessagePersistenceContext
  ): Promise<void> {
    // Capture streaming events for persistence (no logging to reduce noise)
  }

  async completeConversation(
    conversationId: string,
    streamingEvents: PersistenceStreamingEvent[],
    result: ConversationResult,
    context: MessagePersistenceContext
  ): Promise<void> {

    // Convert PersistenceStreamingEvent to the format expected by ConversationBridge
    const bridgeEvents = streamingEvents.map(event => ({
      type: event.type,
      content: event.content,
      data: event.data,
      timestamp: event.timestamp
    }))

    // Save agent response with streaming events
    await this.conversationBridge.saveAgentResponse(
      conversationId,
      context.agentName,
      bridgeEvents,
      result
    )

    // Clean up tracking
    this.activeConversations.delete(context.socketId)

  }

  async handleConversationError(
    conversationId: string | undefined,
    error: Error,
    message?: string,
    context?: MessagePersistenceContext
  ): Promise<void> {
    console.error('💾 Conversation error:', {
      conversationId,
      error: error.message,
      socketId: context?.socketId
    })

    // Clean up tracking if we have context
    if (context) {
      this.activeConversations.delete(context.socketId)
    }

    // Could save error information to database here if needed
    // For now, just log the error
  }

  async handleDisconnection(
    socketId: string,
    pendingConversationIds: string[]
  ): Promise<void> {
    console.log('💾 Handling disconnection cleanup:', {
      socketId,
      pendingConversations: pendingConversationIds.length
    })

    // Clean up any tracked conversations for this socket
    this.activeConversations.delete(socketId)

    // Could mark conversations as incomplete or save partial state here
    // For now, just clean up tracking
  }
}
