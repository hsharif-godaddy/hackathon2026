/**
 * AI-Lib WebSocket Server Implementation
 * Uses AgentFactory system for modern agent management
 */

import { Server as HTTPServer } from 'node:http'
import {
  calculateCostEstimate,
  createWebSocketServer,
  type MessageProvider,
  type ContextProvider,
  type ConversationMessage
} from '@airo/ai-lib'
import { auth, AuthType } from '../services/features.js'
import apm from 'elastic-apm-node'
import { observe, updateActiveObservation } from '@langfuse/tracing'

// Define ContextMessage interface locally (extends ConversationMessage with required insertionOrder)
interface ContextMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  /** Optional cache point for cost optimization */
  cachePoint?: { type: 'ephemeral' }
  /** When to insert this message relative to conversation history */
  insertionOrder: 'before_history' | 'after_history'
}

import {
  createWebSocketAgentFactory,
  aiLibAgentMetadata
} from '../agents/ai-lib-agents/index.js'
import { AILibContextManager } from '../agents/ai-lib-agents/context-manager.js'
import { AgentsMessagePersistence } from './conversation-persistence.js'
import { ConversationContextManager } from '../services/ConversationContextManager.js'
import { TokenUsageRepository } from '../database/repositories/TokenUsageRepository.js'
import { fileContextRegistry } from '../services/FileContextRegistry.js'
import { fileUploadService } from '../services/FileUploadService.js'
import { logger, log } from '../logging/index.js'
import { jwtAuthMiddleware } from './middleware/jwt-auth.js'
import { getAgentConfig } from '../services/features.js'
import type { AgentsAppContext } from '../types/websocket-context.js'
import { AppRepository } from '../database/repositories/AppRepository.js'
import { initializeContextRegistry } from '../services/initializeContextRegistry.js'
import { KnowBDriver } from '../tools/ai-lib-tools/drivers/knowb-driver.js'
import { GitHookService } from '../services/git-hook-service.js'
import { ClientActionService } from '../services/ClientActionService.js'

/**
 * Shared AppRepository instance to avoid repeated initialization
 */
const appRepo = new AppRepository()

/**
 * Observed KnowB search function with automatic Langfuse tracing
 * Captures inputs, outputs, timings, and errors automatically
 */
async function searchKnowBDocumentation(params: {
  query: string
  kbNodeIds: string[]
  maxResults: number
  scoreThreshold: number
  appId?: string | undefined
  sessionId?: string | undefined
}) {
  const knowBDriver = new KnowBDriver()
  
  // Update observation with metadata about the retrieval operation
  updateActiveObservation({
    metadata: {
      retrievalType: 'semantic_search',
      knowledgeBase: params.kbNodeIds.join(','),
      appId: params.appId,
      sessionId: params.sessionId,
      maxResults: params.maxResults,
      scoreThreshold: params.scoreThreshold
    }
  })

  const knowBResult = await knowBDriver.search({
    query: params.query,
    kbNodeIds: params.kbNodeIds,
    maxResults: params.maxResults,
    scoreThreshold: params.scoreThreshold,
  })

  if (!knowBResult.success || !knowBResult.results || knowBResult.results.length === 0) {
    // Update observation with no results metadata
    updateActiveObservation({
      metadata: {
        documentsRetrieved: 0,
        noResults: true
      }
    })
    return null
  }

  const docsContent = knowBDriver.formatResultsAsMarkdown(knowBResult.results)

  // Update observation with successful retrieval metadata
  updateActiveObservation({
    metadata: {
      documentsRetrieved: knowBResult.results.length,
      avgScore: knowBResult.results.reduce((sum, r) => sum + (r.score || 0), 0) / knowBResult.results.length,
      allScoresAboveThreshold: knowBResult.results.every(r => (r.score || 0) >= params.scoreThreshold),
      documentIds: knowBResult.results.map(r => r.kbNodeId).filter(Boolean)
    }
  })

  return {
    content: docsContent,
    results: knowBResult.results,
    count: knowBResult.results.length
  }
}

/**
 * Traced version of KnowB search with automatic Langfuse tracing
 */
const tracedSearchKnowB = observe(searchKnowBDocumentation, {
  name: 'KnowB Documentation Retrieval',
  asType: 'span'
})

/**
 * Shared GitHookService instance for tracking feature branches across connections
 */
const gitHookService = new GitHookService()

/**
 * Map to track active WebSocket transactions for APM
 * Key: socketId, Value: APM transaction object
 */
const activeWebSocketTransactions = new Map<string, any>()

/**
 * Socket.IO server instance for emitting events
 * Exported for use in other services (e.g., OAuth result notifications)
 */
let ioInstance: any = null

/**
 * Client Action Service registry
 * Maps socketId -> ClientActionService for client-side tool execution
 */
const clientActionServices = new Map<string, ClientActionService>()

/**
 * Get or create ClientActionService for a socket
 */
function getOrCreateClientActionService(
  socketId: string,
  conversationId: string
): ClientActionService | null {
  // Get existing service
  let service = clientActionServices.get(socketId)
  if (service) {
    return service
  }

  // Create new service
  if (!ioInstance) {
    logger.warn('client-action-service.no_io_instance', {
      socketId,
      conversationId,
    })
    return null
  }

  const socket = ioInstance.sockets.sockets.get(socketId)
  if (!socket) {
    logger.warn('client-action-service.socket_not_found', {
      socketId,
      conversationId,
    })
    return null
  }

  service = new ClientActionService(socket, conversationId)
  clientActionServices.set(socketId, service)

  logger.info('client-action-service.created', {
    socketId,
    conversationId,
  })

  return service
}

/**
 * Get existing ClientActionService for a socket
 * Used by tools to access the service without it being in context
 */
export function getClientActionService(socketId: string): ClientActionService | null {
  return clientActionServices.get(socketId) || null
}

/**
 * Cleanup ClientActionService for a socket
 */
function cleanupClientActionService(socketId: string): void {
  const service = clientActionServices.get(socketId)
  if (service) {
    service.cleanup()
    clientActionServices.delete(socketId)
    logger.info('client-action-service.cleaned_up', {
      socketId,
    })
  }
}

