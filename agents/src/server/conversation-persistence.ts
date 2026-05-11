/**
 * MessagePersistence implementation for the agents server
 *
 * This class implements the ai-lib ConversationPersistence interface to handle
 * conversation and streaming event persistence directly with the ConversationRepository.
 */

import type {
  ConversationPersistenceWithCleanup,
  PersistenceStreamingEvent,
  ConversationContext
} from '@airo/ai-transport'
import { getCurrentTraceIds } from '@airo/ai-transport'
import { calculateCostEstimate } from '@airo/ai-lib'
import { emitConversationStart } from '@godaddy/agent-otel-sdk'
import { appRepository } from '../database/repositories/index.js'
import type { AppRepository } from '../database/repositories/index.js'
import {
  getConversationLifecycleStore,
  getMessageStore,
} from '../memory/adapters/index.js'
import type { ConversationLifecycleStore, MessageStore } from '../memory/interfaces/index.js'
import { customerIdFromContext, workspaceScopeFromAppId } from '../memory/interfaces/scope.js'
import { MAX_PROMPT_LENGTH } from '../services/features.js'
import { GitTool } from '../tools/git-tool.js'
import { GitUtils } from '../utils/git.js'
import { logger, log } from '../logging/index.js'
import { toolGitEvents } from '../logging/events/index.js'
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js'
import { aiLibAgentMetadata, type AILibAgentMetadata } from '../agents/ai-lib-agents/index.js'
import { AppNotFoundError } from './errors/app-not-found-error.js'
import { getMessageOriginForAuthType, type MessageOrigin } from '@airo/shared/auth'
import { nanoid } from 'nanoid'
import apm from 'elastic-apm-node'

export class AgentsMessagePersistence implements ConversationPersistenceWithCleanup {
  private lifecycleStore: ConversationLifecycleStore
  private messageStore: MessageStore
  private appRepository: AppRepository

  // Track conversations for cleanup
  private activeConversations = new Map<string, {
    conversationId: string
    userMessageId: string
    agentMessageId?: string
    context: ConversationContext
    message?: string
    origin: MessageOrigin
  }>()

  // Map of appIds to their most recent user message
  private appUserMessages = new Map<string, string>()

  constructor() {
    // Use singleton stores (they share a ConversationRepository internally so
    // messageAddedHook state is unified).
    this.lifecycleStore = getConversationLifecycleStore()
    this.messageStore = getMessageStore()
    this.appRepository = appRepository
  }

  /**
   * Derive message origin from conversation context auth type.
   * Support sessions (e2s/e2s2s) get origin='support', all others get 'customer'.
   */
  private getOriginFromContext(context: ConversationContext): MessageOrigin {
    const authType = context.metadata?.authType
    return getMessageOriginForAuthType(authType)
  }

