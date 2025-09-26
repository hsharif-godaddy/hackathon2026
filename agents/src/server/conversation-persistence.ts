/**
 * MessagePersistence implementation for the agents server
 * 
 * This class implements the ai-lib MessagePersistence interface to handle
 * conversation and streaming event persistence using the existing ConversationBridge.
 */

import type { 
  ConversationPersistence, 
  ConversationPersistenceWithCleanup, 
  PersistenceStreamingEvent, 
  ConversationContext
} from '@airo/ai-lib'
import { ConversationBridge } from '../agents/ai-lib-agents/conversation-bridge.js'
import type { EnhancedAgentContext } from '../agents/ai-lib-agents/types.js'
import { AppRepository } from '../database/repositories/AppRepository.js'
import { MAX_PROMPT_LENGTH } from '../services/features.js'
import { GitTool } from '../tools/git-tool.js'
import { GitUtils } from '../utils/git.js'
import { logger } from '../logging/index.js'
import { toolGitEvents } from '../logging/events/index.js'

export class AgentsMessagePersistence implements ConversationPersistenceWithCleanup {
  private conversationBridge: ConversationBridge
  private appRepository: AppRepository
  private gitTool: GitTool
  private gitUtils: GitUtils
  
  // Track conversations for cleanup
  private activeConversations = new Map<string, {
    conversationId: string
    userMessageId: string
    context: ConversationContext
    message?: string
  }>()
  
  // Map of appIds to their most recent user message
  private appUserMessages = new Map<string, string>()

  constructor() {
    this.conversationBridge = new ConversationBridge()
    this.appRepository = new AppRepository()
    this.gitTool = new GitTool()
    this.gitUtils = new GitUtils()
  }

  async continueConversation(
    conversationId: string,
    message: string,
    context: ConversationContext
  ): Promise<void> {
    console.log('🔄 Continuing conversation persistence:', {
      conversationId,
      socketId: context.socketId,
      agentName: context.agentName,
      appId: context.appId
    })

    // Save user message to existing conversation
    const userMessageId = await this.conversationBridge.saveUserMessage(
      conversationId,
      message,
      context as any // Cast to EnhancedAgentContext
    )

    // Track for cleanup and store message
    this.activeConversations.set(context.socketId, {
      conversationId,
      userMessageId,
      context,
      message
    })
    
    if (context.appId) {
      this.appUserMessages.set(context.appId, message)
    }

    console.log('💾 Conversation continued:', { conversationId, userMessageId })
  }