/**
 * Build dynamic data message for system prompt enrichment
 * Note: Must be a user message to avoid Anthropic's restriction on multiple system messages
 */
function buildDynamicDataMessage(context: AgentsAppContext): {
  role: 'user' | 'system'
  content: string
  insertionOrder: 'before_history' | 'after_history'
} {
  const sections: string[] = []

  // Always include current date
  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  sections.push(`Today's date is ${currentDate}`)

  // Include user's timezone from browser
  const userTimezone = context.metadata?.userTimezone
  if (userTimezone) {
    sections.push(`User's timezone: ${userTimezone}`)
  }

  // Include project title if available (not falling back to initial prompt)
  const appId = context.metadata?.appId
  if (appId) {
    const app = appRepo.findById(appId)
    if (app?.name) {
      sections.push(`Project title: ${app.name}`)
    }
    if (app?.previewUrl) {
      sections.push(`Preview URL: ${app.previewUrl}`)
    }
  }

  return {
    role: 'user',
    content: `## Dynamic Context\n\n${sections.join('\n')}`,
    insertionOrder: 'before_history'
  }
}



/**
 * Create and setup the AI-Lib WebSocket server
 */
export async function setupAILibWebSocketServer(httpServer: HTTPServer) {
  logger.info('websocket.server.setup.begin', {
    message: 'Setting up AgentFactory WebSocket server with conversation persistence'
  })

  // Create context logging configuration
  const contextLogging = getAgentConfig.contextLogging()
  logger.info('websocket.context.config', {
    summary: 'Always enabled (concise)',
    detailed: contextLogging.detailed,
    appContextContent: contextLogging.appContextContent,
    templateContent: contextLogging.templateContent,
    visualContextDetails: contextLogging.visualContextDetails,
    rawContextData: contextLogging.rawContextData,
    debugFlags: {
      DEBUG_CONTEXT_DETAILED: process.env.DEBUG_CONTEXT_DETAILED === 'true',
      DEBUG_APP_CONTEXT_CONTENT: process.env.DEBUG_APP_CONTEXT_CONTENT === 'true',
      DEBUG_TEMPLATE_CONTENT: process.env.DEBUG_TEMPLATE_CONTENT === 'true',
      DEBUG_VISUAL_CONTEXT: process.env.DEBUG_VISUAL_CONTEXT === 'true',
      DEBUG_RAW_CONTEXT: process.env.DEBUG_RAW_CONTEXT === 'true'
    }
  })

  // Enable debug logging if requested
  if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
    logger.debug('websocket.debug.conversation_history.enabled', {
      message: 'Conversation history debug logging enabled'
    })
  }

  if (process.env.DEBUG_AI_REQUESTS === 'true') {
    logger.debug('websocket.debug.ai_requests.enabled', {
      message: 'AI request debug logging enabled'
    })
    // Enable AI SDK debug logging
    process.env.DEBUG = 'ai:*'
  }

  try {
    // Initialize context attachment registry with default renderers
    initializeContextRegistry()

    // Create the agent factory with state manager
    const agentFactory = await createWebSocketAgentFactory()
    const stateManager = agentFactory.stateManager

    // Create context manager for app context and template descriptions
    const contextManager = new AILibContextManager()

    // Register context manager with file context registry for tools
    fileContextRegistry.setContextManager(contextManager)

    // Wire up todo list selection callback to state manager
    const { todoListTool } = await import('../tools/todo-list-tool.js')
    todoListTool.setOnSelectCallback((sessionId: string, listId: string) => {
      stateManager.setSelectedTodoList(sessionId, listId)
      logger.info('todo.list.selected', {
        sessionId,
        listId,
        message: 'Todo list selected for session'
      })
    })

    // Create message persistence implementation
    const messagePersistence = new AgentsMessagePersistence()

    // Use singleton conversation repository and initialize background summarization
    const { conversationRepository } = await import('../database/repositories/index.js')
    const { initializeBackgroundSummarization } = await import('../services/summarization/index.js')
    
    // Initialize background summarization once at startup
    // Aggressive settings for timely summarization:
    // - 5k token threshold (down from 10k): Triggers summarization sooner to capture
    //   file-level details before they're lost in compression. Earlier summarization
    //   means better context preservation with the new tool call extraction.
    // - keepRecentTurns: 2 (down from 3): With improved summarization quality (file names,
    //   structured tool details), we can safely keep fewer unsummarized turns while
    //   maintaining context quality. This balances token budget with context freshness.
    // - Uses 'full' model tier (Sonnet) for high-quality, cost-effective summarization
    //   (Sonnet produces 6x better compression than Haiku, cheaper overall)
    // - Trade-off: More frequent summarization calls vs. better context preservation
    await initializeBackgroundSummarization({
      tokenThreshold: 5000,
      debounceMs: 10000,
      keepRecentTurns: 2, // Keep last 2 user prompts + responses unsummarized
      strategy: 'detailed-llm', // Options: 'llm' (baseline), 'detailed-llm' (structured with API/DB/Pages)
    })

    // Create token-based conversation history provider using singleton repository
    const conversationContextManager = new ConversationContextManager(conversationRepository, 10) // Max 10 messages

    // Create context provider implementation for app context and templates
    const contextProvider: ContextProvider = {
      async loadContextMessages(context: Record<string, unknown>): Promise<ContextMessage[]> {
        // Always show concise summary
        logger.debug('websocket.context.provider.loading', {
          message: 'Loading context messages',
          contextKeys: Object.keys(context),
          hasMetadata: !!context.metadata,
          metadataKeys: context.metadata ? Object.keys(context.metadata as Record<string, unknown>) : []
        })

        if (!context) {
          logger.warn('websocket.context.provider.no_context', {
            message: 'No context provided'
          })
          return []
        }

        try {
          // Convert to enhanced context and enrich with app context and template descriptions
          const agentsAppContext = context as AgentsAppContext

          // Enrich metadata with stateManager and sessionId for tool access
          if (!agentsAppContext.metadata) {
            agentsAppContext.metadata = {}
          }
          agentsAppContext.metadata.stateManager = stateManager
          if (agentsAppContext.metadata.sessionId) {
            // sessionId already set by client, keep it
          } else {
            // Fallback: use a default session ID if not provided
            agentsAppContext.metadata.sessionId = 'default-session'
          }

          // Detailed logging if enabled
          if (contextLogging.detailed) {
            logger.debug('websocket.context.provider.detailed', {
              message: 'Converting to enhanced context',
              rawContextKeys: Object.keys(agentsAppContext),
              hasMetadata: !!agentsAppContext.metadata,
              hasAppContext: !!agentsAppContext.appContext,
              hasVisualContext: !!agentsAppContext.visualContext,
              hasAiEditContext: !!agentsAppContext.aiEditContext,
              hasSelectedAssets: !!agentsAppContext.selectedAssets
            })
          }

          // Raw context data logging if enabled
          if (contextLogging.rawContextData) {
            logger.debug('websocket.context.provider.raw_data', {
              message: 'Raw context data',
              context: agentsAppContext
            })
          }

          const enhancedContext = contextManager.convertToEnhancedContext(agentsAppContext)

          // Extract agent-specific context preferences from active agent metadata
          // The agentId MUST be set in context.metadata by processContext() based on state manager
          const agentId = agentsAppContext.metadata?.agentId as string
          if (!agentId) {
            logger.error('websocket.context.provider.missing_agent_id', {
              message: 'agentId not found in context.metadata - this should never happen',
              hasMetadata: !!agentsAppContext.metadata,
              metadataKeys: agentsAppContext.metadata ? Object.keys(agentsAppContext.metadata) : []
            })
            throw new Error('agentId must be set in context.metadata')
          }

          const agent = agentFactory.agents.get(agentId)
          if (!agent) {
            logger.error('websocket.context.provider.agent_not_found', {
              message: 'Agent not found in factory',
              agentId,
              availableAgents: Array.from(agentFactory.agents['agents'].keys())
            })
            throw new Error(`Agent not found: ${agentId}`)
          }

          const agentPreferences = agent.getConfig()?.metadata?.contextPreferences as any

          // Build context messages including app context and template descriptions
          const contextResult = await contextManager.buildContextMessages('', enhancedContext, agentPreferences)

          // Collect screenshots and asset images from formatted contexts for vision processing
          const screenshots: string[] = []
          const assetImages: string[] = []
          
          if (contextResult.formattedContexts) {
            for (const formatted of contextResult.formattedContexts) {
              // Collect screenshots
              if (formatted.screenshot) {
                screenshots.push(formatted.screenshot)
                logger.debug('websocket.context.provider.screenshot_collected', {
                  type: formatted.type,
                  screenshotSize: formatted.screenshot.length
                })
              }
              
              // Collect asset images
              if (formatted.assetImages && Array.isArray(formatted.assetImages)) {
                assetImages.push(...formatted.assetImages)
                logger.debug('websocket.context.provider.asset_images_collected', {
                  type: formatted.type,
                  count: formatted.assetImages.length
                })
              }
            }
          }

          // Store all images in context metadata for later use in streamGenerate
          const allImages = [...screenshots, ...assetImages]
          if (allImages.length > 0) {
            if (!agentsAppContext.metadata) {
              agentsAppContext.metadata = {}
            }
            agentsAppContext.metadata._screenshots = allImages
            logger.info('websocket.context.provider.images_attached', {
              screenshots: screenshots.length,
              assetImages: assetImages.length,
              total: allImages.length
            })
          }

          // Build dynamic data section
          const dynamicDataMessage = buildDynamicDataMessage(agentsAppContext)

          // Build todo list context if a list is selected
          let todoContextMessage: ContextMessage | null = null
          const sessionId = agentsAppContext.metadata?.sessionId as string
          if (sessionId) {
            const selectedTodoListId = stateManager.getSelectedTodoList(sessionId)
            if (selectedTodoListId && agentsAppContext.metadata?.appId) {
              const { getTodoContextManager } = await import('../services/TodoContextManager.js')
              const todoContextManager = getTodoContextManager()
              const executionContext = {
                metadata: agentsAppContext.metadata
              }
              const todoContext = await todoContextManager.generateTodoContext(
                executionContext as any,
                selectedTodoListId
              )
              if (todoContext) {
                todoContextMessage = {
                  role: 'user',
                  content: todoContext,
                  insertionOrder: 'after_history'
                }
              }
            }
          }

          // Search KnowB with user's message for relevant documentation
          let knowBContextMessage: ContextMessage | null = null
          const userMessage = agentsAppContext.metadata?._userMessage as string | undefined

          if (userMessage && typeof userMessage === 'string' && userMessage.trim().length > 0) {
            try {
              const retrievalResult = await tracedSearchKnowB({
                query: userMessage,
                kbNodeIds: ['/airo_sys'],
                maxResults: 3,
                scoreThreshold: 0.35,
                appId: agentsAppContext.metadata?.appId,
                sessionId: agentsAppContext.metadata?.sessionId
              })

              if (retrievalResult && retrievalResult.results && retrievalResult.results.length > 0) {
                knowBContextMessage = {
                  role: 'assistant',
                  content: `# Relevant Documentation\n\nHere is relevant documentation from the knowledge base that may help answer this question:\n\n${retrievalResult.content}\n\n---\n*Use this documentation to inform your response, but respond naturally without explicitly referencing it unless directly relevant.*`,
                  insertionOrder: 'before_history'
                }
              }
            } catch (error) {
              logger.warn('websocket.context.knowb.error', {
                error: error instanceof Error ? error.message : String(error),
                query: userMessage.substring(0, 100)
              })
              // Continue without KnowB context if search fails
            }
          }

          logger.info('websocket.context.provider.success', {
            message: 'Built context messages',
            messageCount: contextResult.contextMessages.length + (dynamicDataMessage ? 1 : 0) + (todoContextMessage ? 1 : 0) + (knowBContextMessage ? 1 : 0),
            hasDynamicData: !!dynamicDataMessage,
            hasTodoContext: !!todoContextMessage,
            hasKnowBContext: !!knowBContextMessage
          })

          // Collect all context messages
          const allMessages: Array<{
            role: 'user' | 'system'
            content: string
            insertionOrder: 'before_history' | 'after_history'
            cachePoint?: { type: 'ephemeral' }
          }> = contextResult.contextMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
            insertionOrder: msg.insertionOrder || 'after_history',
            ...(msg.cachePoint && { cachePoint: msg.cachePoint })
          }))

          // Add dynamic data message at the end if present
          if (dynamicDataMessage) {
            allMessages.push({
              role: dynamicDataMessage.role,
              content: dynamicDataMessage.content,
              insertionOrder: dynamicDataMessage.insertionOrder
            })
          }

          // Add todo context message if present
          if (todoContextMessage) {
            allMessages.push({
              role: todoContextMessage.role as 'user' | 'system',
              content: todoContextMessage.content,
              insertionOrder: todoContextMessage.insertionOrder
            })
          }

          // Add KnowB documentation context if present
          if (knowBContextMessage) {
            allMessages.push({
              role: knowBContextMessage.role as 'user' | 'system',
              content: knowBContextMessage.content,
              insertionOrder: knowBContextMessage.insertionOrder
            })
          }

          return allMessages
        } catch (error) {
          logger.error('websocket.context.provider.failure', {
            message: 'Error loading context',
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            details: error,
          })
          return []
        }
      }
    }

    // Create message provider implementation for conversation history
    const messageProvider: MessageProvider = {
      async loadMessages(conversationId: string, context: Record<string, unknown>): Promise<ConversationMessage[]> {
        if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
          logger.debug('websocket.message.provider.loading', {
            message: 'Loading conversation messages',
            conversationId
          })
        }

        // Extract appId and agentName from context for logging
        const metadata = (context?.metadata as any) || {}
        const appId = metadata.appId
        const agentName = metadata.agentId || 'develop'

        if (!conversationId) {
          logger.warn('websocket.message.provider.no_conversation_id', {
            message: 'No conversationId provided, cannot load conversation history'
          })
          return []
        }

        const contextLogger = log.withContext({ conversationId, appId, agentId: agentName })

        if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
          contextLogger.debug('websocket.message.provider.loading_messages', {
            message: 'Loading messages by conversationId'
          })
        }

        try {
          const appRepo = new AppRepository();
          const app = appRepo.findById(appId);
          const appPath = app?.path;
          
          const modelName = metadata.modelName || 'sonnet';
          const historyLoader = conversationContextManager.getHistoryLoader();
          
          const llmMessages = await historyLoader.loadMessagesWithSummarization(
            appId,
            40000,
            modelName,
            true,
            appPath,
            true
          );
          
          const formattedMessages = historyLoader.formatMessagesForAISDK(llmMessages, appId, agentName);
          
          return formattedMessages;
        } catch (error) {
          logger.error('websocket.message.provider.failure', {
            message: 'Error in MessageProvider',
            conversationId,
            error: error instanceof Error ? error.message : String(error)
          })
          return []
        }
      }
    }

    // Create the WebSocket server with the agent factory and built-in persistence
    const wsServerConfig = {
      agents: agentFactory.agents,

      // State manager for agent handoffs
      stateManager: agentFactory.stateManager,

      // Built-in message persistence
      messagePersistence,

      // Message provider for conversation history
      messageProvider,

      // Context provider for app context and templates
      contextProvider,

      // APM agent for tool execution tracking
      apmAgent: apm,

      // Function to get active transaction for a socket
      getActiveTransaction: (socketId: string) => {
        return activeWebSocketTransactions.get(`${socketId}:message`)
      },

      // File path resolver for uploaded files
      filePathResolver: (appId: string, uploadId: string, filename: string) => {
        return fileUploadService.getFilePath(appId, uploadId, filename)
      },

      // Agent routing hook - select initial agent for new apps
      agentRouter: (socketId: string, data: any) => {
        // Check for manual agent override in message content
        // Format: /agent <agent-name> on first line
        if (data.message && typeof data.message === 'string') {
          const firstLine = data.message.split('\n')[0].trim()
          const agentOverrideMatch = firstLine.match(/^\/agent\s+(\w+)$/i)
          
          if (agentOverrideMatch) {
            const requestedAgent = agentOverrideMatch[1].toLowerCase()
            logger.info('websocket.agent_router.manual_override', {
              socketId,
              requestedAgent,
              message: 'Manual agent override detected in message'
            })
            return requestedAgent
          }
        }

        const metadata = data.context?.metadata as any
        const appId = metadata?.appId
        
        if (!appId) {
          logger.debug('websocket.agent_router.no_app_id', {
            socketId,
            message: 'No appId in context, using default agent'
          })
          return 'develop'
        }

        // Check if session already has an active agent (set by previous routing or handoff)
        // This check happens BEFORE conversation history check so that the initial agent
        // can receive follow-up messages (like attribute answers) until it hands off
        const currentAgent = stateManager.getCurrentAgent?.(socketId)
        const sessionAppId = stateManager.getSessionMetadata?.(socketId)?.appId
        
        // If session has an agent AND it's for the same app, use it
        if (currentAgent && sessionAppId === appId) {
          logger.debug('websocket.agent_router.session_agent', {
            socketId,
            appId,
            currentAgent,
            message: 'Using agent from session state'
          })
          return currentAgent
        }

        // If session exists but app changed, clear it
        if (currentAgent && sessionAppId && sessionAppId !== appId) {
          logger.info('websocket.agent_router.app_changed', {
            socketId,
            oldAppId: sessionAppId,
            newAppId: appId,
            oldAgent: currentAgent,
            message: 'App changed, clearing session state'
          })
          stateManager.clearSession?.(socketId)
        }

        // Check conversation history to determine if this is a new app
        const conversations = conversationRepository.getByAppIdSync(appId)
        const isNewApp = conversations.length === 0
        
        if (isNewApp) {
          logger.info('websocket.agent_router.initial_selected', {
            socketId,
            appId,
            message: 'New app detected, routing to initial agent and setting session state'
          })
          
          // Set the initial agent in session state so subsequent messages continue with it
          // This ensures the initial agent receives follow-up messages (like attribute answers)
          // until it explicitly hands off to develop agent
          stateManager.switchAgent(socketId, 'initial').catch(error => {
            logger.error('websocket.agent_router.session_state_error', {
              socketId,
              appId,
              error: error instanceof Error ? error.message : String(error),
              message: 'Failed to set initial agent in session state'
            })
          })
          
          // Also set the appId in session metadata for tracking
          stateManager.setSessionMetadata?.(socketId, { appId })
          
          return 'initial'
        }
        
        logger.debug('websocket.agent_router.develop_selected', {
          socketId,
          appId,
          conversationCount: conversations.length,
          message: 'Existing app, using develop agent'
        })
        return 'develop'
      },

      // Socket.IO options for handling large payloads (screenshots, etc.)
      socketOptions: {
        maxHttpBufferSize: 10 * 1024 * 1024,
        cors: {
          origin: "*",
          methods: ["GET", "POST"],
          credentials: true
        }
      },

      // Token usage tracking (independent of persistence)
      onTokenUsage: async (usage: {
        inputTokens: number
        outputTokens: number
        totalTokens: number
        cachedInputTokens?: number
        cacheWriteInputTokens?: number
      }, metadata: {
        agentName: string
        modelName: string
        conversationId?: string
        appId?: string
        context?: Record<string, unknown>
      }) => {
        // Only track if we have appId
        if (!metadata.appId) {
          logger.warn('websocket.token_usage.no_app_id', {
            agentName: metadata.agentName,
            modelName: metadata.modelName,
            conversationId: metadata.conversationId
          })
          return
        }

        try {
          // Calculate accurate cost including cache pricing
          const costEstimate = calculateCostEstimate(
            {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
              ...(usage.cachedInputTokens !== undefined && { cachedInputTokensRead: usage.cachedInputTokens }),
              ...(usage.cacheWriteInputTokens !== undefined && { cachedInputTokensWrite: usage.cacheWriteInputTokens })
            },
            metadata.modelName
          )

          // Record to database
          const tokenUsageRepo = new TokenUsageRepository()
          await tokenUsageRepo.recordUsage(
            metadata.appId,
            'llm_request',
            usage.inputTokens,
            usage.outputTokens,
            {
              model: metadata.modelName,
              conversationId: metadata.conversationId,
              description: `Agent: ${metadata.agentName}${!metadata.conversationId ? ' (no conversation)' : ''}`,
              cacheReadTokens: usage.cachedInputTokens,
              cacheWriteTokens: usage.cacheWriteInputTokens,
              cost: costEstimate.totalCost
            }
          )

          // Track in APM
          messagePersistence.trackTokenUsageInAPM(
            'main_agent',
            {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
              cacheReadTokens: usage.cachedInputTokens || 0,
              cacheWriteTokens: usage.cacheWriteInputTokens || 0,
            },
            {
              conversationId: metadata.conversationId || 'unknown',
              appId: metadata.appId,
              agentName: metadata.agentName,
              modelName: metadata.modelName,
            }
          )

          logger.info('websocket.token_usage.tracked', {
            appId: metadata.appId,
            agentName: metadata.agentName,
            modelName: metadata.modelName,
            conversationId: metadata.conversationId,
            totalTokens: usage.totalTokens,
            cost: costEstimate.totalCost,
            hasConversation: !!metadata.conversationId
          })
        } catch (error) {
          logger.error('websocket.token_usage.tracking_failed', {
            error: error instanceof Error ? error.message : String(error),
            appId: metadata.appId,
            agentName: metadata.agentName
          })
        }
      },

      // Context extractor to validate appId
      // NOTE: _userMessage is set in processContext() in ai-lib, NOT here
      // because contextExtractor only receives data.context, not data.message
      contextExtractor: (rawContext: Record<string, unknown>, _socketContext?: any) => {
        // Extract appId from context metadata
        const metadata = rawContext.metadata as any
        const appId = metadata?.appId

        if (!appId || typeof appId !== 'string') {
          throw new Error('appId is required in context.metadata.appId')
        }

        // Authentication already validated at WebSocket handshake
        const contextLogger = log.forApp(appId);
        contextLogger.debug('websocket.context.validated', {
          message: 'Context validated - authentication passed at handshake',
          contextKeys: Object.keys(rawContext),
          hasMetadata: !!rawContext.metadata,
          hasAppContext: !!rawContext.appContext,
          hasVisualContext: !!rawContext.visualContext,
          hasAiEditContext: !!rawContext.aiEditContext,
          hasSelectedAssets: !!(rawContext as any).selectedAssets,
          hasConversation: !!rawContext.conversation
        });

        return rawContext;
      },

      // Connection handler
      onConnection: async (socketId: string) => {
        logger.info('websocket.connection.connected', {
          message: 'WebSocket client connected',
          socketId
        })

        // Start APM transaction for WebSocket connection lifecycle
        const transaction = apm.startTransaction('WebSocket Connection', 'websocket')
        if (transaction) {
          transaction.setLabel('socket_id', socketId)
          transaction.setLabel('event', 'connection')
          activeWebSocketTransactions.set(socketId, transaction)

          logger.debug('apm.websocket.transaction.started', {
            socketId,
            transactionName: transaction.name
          })
        }
      },

      // Optional event handlers (persistence is now handled automatically)
      onMessageStart: async (socketId: string, message: string, agentName?: string, context?: Record<string, unknown>) => {
        // Extract siteId from context metadata (which comes from the client)
        const typedContext = context as AgentsAppContext;
        const siteId = typedContext?.metadata?.appId;

        if (!siteId) {
          throw new Error('siteId is required in context.metadata.appId but was not provided');
        }

        const contextLogger = log.forApp(siteId);

        // Create/get ClientActionService for this socket
        const conversationId = typedContext?.conversation?.conversationId || 'default'
        getOrCreateClientActionService(socketId, conversationId)

        // Debug: Log what context we received
        logger.debug('websocket.message.context_debug', {
          message: 'Message start context debug',
          hasContext: !!context,
          contextKeys: context ? Object.keys(context) : [],
          siteId
        });

        // Start APM transaction for message processing
        const messageTransaction = apm.startTransaction(
          'WebSocket Message',
          'websocket-message'
        )
        if (messageTransaction) {
          messageTransaction.setLabel('socket_id', socketId)
          messageTransaction.setLabel('app_id', siteId)
          messageTransaction.setLabel('agent_name', agentName || 'default')
          messageTransaction.setLabel('message_length', message.length)
          messageTransaction.setLabel('event', 'message_start')

          // Add session and conversation IDs if available
          if (typedContext?.metadata?.sessionId) {
            messageTransaction.setLabel('session_id', typedContext.metadata.sessionId)
          }
          if (typedContext?.metadata?.userId) {
            messageTransaction.setLabel('user_id', typedContext.metadata.userId)
          }
          if (typedContext?.conversation?.conversationId) {
            messageTransaction.setLabel('conversation_id', typedContext.conversation.conversationId)
          }

          // Store transaction with a message-specific key
          activeWebSocketTransactions.set(`${socketId}:message`, messageTransaction)

          logger.debug('apm.websocket.message.transaction.started', {
            socketId,
            siteId,
            agentName,
            sessionId: typedContext?.metadata?.sessionId,
            userId: typedContext?.metadata?.userId,
            conversationId: typedContext?.conversation?.conversationId,
            transactionName: messageTransaction.name
          })
        }

        // Git hook: ALWAYS check git state at message start (recovery + branch management)
        // CRITICAL: This ensures if previous squash merge failed, we recover before processing
        try {
          // Extract conversationId if available for better tracking
          const conversationId = typedContext?.conversation?.conversationId;
          
          await gitHookService.handleMessageStart(
            siteId,
            conversationId,
            socketId,
            message // Pass user prompt for commit message generation
          );
          
          contextLogger.debug('websocket.git_hook.message_start.success', {
            message: 'Git hook message start completed (recovery check and branch management)',
            conversationId
          });
        } catch (error) {
          contextLogger.warn('websocket.git_hook.message_start.error', {
            message: 'Git hook message start failed (non-blocking)',
            error: error instanceof Error ? error.message : String(error)
          });
        }

        // Authentication already done at handshake - just log the message start

        logger.info('websocket.message.start', {
          message: 'WebSocket message from site',
          siteId,
          messagePreview: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
          agentName
        });
      },

      onMessageComplete: async (socketId: string, result: any, context?: Record<string, unknown>) => {
        const duration = result.duration || 'unknown';
        const steps = result.steps || 0;
        const agentId = result.agentId || 'unknown';

        logger.info('websocket.message.completed', {
          message: 'WebSocket message completed',
          socketId,
          steps,
          duration,
          agentId
        });

        // Log site context if available (for audit purposes)
        const typedContext = context as AgentsAppContext;
        const siteId = typedContext?.metadata?.appId;

        if (!siteId) {
          logger.warn('websocket.message.completion.no_siteid', {
            message: 'No siteId found in context.metadata.appId for completion logging',
            hasContext: !!context,
            contextKeys: context ? Object.keys(context) : []
          });
          return; // Skip completion logging if no siteId
        }
        const contextLogger = log.forApp(siteId);
        contextLogger.info('websocket.request.site_completed', {
          message: 'WebSocket request completed for site'
        });

        // Git hook: Final commit and squash merge to main on message completion
        try {
          // Extract conversationId for better tracking
          const conversationId = typedContext?.conversation?.conversationId;
          
          await gitHookService.handleConnectionEnd(
            siteId,
            'complete',
            conversationId,
            socketId
          );
          
          contextLogger.debug('websocket.git_hook.connection_end.success', {
            message: 'Git hook connection end completed (squash merge to main)',
            conversationId,
            reason: 'complete'
          });
        } catch (error) {
          contextLogger.warn('websocket.git_hook.connection_end.error', {
            message: 'Git hook connection end failed (non-blocking)',
            reason: 'complete',
            error: error instanceof Error ? error.message : String(error)
          });
        }

        // End APM transaction for message processing
        const messageTransactionKey = `${socketId}:message`
        const messageTransaction = activeWebSocketTransactions.get(messageTransactionKey)
        if (messageTransaction) {
          messageTransaction.setLabel('steps', steps)
          messageTransaction.setLabel('agent_id', agentId)
          messageTransaction.setLabel('event', 'message_complete')
          
          // Add duration if available as a number
          if (typeof duration === 'number') {
            messageTransaction.setLabel('duration_ms', duration)
          }

          messageTransaction.result = 'success'
          messageTransaction.setOutcome('success')
          messageTransaction.end()

          activeWebSocketTransactions.delete(messageTransactionKey)

          logger.debug('apm.websocket.message.transaction.ended', {
            socketId,
            siteId,
            agentId,
            steps,
            duration,
            transactionName: messageTransaction.name
          })
        }
      },

      onDisconnection: async (socketId: string) => {
        logger.info('websocket.connection.disconnected', {
          message: 'WebSocket client disconnected',
          socketId
        })

        // Cleanup ClientActionService
        cleanupClientActionService(socketId)

        // Git hook: Squash merge to main on disconnection
        // Try to find appId from active branches using socketId (conversationId not available here)
        const appId = gitHookService.findAppIdBySocketId(socketId);
        
        if (appId) {
          try {
            // Get branch info to extract conversationId if available
            const branchInfo = gitHookService.getAppBranch(appId);
            const conversationId = branchInfo?.conversationId;
            
            await gitHookService.handleConnectionEnd(
              appId,
              'disconnection',
              conversationId,
              socketId
            );
            
            logger.debug('websocket.git_hook.connection_end.success', {
              message: 'Git hook connection end completed on disconnection',
              appId,
              conversationId,
              socketId,
              reason: 'disconnection'
            });
          } catch (error) {
            logger.warn('websocket.git_hook.connection_end.error', {
              message: 'Git hook connection end failed (non-blocking)',
              appId,
              socketId,
              reason: 'disconnection',
              error: error instanceof Error ? error.message : String(error)
            });
          }
        } else {
          logger.debug('websocket.git_hook.connection_end.no_app', {
            message: 'No active branch found for disconnected socket',
            socketId
          });
        }

        // End APM transaction for connection lifecycle
        const connectionTransaction = activeWebSocketTransactions.get(socketId)
        if (connectionTransaction) {
          connectionTransaction.setLabel('event', 'disconnection')
          connectionTransaction.result = 'success'
          connectionTransaction.setOutcome('success')
          connectionTransaction.end()

          activeWebSocketTransactions.delete(socketId)

          logger.debug('apm.websocket.connection.transaction.ended', {
            socketId,
            transactionName: connectionTransaction.name
          })
        }

        // Also clean up any orphaned message transaction
        const messageTransactionKey = `${socketId}:message`
        const messageTransaction = activeWebSocketTransactions.get(messageTransactionKey)
        if (messageTransaction) {
          messageTransaction.result = 'aborted'
          messageTransaction.setOutcome('unknown')
          messageTransaction.end()
          activeWebSocketTransactions.delete(messageTransactionKey)

          logger.debug('apm.websocket.message.transaction.aborted', {
            socketId,
            reason: 'Connection closed before message completion'
          })
        }
      },

      onError: async (socketId: string, error: Error, message?: string, context?: Record<string, unknown>) => {
        // Extract appId from context for git operations
        const typedContext = context as AgentsAppContext;
        const appId = typedContext?.metadata?.appId;

        // Check if this is a customer context error (auth-related)
        if (error.message.includes('customer context') ||
          error.message.includes('authentication may have failed')) {
          logger.error('websocket.error.context', {
            socketId,
            appId,
            error: error.message,
            message: message ? message.substring(0, 100) : undefined
          });
        } else {
          logger.error('websocket.error.general', {
            socketId,
            appId,
            error: error.message,
            message: message ? message.substring(0, 100) : undefined
          });
        }

        // Git hook: Squash merge to main on error (if we have appId)
        if (appId) {
          try {
            const conversationId = typedContext?.conversation?.conversationId;
            
            await gitHookService.handleConnectionEnd(
              appId,
              'error',
              conversationId,
              socketId
            );
            
            logger.debug('websocket.git_hook.connection_end.success', {
              message: 'Git hook connection end completed on error',
              appId,
              conversationId,
              socketId,
              reason: 'error'
            });
          } catch (gitError) {
            logger.warn('websocket.git_hook.connection_end.error', {
              message: 'Git hook connection end failed (non-blocking)',
              appId,
              socketId,
              reason: 'error',
              error: gitError instanceof Error ? gitError.message : String(gitError)
            });
          }
        }

        // Mark APM transactions as failed
        const messageTransactionKey = `${socketId}:message`
        const messageTransaction = activeWebSocketTransactions.get(messageTransactionKey)
        if (messageTransaction) {
          messageTransaction.setLabel('error_message', error.message)
          messageTransaction.setLabel('error_type', error.name || 'Error')
          messageTransaction.setLabel('event', 'error')
          messageTransaction.result = 'error'
          messageTransaction.setOutcome('failure')

          // Capture the error in APM
          apm.captureError(error, {
            custom: {
              socketId,
              messagePreview: message ? message.substring(0, 100) : undefined,
              transactionType: 'websocket-message'
            }
          })

          messageTransaction.end()
          activeWebSocketTransactions.delete(messageTransactionKey)

          logger.debug('apm.websocket.message.transaction.failed', {
            socketId,
            error: error.message,
            transactionName: messageTransaction.name
          })
        }

        // Also mark connection transaction if it exists
        const connectionTransaction = activeWebSocketTransactions.get(socketId)
        if (connectionTransaction) {
          connectionTransaction.setLabel('error_message', error.message)
          connectionTransaction.setLabel('has_error', 'true')
        }
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wsServer = createWebSocketServer(httpServer, wsServerConfig as any)

    logger.info('websocket.server.ready', {
      message: 'AgentFactory WebSocket server ready for connections',
      availableAgents: agentFactory.getAvailableAgents().map(a => a.id),
      defaultAgent: 'develop',
      agentCount: agentFactory.getAgentCount(),
      multiAgentMode: agentFactory.isMultiAgentMode(),
      features: {
        agentHandoffs: true,
        toolExecutionHooks: true,
        handoffHistoryTracking: true,
        conversationPersistence: true,
        conversationHistoryLoading: true
      }
    })

    // Store io instance for use in other services
    ioInstance = wsServer.getIO()

    // Add Socket.IO authentication middleware
    wsServer.getIO().use(async (socket, next) => {
      try {
        // Handle different authentication types via centralized feature system
        const authType = auth.getType();

        if (authType === AuthType.NONE) {
          // No authentication required (local development)
          socket.handshake.auth = {
            ...socket.handshake.auth, // Keep previousSocketId!
            siteId: auth.getSiteId(AuthType.NONE)
          };
          next();
          return;
        }

        if (authType === AuthType.MOCK) {
          // Mock authentication for testing
          socket.handshake.auth = {
            ...socket.handshake.auth, // Keep previousSocketId!
            siteId: auth.getSiteId(AuthType.MOCK)
          };
          next();
          return;
        }

        // Debug: Log handshake details
        logger.info('websocket.auth.handshake_debug', {
          message: 'WebSocket handshake details',
          hasAuth: !!socket.handshake.auth,
          authKeys: socket.handshake.auth ? Object.keys(socket.handshake.auth) : [],
          hasAuthHeader: !!socket.handshake.headers.authorization,
          authHeaderPreview: socket.handshake.headers.authorization ?
            socket.handshake.headers.authorization.substring(0, 20) + '...' : 'none',
          allHeaders: Object.keys(socket.handshake.headers),
          url: socket.handshake.url,
          query: socket.handshake.query
        });

        // Extract JWT token from handshake (check auth object and headers only)
        let token = null;


        // First try Socket.IO auth object (this should work for WebSocket transport)
        if (socket.handshake.auth && socket.handshake.auth.token) {
          token = socket.handshake.auth.token;
          logger.info('websocket.auth.token_source', { message: 'JWT token found in handshake.auth.token' }, { tags: ['security'] });
        }
        // Fallback to Authorization header (works for polling transport)
        else if (socket.handshake.headers.authorization) {
          const authHeader = socket.handshake.headers.authorization;
          if (authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
            logger.info('websocket.auth.token_source', { message: 'JWT token found in Authorization header' }, { tags: ['security'] });
          }
        }

        if (!token) {
          logger.error('websocket.auth.no_token', {
            message: 'No JWT token found in handshake',
            hasAuth: !!socket.handshake.auth,
            hasAuthHeader: !!socket.handshake.headers.authorization
          }, {
            tags: ['security']
          });
          throw new Error('Missing or invalid Authorization header');
        }

        // Validate JWT using JWKS endpoint
        logger.info('websocket.auth.jwt_validation.start', {
          message: 'Validating JWT token using public key'
        }, {
          tags: ['security']
        });

        const validationResult = await jwtAuthMiddleware.jwtValidator.validateToken(token);

        if (!validationResult.valid) {
          logger.warn('websocket.auth.connection_rejected', {
            message: 'CONNECTION REJECTED: JWT validation failed',
            reason: validationResult.reason
          }, {
            tags: ['security']
          });
          throw new Error(`JWT validation failed: ${validationResult.reason}`);
        }

        // Validate token TTL for WebSocket connections (must be 10 minutes or less)
        const agentContext = {
          siteId: validationResult.claims?.siteId || '',
          exp: validationResult.claims?.exp || 0,
          iat: validationResult.claims?.iat || 0
        };

        const ttlValidation = jwtAuthMiddleware.validateWebSocketTokenTTL(agentContext);
        if (!ttlValidation.valid) {
          logger.warn('websocket.auth.connection_rejected.ttl', {
            message: 'CONNECTION REJECTED: Token TTL validation failed',
            error: ttlValidation.error,
            tokenTTL: agentContext.exp - agentContext.iat,
            maxAllowed: 600
          });
          throw new Error(ttlValidation.error || 'Token TTL validation failed');
        }

        logger.info('websocket.auth.connection_approved', {
          message: 'Connection approved: JWT validation passed',
          siteId: validationResult.claims?.siteId,
          tokenTTL: agentContext.exp - agentContext.iat,
        }, {
          tags: ['security']
        });

        // Store validated context in socket for reuse
        // Preserve any existing auth data (like previousSocketId for recovery)
        const originalAuth = socket.handshake.auth;
        socket.handshake.auth = {
          ...originalAuth, // Preserve original auth data including previousSocketId
          token,
          decoded: validationResult.claims,
          agentContext
        };

        // Debug: Log final auth object
        logger.info('websocket.auth.final', {
          message: 'Final auth object after processing',
          authKeys: Object.keys(socket.handshake.auth),
          hasPreviousSocketId: !!(socket.handshake.auth as any).previousSocketId,
          previousSocketId: (socket.handshake.auth as any).previousSocketId || 'none'
        });

        // Add token refresh handler for this socket
        socket.on('tokenRefresh', async (data) => {
          try {
            logger.info('websocket.auth.token_refresh.requested', {
              message: 'Token refresh requested',
              siteId: socket.handshake.auth.siteId
            }, {
              tags: ['security']
            });

            const refreshResult = await jwtAuthMiddleware.jwtValidator.validateToken(data.newToken);

            if (!refreshResult.valid) {
              logger.warn('websocket.auth.token_refresh.failed', {
                message: 'Token refresh failed',
                reason: refreshResult.reason
              }, {
                tags: ['security']
              });
              socket.emit('tokenRefreshError', { error: refreshResult.reason });
              return;
            }

            // Validate TTL for refreshed token
            const refreshAgentContext = {
              siteId: refreshResult.claims?.siteId || '',
              exp: refreshResult.claims?.exp || 0,
              iat: refreshResult.claims?.iat || 0
            };

            const refreshTTLValidation = jwtAuthMiddleware.validateWebSocketTokenTTL(refreshAgentContext);
            if (!refreshTTLValidation.valid) {
              logger.warn('websocket.auth.token_refresh.ttl_failed', {
                message: 'Token refresh TTL validation failed',
                error: refreshTTLValidation.error,
                tokenTTL: refreshAgentContext.exp - refreshAgentContext.iat
              });
              socket.emit('tokenRefreshError', { error: refreshTTLValidation.error });
              return;
            }

            // Update socket auth data with new token
            socket.handshake.auth = {
              token: data.newToken,
              decoded: refreshResult.claims,
              agentContext: refreshAgentContext
            };

            logger.info('websocket.auth.token_refresh.success', {
              message: 'Token refreshed successfully',
              siteId: refreshResult.claims?.siteId,
              tokenTTL: refreshAgentContext.exp - refreshAgentContext.iat,
              expiryTime: new Date((refreshResult.claims?.exp || 0) * 1000).toISOString()
            }, {
              tags: ['security']
            });
            socket.emit('tokenRefreshSuccess', {
              newExpiry: refreshResult.claims?.exp,
              siteId: refreshResult.claims?.siteId
            });

          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('websocket.auth.token_refresh.error', {
              message: 'Token refresh error',
              error: errorMessage
            }, {
              tags: ['security']
            });
            socket.emit('tokenRefreshError', { error: errorMessage });
          }
        });

        next(); // Allow connection

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('websocket.auth.socket_auth_failed', {
          message: 'Socket.IO auth failed',
          error: errorMessage
        });
        next(new Error(`Authentication failed: ${errorMessage}`));
      }
    });

    return { wsServer, agentFactory }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('websocket.server.setup.failure', {
      message: 'Failed to setup AgentFactory WebSocket server',
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    })
    throw error
  }
}

/**
 * Get WebSocket server info for health checks
 */
export function getWebSocketServerInfo() {
  return {
    agentIds: Object.keys(aiLibAgentMetadata),
    agentMetadata: aiLibAgentMetadata,
    defaultAgent: 'develop',
    totalAgents: Object.keys(aiLibAgentMetadata).length,
    serverType: 'AgentFactory',
    features: [
      'agent-handoffs',
      'tool-execution-hooks',
      'handoff-history-tracking',
      'dynamic-system-prompts',
      'multi-agent-coordination'
    ]
  }
}

/**
 * Get the Socket.IO instance for emitting events from other services
 * 
 * @returns Socket.IO server instance or null if not initialized
 * 
 * @example
 * ```typescript
 * const io = getSocketIO();
 * if (io) {
 *   io.emit('oauth:result', { success: true, appId, state });
 * }
 * ```
 */
export function getSocketIO() {
  return ioInstance
}
