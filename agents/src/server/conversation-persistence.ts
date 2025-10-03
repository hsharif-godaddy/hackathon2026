/**
 * MessagePersistence implementation for the agents server
 * 
 * This class implements the ai-lib ConversationPersistence interface to handle
 * conversation and streaming event persistence directly with the ConversationRepository.
 */

import type { 
  ConversationPersistence, 
  ConversationPersistenceWithCleanup, 
  PersistenceStreamingEvent, 
  ConversationContext
} from '@airo/ai-lib'
import { ConversationRepository } from '../database/repositories/ConversationRepository.js'
import { AppRepository } from '../database/repositories/AppRepository.js'
import { MAX_PROMPT_LENGTH } from '../services/features.js'
import { GitTool } from '../tools/git-tool.js'
import { GitUtils } from '../utils/git.js'
import { logger } from '../logging/index.js'
import { toolGitEvents } from '../logging/events/index.js'
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js'
import { nanoid } from 'nanoid'

export class AgentsMessagePersistence implements ConversationPersistenceWithCleanup {
  private conversationRepo: ConversationRepository
  private appRepository: AppRepository
  
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
    this.conversationRepo = new ConversationRepository()
    this.appRepository = new AppRepository()
  }

  private optimizeStreamingEvents(events: Array<{
    type: string
    content?: string | undefined
    data?: any
    timestamp?: Date | undefined
  }>): Array<{
    type: string
    content?: string | undefined
    data?: any
    timestamp?: Date | undefined
    originalChunkCount?: number | undefined
  }> {
    const optimized: Array<{
      type: string
      content?: string | undefined
      data?: any
      timestamp?: Date | undefined
      originalChunkCount?: number | undefined
    }> = []

    let currentChunkGroup: {
      content: string
      firstTimestamp: Date
      lastTimestamp: Date
      count: number
      data?: any
    } | null = null

    const flushChunkGroup = () => {
      if (currentChunkGroup && currentChunkGroup.content) {
        optimized.push({
          type: 'collapsed_chunks',
          content: currentChunkGroup.content,
          timestamp: currentChunkGroup.firstTimestamp,
          data: currentChunkGroup.data,
          originalChunkCount: currentChunkGroup.count
        })
        currentChunkGroup = null
      }
    }

    for (const event of events) {
      if (event.type === 'chunk' || event.type === 'text_chunk') {
        if (!currentChunkGroup) {
          currentChunkGroup = {
            content: event.content || '',
            firstTimestamp: event.timestamp || new Date(),
            lastTimestamp: event.timestamp || new Date(),
            count: 1,
            data: event.data
          }
        } else {
          currentChunkGroup.content += event.content || ''
          currentChunkGroup.lastTimestamp = event.timestamp || new Date()
          currentChunkGroup.count++
        }
      } else {
        flushChunkGroup()
        optimized.push(event)
      }
    }

    flushChunkGroup()

    return optimized
  }

  async continueConversation(
    conversationId: string,
    message: string,
    context: ConversationContext
  ): Promise<void> {
    logger.info('conversation.continue', {
      conversationId,
      socketId: context.socketId,
      agentName: context.agentName,
      appId: context.appId
    })

    await this.conversationRepo.addMessage(conversationId, 'user', message, {
      metadata: {
        socketId: context.socketId,
        agentName: context.agentName,
        appId: context.appId,
        userId: context.userId,
        sessionId: context.sessionId
      }
    })

    this.activeConversations.set(context.socketId, {
      conversationId,
      userMessageId: nanoid(12),
      context,
      message
    })
    
    if (context.appId) {
      this.appUserMessages.set(context.appId, message)
    }

    logger.info('conversation.user_message.saved', { conversationId })
  }

  async startConversation(
    message: string,
    context: ConversationContext
  ): Promise<string> {
    logger.info('conversation.start', {
      socketId: context.socketId,
      agentName: context.agentName,
      appId: context.appId
    })

    if (!context.appId) {
      throw new Error('appId is required in context')
    }
    
    if (message && message.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Message exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`)
    }

    const app = this.appRepository.findById(context.appId)
    if (!app) {
      throw new Error(`App with ID '${context.appId}' not found`)
    }

    let conversationId: string

    if (context.conversation?.conversationId) {
      const existing = await this.conversationRepo.getById(context.conversation.conversationId)
      if (existing) {
        conversationId = context.conversation.conversationId
        logger.info('conversation.existing.found', { conversationId })
      } else {
        logger.warn('conversation.existing.not_found', { 
          conversationId: context.conversation.conversationId 
        })
        const conversation = await this.conversationRepo.create(
          context.appId,
          context.agentName,
          `Chat with ${context.agentName} - ${new Date().toLocaleString()}`
        )
        conversationId = conversation.id
      }
    } else {
      const conversation = await this.conversationRepo.create(
        context.appId,
        context.agentName,
        `Chat with ${context.agentName} - ${new Date().toLocaleString()}`
      )
      conversationId = conversation.id
      logger.info('conversation.created', { conversationId })
    }

    await this.conversationRepo.addMessage(conversationId, 'user', message, {
      metadata: {
        socketId: context.socketId,
        agentName: context.agentName,
        appId: context.appId,
        userId: context.userId,
        sessionId: context.sessionId
      }
    })

    this.activeConversations.set(context.socketId, {
      conversationId,
      userMessageId: nanoid(12),
      context,
      message
    })
    
    if (context.appId) {
      this.appUserMessages.set(context.appId, message)
    }

    logger.info('conversation.user_message.saved', { conversationId })
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
    const optimizedEvents = this.optimizeStreamingEvents(streamingEvents)
    
    logger.info('conversation.agent_response.optimizing', {
      originalEvents: streamingEvents.length,
      optimizedEvents: optimizedEvents.length,
      reduction: `${Math.round((1 - optimizedEvents.length / streamingEvents.length) * 100)}%`
    })
    
    const segments: any[] = []
    const toolCalls: any[] = []
    const toolsMap = new Map()
    let accumulatedContent = ''
    
    for (const event of optimizedEvents) {
      const timestamp = event.timestamp || new Date()
      
      switch (event.type) {
        case 'chunk':
        case 'text_chunk':
        case 'collapsed_chunks':
          if (event.content) {
            accumulatedContent += event.content
            segments.push({
              id: nanoid(8),
              type: 'content',
              content: event.content,
              timestamp,
              metadata: event.type === 'collapsed_chunks' ? {
                originalChunkCount: event.originalChunkCount,
                isCollapsed: true 
              } : undefined
            })
          }
          break
          
        case 'tool_start':
          if (event.data?.tool) {
            const toolId = event.data.tool.id || nanoid(8)
            const toolData = {
              id: toolId,
              name: event.data.tool.name,
              input: event.data.tool.input,
              status: 'running',
              startTime: timestamp
            }
            
            toolsMap.set(toolId, toolData)
            
            segments.push({
              id: nanoid(8),
              type: 'tool_call',
              timestamp,
              toolCall: toolData
            })
          }
          break
          
        case 'tool_result':
          if (event.data?.tool) {
            const toolId = event.data.tool.id
            const existingTool = toolsMap.get(toolId)
            
            if (existingTool) {
              existingTool.input = event.data.tool.input || existingTool.input
              existingTool.result = event.data.tool.output || event.content || event.data.tool.result
              existingTool.status = 'completed'
              existingTool.endTime = timestamp
              
              if (existingTool.startTime && timestamp) {
                const startTime = new Date(existingTool.startTime).getTime()
                const endTime = new Date(timestamp).getTime()
                existingTool.duration = endTime - startTime
              } else {
                existingTool.duration = event.data.tool.duration || undefined
              }
              
              const segmentIndex = segments.findIndex(s => 
                s.type === 'tool_call' && s.toolCall?.id === toolId
              )
              if (segmentIndex >= 0) {
                segments[segmentIndex].toolCall = existingTool
              }
            }
          }
          break
          
        case 'step_start':
        case 'step_complete':
          break
      }
    }
    
    toolCalls.push(...Array.from(toolsMap.values()))

    logger.info('conversation.agent_response.saving', {
      conversationId,
      contentLength: accumulatedContent.length,
      segmentsCount: segments.length,
      toolCallsCount: toolCalls.length,
      toolNames: toolCalls.map(t => t.name)
    })

    await this.conversationRepo.addMessage(conversationId, 'agent', accumulatedContent, {
      segments,
      toolCalls,
      metadata: {
        agentId: context.agentName,
        finalResult: result,
        streamingEvents: streamingEvents.length
      }
    })

    logger.info('conversation.agent_response.saved', { conversationId })
    
    if (context.appId) {
      await this.checkAndCommitChanges(context.appId, 'conversation_complete');
    }

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
      
      // Create git tools with dev-supervisor for this specific app
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      const gitTool = new GitTool(devSupervisor || undefined);
      const gitUtils = new GitUtils(devSupervisor || undefined);
      
      const status = await gitTool.executeGitOperation(app.path, { operation: 'status' });
      
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

        await gitTool.executeGitOperation(app.path, { 
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
        
        const result = await gitTool.executeGitOperation(app.path, {
          operation: 'commit',
          message: commitMessage
        });

        const executionTime = Date.now() - startTime;

        if (result.success) {
          // Calculate actual number of files affected from detailed git status
          let filesAffected = 0;
          try {
            if (!status.status?.isClean) {
              const detailedStatus = await gitUtils.getStatus(app.path);
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