  /**
   * Track token usage in APM for monitoring and analytics using custom transactions
   *
   * Creates a dedicated APM transaction with token metrics and accurate total cost.
   * The cost calculation properly accounts for cached token pricing (10x cheaper for reads).
   *
   * @param type - Type of usage: 'main_agent' or 'handoff'
   * @param usage - Token usage metrics from LLM response
   * @param metadata - Context metadata for tracking
   */
  trackTokenUsageInAPM(
    type: 'main_agent' | 'handoff',
    usage: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
    },
    metadata: {
      conversationId: string
      appId: string
      agentName: string
      modelName: string
      targetAgent?: string
    }
  ): void {
    try {
      // Calculate accurate cost including cache pricing
      const costEstimate = calculateCostEstimate(
        {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          ...(usage.cacheReadTokens !== undefined && { cachedInputTokensRead: usage.cacheReadTokens }),
          ...(usage.cacheWriteTokens !== undefined && { cachedInputTokensWrite: usage.cacheWriteTokens })
        },
        metadata.modelName
      )

      // Create a custom transaction specifically for token tracking
      const transactionName = type === 'handoff'
        ? `Token Usage: Handoff (${metadata.agentName} → ${metadata.targetAgent})`
        : `Token Usage: ${metadata.agentName}`

      const transaction = apm.startTransaction(transactionName, 'token-tracking')

      if (transaction) {
        // Add metadata as labels (strings for filtering)
        // appId is set via globalLabels in APM config
        transaction.setLabel('token_usage_type', type)
        transaction.setLabel('agent_name', metadata.agentName)
        transaction.setLabel('model_name', metadata.modelName)
        transaction.setLabel('conversation_id', metadata.conversationId)

        if (metadata.targetAgent) {
          transaction.setLabel('target_agent', metadata.targetAgent)
        }

        // Store numeric token values as labels (for aggregations and filtering)
        transaction.addLabels({
          tokens_input: usage.inputTokens,
          tokens_output: usage.outputTokens,
          tokens_total: usage.totalTokens,
          tokens_cache_read: usage.cacheReadTokens || 0,
          tokens_cache_write: usage.cacheWriteTokens || 0,
          // Add total cost metric (includes cache pricing)
          cost_total_usd: parseFloat(costEstimate.totalCost.toFixed(6))
        })

        // Mark transaction as successful and end it
        transaction.result = 'success'
        transaction.setOutcome('success')
        transaction.end()

        logger.info('apm.token_tracking.sent', {
          type,
          conversationId: metadata.conversationId,
          totalTokens: usage.totalTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          totalCost: costEstimate.totalCost,
          transactionName
        })
      }

    } catch (error) {
      // Don't let APM tracking errors break the flow
      logger.warn('apm.token_tracking.failed', {
        error: error instanceof Error ? error.message : String(error),
        type,
        conversationId: metadata.conversationId
      })
    }
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
  ): Promise<string> {
    const contextLogger = context.appId
      ? log.withContext({
        appId: context.appId,
        agentId: context.agentName,
        conversationId
      })
      : logger

    contextLogger.info('conversation.continue', {
      socketId: context.socketId
    })

    // Extract contextAttachments if present (they're passed through agent context)
    const contextAttachments = (context as any).contextAttachments
    const filteredAttachments = contextAttachments && Array.isArray(contextAttachments)
      ? contextAttachments.filter((att: any) => att.persistence === 'save')
      : undefined

    const origin = this.getOriginFromContext(context)
    const messageMetadata =
      context.messageMetadata && typeof context.messageMetadata === 'object'
        ? context.messageMetadata
        : undefined

    const savedMessage = await this.messageStore.addMessage(conversationId, 'user', message, {
      metadata: {
        ...messageMetadata,
        socketId: context.socketId,
        agentName: context.agentName,
        appId: context.appId,
        userId: context.userId,
        sessionId: context.sessionId
      },
      origin,
      ...(filteredAttachments && filteredAttachments.length > 0 && { contextAttachments: filteredAttachments })
    })

    this.activeConversations.set(context.socketId, {
      conversationId,
      userMessageId: nanoid(12),
      context,
      message,
      origin
    })

    if (context.appId) {
      this.appUserMessages.set(context.appId, message)
    }

    contextLogger.info('conversation.user_message.saved', {})
    return savedMessage.id
  }

  async startAgentTurn(
    conversationId: string,
    context: ConversationContext
  ): Promise<string> {
    const contextLogger = context.appId
      ? log.withContext({
        appId: context.appId,
        agentId: context.agentName,
        conversationId
      })
      : logger

    contextLogger.info('conversation.agent_turn.start', {
      socketId: context.socketId
    })

    // Inherit origin from the triggering user message so agent responses share the same visibility
    const activeConversation = this.activeConversations.get(context.socketId)
    const origin = activeConversation?.origin || this.getOriginFromContext(context)

    const message = await this.messageStore.addMessage(conversationId, 'agent', '', {
      metadata: {
        socketId: context.socketId,
        agentName: context.agentName,
        appId: context.appId,
        inProgress: true
      },
      origin
    })
    if (activeConversation) {
      // Finalize the previous agent message before starting a new turn.
      // During handoffs, the prior message is left with inProgress: true
      // because completeConversation only finalizes the LAST agent message.
      if (activeConversation.agentMessageId) {
        try {
          await this.messageStore.updateMessageMetadata(activeConversation.agentMessageId, {
            inProgress: false
          })
        } catch (error) {
          contextLogger.warn('conversation.agent_turn.finalize_previous_failed', {
            previousMessageId: activeConversation.agentMessageId,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
      activeConversation.agentMessageId = message.id
    }

    contextLogger.info('conversation.agent_turn.placeholder_created', {
      messageId: message.id
    })

    return message.id
  }

  async updateAgentTurn(
    conversationId: string,
    messageId: string,
    updates: {
      content?: string
      segments?: any[]
      toolCalls?: any[]
    },
    context: ConversationContext
  ): Promise<void> {
    const contextLogger = context.appId
      ? log.withContext({
        appId: context.appId,
        agentId: context.agentName,
        conversationId
      })
      : logger

    try {
      await this.messageStore.updateMessage(messageId, updates)

      contextLogger.info('conversation.agent_turn.updated', {
        messageId,
        hasContent: !!updates.content,
        segmentsCount: updates.segments?.length || 0,
        toolCallsCount: updates.toolCalls?.length || 0
      })
    } catch (error) {
      contextLogger.error('conversation.agent_turn.update_failed', {
        messageId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async startConversation(
    message: string,
    context: ConversationContext
  ): Promise<string> {
    if (!context.appId) {
      throw new Error('appId is required in context')
    }

    const contextLogger = log.withContext({
      appId: context.appId,
      agentId: context.agentName
    })

    contextLogger.info('conversation.start', {
      socketId: context.socketId
    })

    if (message && message.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Message exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`)
    }

    const app = this.appRepository.findById(context.appId)
    if (!app) {
      throw new AppNotFoundError(context.appId)
    }

    let conversationId: string
    let isNewConversation = false

    // Check if conversationId is provided in context
    const providedConversationId = context.conversation?.conversationId

    if (providedConversationId) {
      // Check if conversation exists
      const existing = await this.lifecycleStore.getById(providedConversationId)
      if (existing) {
        conversationId = providedConversationId
        contextLogger.info('conversation.existing.found', { conversationId })
      } else {
        // Conversation doesn't exist, create it with the provided ID
        contextLogger.info('conversation.create_with_provided_id', {
          conversationId: providedConversationId
        })
        const scope = workspaceScopeFromAppId(context.appId, customerIdFromContext(context as { metadata?: Record<string, unknown> }))
        const conversation = await this.lifecycleStore.create(
          scope,
          context.agentName,
          `Chat with ${context.agentName} - ${new Date().toLocaleString()}`,
          providedConversationId
        )
        conversationId = conversation.id
        isNewConversation = true
        contextLogger.info('conversation.created_with_id', { conversationId })
      }
    } else {
      // No conversationId provided - use latest existing conversation or create new
      const scope = workspaceScopeFromAppId(context.appId, customerIdFromContext(context as { metadata?: Record<string, unknown> }))
      const { conversation, isNew } = await this.lifecycleStore.getOrCreateForApp(
        scope,
        context.agentName,
        `Chat with ${context.agentName} - ${new Date().toLocaleString()}`
      )
      conversationId = conversation.id
      isNewConversation = isNew
      contextLogger.info(isNew ? 'conversation.created' : 'conversation.reused_latest', { conversationId })
    }

    if (isNewConversation) {
      emitConversationStart({
        conversationId,
        agentId: `airo-app-builder-${context.agentName}`,
      })
    }

    // Extract contextAttachments if present (they're passed through agent context)
    const contextAttachments = (context as any).contextAttachments
    const filteredAttachments = contextAttachments && Array.isArray(contextAttachments)
      ? contextAttachments.filter((att: any) => att.persistence === 'save')
      : undefined

    const origin = this.getOriginFromContext(context)

    await this.messageStore.addMessage(conversationId, 'user', message, {
      metadata: {
        socketId: context.socketId,
        agentName: context.agentName,
        appId: context.appId,
        userId: context.userId,
        sessionId: context.sessionId
      },
      origin,
      ...(filteredAttachments && filteredAttachments.length > 0 && { contextAttachments: filteredAttachments })
    })

    this.activeConversations.set(context.socketId, {
      conversationId,
      userMessageId: nanoid(12),
      context,
      message,
      origin
    })

    if (context.appId) {
      this.appUserMessages.set(context.appId, message)
    }

    contextLogger.info('conversation.user_message.saved', { conversationId })
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
    const contextLogger = context.appId
      ? log.withContext({
        appId: context.appId,
        agentId: context.agentName,
        conversationId
      })
      : logger

    const optimizedEvents = this.optimizeStreamingEvents(streamingEvents)

    contextLogger.info('conversation.agent_response.optimizing', {
      originalEvents: streamingEvents.length,
      optimizedEvents: optimizedEvents.length,
      reduction: `${Math.round((1 - optimizedEvents.length / streamingEvents.length) * 100)}%`
    })

    const segments: any[] = []
    const toolCalls: any[] = []
    const toolsMap = new Map()
    let accumulatedContent = ''

    let lastSegmentType = ''

    for (const event of optimizedEvents) {
      const timestamp = event.timestamp || new Date()

      switch (event.type) {
        case 'chunk':
        case 'text_chunk':
        case 'collapsed_chunks':
          if (event.content) {
            // When consecutive content segments have no tool_call between them
            // (e.g., step_start/step_complete events were stripped), preserve
            // paragraph separation so the text doesn't render as one wall of text.
            const separator = (lastSegmentType === 'content' && accumulatedContent.length > 0) ? '\n\n' : ''
            accumulatedContent += separator + event.content
            segments.push({
              id: nanoid(8),
              type: 'content',
              content: separator + event.content,
              timestamp,
              metadata: event.type === 'collapsed_chunks' ? {
                originalChunkCount: event.originalChunkCount,
                isCollapsed: true
              } : undefined
            })
            lastSegmentType = 'content'
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

            // Only add segment if one doesn't already exist for this tool
            const existingSegmentIndex = segments.findIndex(s =>
              s.type === 'tool_call' && s.toolCall?.id === toolId
            )

            if (existingSegmentIndex === -1) {
              segments.push({
                id: nanoid(8),
                type: 'tool_call',
                timestamp,
                toolCall: toolData
              })
            }
            // Always update lastSegmentType, even for a duplicate tool_start.
            // If a duplicate arrives while lastSegmentType is still 'content',
            // subsequent content would incorrectly receive a paragraph separator.
            lastSegmentType = 'tool_call'
          }
          break

        case 'tool_result':
          if (event.data?.tool) {
            const toolId = event.data.tool.id
            const existingTool = toolsMap.get(toolId)

            if (existingTool) {
              existingTool.input = event.data.tool.input || existingTool.input
              existingTool.result = event.data.tool.output || event.content || event.data.tool.result
              const hasError = event.data.tool.error || event.data.tool.is_error
              existingTool.error = event.data.tool.error
              existingTool.status = hasError ? 'error' : 'completed'
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

    contextLogger.info('conversation.agent_response.saving', {
      contentLength: accumulatedContent.length,
      segmentsCount: segments.length,
      toolCallsCount: toolCalls.length,
      toolNames: toolCalls.map(t => t.name)
    })

    const activeConversation = this.activeConversations.get(context.socketId)

    // Get usedFreeGrants from context (set by beforeMessageComplete callback)
    const usedFreeGrants = (context as { usedFreeGrants?: boolean }).usedFreeGrants ?? false

    const traceIds = getCurrentTraceIds()

    if (activeConversation?.agentMessageId) {
      await this.messageStore.updateMessage(activeConversation.agentMessageId, {
        content: accumulatedContent,
        segments,
        toolCalls,
        metadata: {
          agentId: context.agentName,
          finalResult: result,
          streamingEvents: streamingEvents.length,
          inProgress: false,
          usedFreeGrants,
          ...traceIds
        }
      })
      contextLogger.info('conversation.agent_response.updated', {
        messageId: activeConversation.agentMessageId
      })
    } else {
      const fallbackOrigin = activeConversation?.origin || this.getOriginFromContext(context)
      await this.messageStore.addMessage(conversationId, 'agent', accumulatedContent, {
        segments,
        toolCalls,
        metadata: {
          agentId: context.agentName,
          finalResult: result,
          streamingEvents: streamingEvents.length,
          usedFreeGrants,
          ...traceIds
        },
        origin: fallbackOrigin
      })
      contextLogger.info('conversation.agent_response.saved', {})
    }

    // Note: Token tracking is now handled exclusively by the onTokenUsage callback
    // in experimental-websocket-server.ts. This ensures 100% capture regardless of
    // conversation state and eliminates any risk of double counting.

    // Track handoff token usage from tool results
    if (toolCalls.length > 0 && context.appId) {
      await Promise.all(
        toolCalls
          .filter((toolCall) => toolCall.name === 'handoff' && toolCall.result)
          .map(async (toolCall) => {
            try {
              // Parse the handoff result to extract usage data
              let handoffResult: any;
              if (typeof toolCall.result === 'string') {
                try {
                  handoffResult = JSON.parse(toolCall.result);
                } catch {
                  // If parsing fails, try to extract from the string
                  handoffResult = toolCall.result;
                }
              } else {
                handoffResult = toolCall.result;
              }

              // Extract usage from handoff result
              if (handoffResult?.result?.usage) {
                const handoffUsage = handoffResult.result.usage;
                const handoffCaching = handoffResult.result.caching;
                const targetAgent = handoffResult.targetAgent || 'unknown';
                // Get model name from target agent metadata
                const targetMetadata = aiLibAgentMetadata[targetAgent] as AILibAgentMetadata & { modelName?: string };
                const modelName = targetMetadata?.modelName || 'claude-sonnet-4-6';

                // Calculate accurate cost for handoff
                const handoffCostEstimate = calculateCostEstimate(
                  {
                    inputTokens: handoffUsage.inputTokens || 0,
                    outputTokens: handoffUsage.outputTokens || 0,
                    totalTokens: handoffUsage.totalTokens || 0,
                    ...(handoffCaching?.cachedInputTokens !== undefined && { cachedInputTokensRead: handoffCaching.cachedInputTokens }),
                    ...(handoffCaching?.cacheWriteInputTokens !== undefined && { cachedInputTokensWrite: handoffCaching.cacheWriteInputTokens })
                  },
                  modelName
                )

                // Track handoff in APM for monitoring
                this.trackTokenUsageInAPM(
                  'handoff',
                  {
                    inputTokens: handoffUsage.inputTokens || 0,
                    outputTokens: handoffUsage.outputTokens || 0,
                    totalTokens: handoffUsage.totalTokens || 0,
                    cacheReadTokens: handoffCaching?.cachedInputTokens || 0,
                    cacheWriteTokens: handoffCaching?.cacheWriteInputTokens || 0,
                  },
                  {
                    conversationId,
                    appId: context.appId!,
                    agentName: context.agentName,
                    modelName,
                    targetAgent,
                  }
                );

                logger.info('conversation.handoff_usage.recorded', {
                  conversationId,
                  appId: context.appId,
                  sourceAgent: context.agentName,
                  targetAgent,
                  modelName,
                  inputTokens: handoffUsage.inputTokens,
                  outputTokens: handoffUsage.outputTokens,
                  totalTokens: handoffUsage.totalTokens,
                  cacheReadTokens: handoffCaching?.cachedInputTokens,
                  cacheWriteTokens: handoffCaching?.cacheWriteInputTokens,
                  cost: handoffCostEstimate.totalCost
                });
              }
            } catch (handoffError) {
              logger.warn('conversation.handoff_usage.parse_failed', {
                conversationId,
                appId: context.appId,
                toolName: toolCall.name,
                error: handoffError instanceof Error ? handoffError.message : String(handoffError),
              });
            }
          })
      );
    }

    // Create git commit if there are changes and store hash on context
    if (context.appId) {
      // Check if commit hash was already set by beforeMessageComplete
      const existingCommitHash = (context as any).commitHash

      if (typeof existingCommitHash === 'string' && existingCommitHash.length > 0) {
        // Commit already created by git hook (squash merge)
        contextLogger.debug('conversation.complete.commit_hash_reused', {
          commitHash: existingCommitHash.substring(0, 7),
          source: 'git_hook_squash_merge'
        })
      } else {
        // Fallback: check for uncommitted changes (safety net)
        const commitHash = await this.checkAndCommitChanges(context.appId, 'conversation_complete');
        (context as any).commitHash = commitHash;

        if (commitHash) {
          contextLogger.debug('conversation.complete.commit_hash_created', {
            commitHash: commitHash.substring(0, 7),
            source: 'fallback_commit'
          })
        }
      }
    } else {
      // No appId means no app to commit to - explicitly set null
      (context as any).commitHash = null;
    }

    this.activeConversations.delete(context.socketId)
  }

  async handleConversationError(
    conversationId: string | undefined,
    error: Error,
    message?: string,
    context?: ConversationContext
  ): Promise<void> {
    const contextLogger = context?.appId
      ? log.withContext({
        appId: context.appId,
        agentId: context.agentName,
        conversationId
      })
      : logger

    contextLogger.error('websocket.conversation.error', {
      error: error.message,
      socketId: context?.socketId
    })

    if (context) {
      const activeConversation = this.activeConversations.get(context.socketId)

      if (activeConversation?.agentMessageId && conversationId) {
        try {
          await this.messageStore.updateMessageMetadata(activeConversation.agentMessageId, {
            error: error.message,
            errorTimestamp: new Date().toISOString(),
            inProgress: false,
            incomplete: true
          })
          contextLogger.info('conversation.agent_response.error_state_saved', {
            messageId: activeConversation.agentMessageId
          })
        } catch (updateError) {
          contextLogger.error('conversation.agent_response.error_state_failed', {
            error: updateError instanceof Error ? updateError.message : String(updateError)
          })
        }
      }

      if (context.appId) {
        await this.checkAndCommitChanges(context.appId, 'conversation_error');
      }

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

    // Clear inProgress flag on any pending agent messages to prevent users from
    // being stuck in "thinking" state on reconnect/refresh.
    //
    // Note: If the 2-minute abort timeout fires after this cleanup, completeConversation()
    // may overwrite the metadata. This is harmless - both clear inProgress: false.
    // The disconnect cleanup runs immediately for best UX, the timeout cleanup is a backup.
    if (activeConversation?.agentMessageId) {
      try {
        const message = await this.messageStore.getMessageById(activeConversation.agentMessageId);
        
        if (message?.metadata?.inProgress) {
          logger.info('websocket.disconnection.clearing_inprogress', {
            conversationId: activeConversation.conversationId,
            messageId: activeConversation.agentMessageId,
            socketId
          });
          
          await this.messageStore.updateMessageMetadata(activeConversation.agentMessageId, {
            inProgress: false
          });
        }
      } catch (error) {
        logger.error('websocket.disconnection.clear_inprogress_failed', {
          conversationId: activeConversation.conversationId,
          socketId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
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
   *
   * @returns The commit hash if a commit was created, null otherwise
   */
  private async checkAndCommitChanges(appId: string, reason: string): Promise<string | null> {
    const contextLogger = log.forApp(appId)
    const startTime = Date.now();

    try {
      contextLogger.info('git.auto_commit.check', {
        reason
      })

      const app = await this.appRepository.findById(appId);
      if (!app) {
        contextLogger.warn('git.auto_commit.app_not_found', {
          reason
        })
        return null;
      }

      // Create git tools with dev-supervisor for this specific app
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      const gitTool = new GitTool(devSupervisor || undefined);
      const gitUtils = new GitUtils(devSupervisor || undefined);

      // Best-effort: keep fallback commits on main to match squash-merge path
      try {
        const currentBranch = await gitUtils.getCurrentBranch(app.path);
        if (currentBranch && currentBranch !== 'main') {
          const switchResult = await gitUtils.switchBranch(app.path, 'main');
          if (!switchResult.success) {
            contextLogger.warn('git.auto_commit.switch_to_main.failed', {
              reason,
              currentBranch,
              commitMayBeOffMain: true,
              error: switchResult.stderr
            });
          }
        }
      } catch (error) {
        contextLogger.warn('git.auto_commit.switch_to_main.error', {
          reason,
          commitMayBeOffMain: true,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      const status = await gitTool.executeGitOperation(app.path, { operation: 'status' });

      if (status.success && status.status && !status.status.isClean) {
        toolGitEvents.begin(contextLogger, {
          toolName: 'git',
          operation: 'commit',
          appPath: app.path,
          options: {
            reason
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
          commitMessage = `${truncatedMessage}`;
        } else {
          commitMessage = `Saving changes after`;
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
            contextLogger.warn('git.auto_commit.status_fallback', {
              error: error instanceof Error ? error.message : String(error)
            });
          }

          toolGitEvents.success(contextLogger, {
            toolName: 'git',
            operation: 'commit',
            appPath: app.path,
            resultStats: {
              success: true,
              filesAffected,
              executionTime
            }
          });

          // Get the commit hash we just created (most recent = index 0)
          const commits = await gitUtils.getCommitHistory(app.path, 1);
          const commitHash = commits[0]?.hash || null;

          contextLogger.info('git.auto_commit.success', {
            commitMessage,
            commitHash: commitHash ? commitHash.substring(0, 7) : 'unknown',
            reason,
            filesAffected,
            executionTime,
            message: 'Git commit created - will be included in WebSocket complete event'
          });

          return commitHash;
        } else {
          toolGitEvents.failure(contextLogger, new Error(result.error || 'Auto-commit failed'), {
            toolName: 'git',
            operation: 'commit',
            appPath: app.path
          });

          contextLogger.error('git.auto_commit.failure', {
            error: result.error,
            reason,
            executionTime
          });
          return null;
        }
      } else {
        contextLogger.info('git.auto_commit.not_needed', {
          reason,
          isClean: status.status?.isClean || false,
          message: 'No file changes detected - no commit will be created'
        });
        return null;
      }
    } catch (error) {
      const executionTime = Date.now() - startTime;
      contextLogger.error('git.auto_commit.error', {
        error: error instanceof Error ? error.message : String(error),
        reason,
        executionTime,
        stack: error instanceof Error ? error.stack : undefined
      });
      return null;
    }
  }
}