  async startConversation(
    message: string,
    context: ConversationContext
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
        ...(context.userId && { userId: context.userId }),
        ...(context.sessionId && { sessionId: context.sessionId })
      }
      // Other properties are optional and will be added as needed
    }

    // Copy conversation context if provided (this is crucial for conversation history!)
    if (context.conversation) {
      enhancedContext.conversation = context.conversation
    }

    // Debug logging for conversation context
    if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
      console.log('🔍 ConversationPersistence: Original context.conversation:', context.conversation)
      console.log('🔍 ConversationPersistence: Enhanced context.conversation:', enhancedContext.conversation)
    }

    // Debug logging for conversation context
    if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
      console.log('🔍 ConversationPersistence.startConversation: conversation context:', {
        originalConversation: context.conversation,
        enhancedConversation: enhancedContext.conversation,
        hasConversationId: !!(enhancedContext.conversation?.conversationId)
      })
    }

    // Create or get conversation
    const conversationId = await this.conversationBridge.ensureConversation(
      context.appId,
      context.agentName,
      enhancedContext
    )

    // Debug logging for conversation ID result
    if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
      console.log('🔍 ConversationPersistence: ensureConversation returned:', conversationId)
    }

    // Update context with conversation ID
    enhancedContext.conversation = { conversationId }

    // Save user message
    const userMessageId = await this.conversationBridge.saveUserMessage(
      conversationId,
      message,
      enhancedContext
    )

    // Track for cleanup and store message
    this.activeConversations.set(context.socketId, {
      conversationId,
      userMessageId,
      context,
      message
    })
    
    if (context.appId) {
      this.appUserMessages.set(context.appId, message)
    }

    console.log('💾 Conversation started:', { conversationId, userMessageId })
    return conversationId
  }

  async captureStreamingEvent(
    conversationId: string,
    event: PersistenceStreamingEvent,
    context: ConversationContext
  ): Promise<void> {
    // Capture streaming events for persistence (no logging to reduce noise)
  }

  async completeConversation(
    conversationId: string,
    streamingEvents: PersistenceStreamingEvent[],
    result: any,
    context: ConversationContext
  ): Promise<void> {

    // Convert PersistenceStreamingEvent to the format expected by ConversationBridge
    const bridgeEvents = streamingEvents.map(event => ({
      type: event.type,
      ...(event.content !== undefined && { content: event.content }),
      ...(event.data !== undefined && { data: event.data }),
      ...(event.timestamp !== undefined && { timestamp: event.timestamp })
    }))

    // Save agent response with streaming events
    await this.conversationBridge.saveAgentResponse(
      conversationId,
      context.agentName,
      bridgeEvents,
      result
    )
    
    // Check for uncommitted changes before cleaning up
    // This ensures we don't lose any changes made during the conversation
    if (context.appId) {
      await this.checkAndCommitChanges(context.appId, 'conversation_complete');
    }

    // Clean up tracking
    this.activeConversations.delete(context.socketId)
  }

  async handleConversationError(
    conversationId: string | undefined,
    error: Error,
    message?: string,
    context?: ConversationContext
  ): Promise<void> {
    logger.error('websocket.conversation.error', {
      conversationId,
      error: error.message,
      socketId: context?.socketId
    })

    // Check for uncommitted changes if we have app context
    if (context && context.appId) {
      await this.checkAndCommitChanges(context.appId, 'conversation_error');
    }

    // Clean up tracking if we have context
    if (context) {
      this.activeConversations.delete(context.socketId)
    }
  }

  async handleDisconnection(
    socketId: string,
    pendingConversationIds: string[]
  ): Promise<void> {
    logger.info('websocket.disconnection.cleanup', {
      socketId,
      pendingConversations: pendingConversationIds.length
    })

    // Get the tracked conversation for this socket
    const activeConversation = this.activeConversations.get(socketId);
    if (activeConversation && activeConversation.context.appId) {
      await this.checkAndCommitChanges(activeConversation.context.appId, 'websocket_disconnection');
    }
    
    // Clean up any tracked conversations for this socket
    this.activeConversations.delete(socketId)
  }
  
  /**
   * Helper method to retrieve the user message for a given appId
   */
  private getUserMessageForAppId(appId: string): string | undefined {
    return this.appUserMessages.get(appId);
  }
  
  /**
   * Check for uncommitted changes in the app repository and commit them
   * This is used as a safety net to prevent lost work when websocket disconnects or errors occur
   */
  private async checkAndCommitChanges(appId: string, reason: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      logger.info('git.auto_commit.check', {
        appId,
        reason
      })
      
      const app = await this.appRepository.findById(appId);
      if (!app) {
        logger.warn('git.auto_commit.app_not_found', {
          appId,
          reason
        })
        return;
      }
      
      const status = await this.gitTool.executeGitOperation(app.path, { operation: 'status' });
      
      if (status.success && status.status && !status.status.isClean) {
        toolGitEvents.begin(logger, {
          toolName: 'git',
          operation: 'commit',
          appPath: app.path,
          options: {
            reason,
            appId
          }
        });

        await this.gitTool.executeGitOperation(app.path, { 
          operation: 'add', 
          options: { all: true } 
        });

        let commitMessage = `Changes from conversation`;
        
        const userMessage = this.getUserMessageForAppId(appId);
        if (userMessage) {
          const truncatedMessage = userMessage.length > 50 ? 
            `${userMessage.substring(0, 47)}...` : userMessage;
          commitMessage = `${truncatedMessage} (${reason.replace('_', ' ')})`;
        } else {
          commitMessage = `Saving changes after ${reason.replace('_', ' ')}`;
        }
        
        const result = await this.gitTool.executeGitOperation(app.path, {
          operation: 'commit',
          message: commitMessage
        });

        const executionTime = Date.now() - startTime;

        if (result.success) {
          // Calculate actual number of files affected from detailed git status
          let filesAffected = 0;
          try {
            if (!status.status?.isClean) {
              const detailedStatus = await this.gitUtils.getStatus(app.path);
              filesAffected = (detailedStatus.stagedFiles || 0) + 
                             (detailedStatus.modifiedFiles || 0) + 
                             (detailedStatus.untrackedFiles || 0);
            }
          } catch (error) {
            // Fallback to simple calculation if detailed status fails
            filesAffected = status.status?.isClean ? 0 : 1;
            logger.warn('git.auto_commit.status_fallback', {
              appId,
              error: error instanceof Error ? error.message : String(error)
            });
          }

          toolGitEvents.success(logger, {
            toolName: 'git',
            operation: 'commit',
            appPath: app.path,
            resultStats: {
              success: true,
              filesAffected,
              executionTime
            }
          });
          
          logger.info('git.auto_commit.success', {
            appId,
            commitMessage,
            reason,
            filesAffected,
            executionTime
          });
        } else {
          toolGitEvents.failure(logger, new Error(result.error || 'Auto-commit failed'), {
            toolName: 'git',
            operation: 'commit',
            appPath: app.path,
            appId
          });
          
          logger.error('git.auto_commit.failure', {
            appId,
            error: result.error,
            reason,
            executionTime
          });
        }
      } else {
        logger.info('git.auto_commit.not_needed', {
          appId,
          reason,
          isClean: status.status?.isClean || false
        });
      }
    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('git.auto_commit.error', {
        appId,
        error: error instanceof Error ? error.message : String(error),
        reason,
        executionTime,
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
}
