/**
 * AI-Lib WebSocket Server Implementation
 * Uses AgentFactory system for modern agent management
 */

import { Server as HTTPServer } from 'node:http'
import { calculateCostEstimate, type AgentWrapper } from '@airo/ai-lib'
import {
  createWebSocketServer,
  type MessageProvider,
  type ContextProvider,
  type ConversationMessage,
  type HistoryProvider,
  type PersistedMessage,
} from '@airo/ai-transport'
import { grantSessionManager, type GrantContextPayload, BudgetOverride } from '@airo/ai-grants'
import { getBudgetServiceClient } from '../services/budget-service-instance.js'
import { performBudgetPreCheck } from './budget-pre-check.js'
import { toBudgetUpdatePayload } from '@airo/ai-lib/budget'
import { auth, AuthType, BYPASS_SITE_IDS } from '../services/features.js'
import { getTemplateIds } from '../agents/template-registry.js'
import { isEmployeeAuthType, type AuthType as TokenAuthType, type ProductType } from '@airo/shared/auth'
import apm from 'elastic-apm-node'
import { observe, updateActiveObservation } from '@langfuse/tracing'
import type { Socket, Server as SocketIOServer } from 'socket.io'


// Define ContextMessage interface locally (extends ConversationMessage with required insertionOrder)
interface ContextMessage {
  role: 'user' | 'system'
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
import {
  attachConnectThenAuthPendingInboundGate,
  finalizeConnectThenAuthSessionReady,
} from './connect-then-auth-session.js'
import { ConversationContextManager } from '../services/ConversationContextManager.js'

import { ConversationRepository } from '../database/repositories/ConversationRepository.js'
import { fileUploadService } from '../services/FileUploadService.js'
import { logger, log } from '../logging/index.js'
import { jwtAuthMiddleware, buildAgentContext, type AgentContext } from './middleware/jwt-auth.js'
import { getAgentConfig } from '../services/features.js'
import { runWithModelOverride } from '@airo/ai-lib'
import { resolveProfile, runWithProfile, profileValue } from '../profiles/index.js'
import { getModelOverride } from '../utils/model-selection.js'
import {
  guardAllowedOverrideModel,
  resolveOverride,
} from './model-override.js'
import { todoListIdFromContextAttachments } from '../utils/todo-list-id-from-context-attachments.js'
import {
  calculateCacheMetrics,
  calculateContextWindowUtilization
} from '../utils/model-context-window.js'
import type { AgentsAppContext } from '../types/websocket-context.js'
import { AppRepository } from '../database/repositories/AppRepository.js'
import { initializeContextRegistry } from '../services/initializeContextRegistry.js'
import { KnowBDriver } from '../tools/ai-lib-tools/drivers/knowb-driver.js'
import {
  getKnowledgeServiceDriver,
} from '../tools/ai-lib-tools/drivers/knowledge-service-driver.js'
import { GitHookService } from '../services/git-hook-service.js'
import { ClientActionService } from '../services/ClientActionService.js'
import { hasUnbuiltRebuildPages } from '../tools/ai-lib-tools/suggested-response.js'
import { getAssessmentAgent, type AssessmentOutcome } from '../agents/assessment-agent/index.js'

/**
 * Shared AppRepository instance to avoid repeated initialization
 */
const appRepo = new AppRepository()

/**
 * RAG documentation search: uses knowledge-service when KNOWLEDGE_SERVICE_URL or
 * KNOWLEDGE_PROXY_URL is set, otherwise falls back to KnowB. Both drivers share
 * the same result interface.
 */
async function searchDocumentation(params: {
  query: string
  kbNodeIds: string[]
  maxResults: number
  scoreThreshold: number
  appId?: string | undefined
  sessionId?: string | undefined
}) {
  const knowledgeDriver = getKnowledgeServiceDriver()
  const usingKnowledgeService = !!knowledgeDriver

  updateActiveObservation({
    metadata: {
      retrievalType: 'semantic_search',
      retrievalBackend: usingKnowledgeService ? 'knowledge-service' : 'knowb',
      appId: params.appId,
      sessionId: params.sessionId,
      maxResults: params.maxResults,
      scoreThreshold: params.scoreThreshold
    }
  })

  const driver = knowledgeDriver ?? new KnowBDriver()

  const result = await driver.search({
    query: params.query,
    kbNodeIds: params.kbNodeIds,
    maxResults: params.maxResults,
    scoreThreshold: params.scoreThreshold,
  })

  if (!result.success || !result.results || result.results.length === 0) {
    updateActiveObservation({
      metadata: {
        documentsRetrieved: 0,
        noResults: true
      }
    })
    return null
  }

  const docsContent = driver.formatResultsAsMarkdown(result.results)

  updateActiveObservation({
    metadata: {
      documentsRetrieved: result.results.length,
      avgScore: result.results.reduce((sum, r) => sum + (r.score || 0), 0) / result.results.length,
      allScoresAboveThreshold: result.results.every(r => (r.score || 0) >= params.scoreThreshold),
      documentIds: result.results.map(r => r.kbNodeId).filter(Boolean)
    }
  })

  return {
    content: docsContent,
    results: result.results,
    count: result.results.length
  }
}

/**
 * Traced RAG search with automatic Langfuse tracing.
 * Uses knowledge-service when configured, falls back to KnowB.
 */
const tracedSearchDocumentation = observe(searchDocumentation, {
  name: 'Documentation Retrieval',
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
 * Map to track connection start times for quality monitoring.
 * Key: socketId, Value: Date.now() at connection.
 * Socket.IO guarantees `disconnect` fires for established connections, so entries
 * are always cleaned up in onDisconnection. As a safety net against edge cases
 * (e.g., framework bugs), entries older than MAX_CONNECTION_TRACKING_AGE_MS are
 * pruned when the map exceeds PRUNE_THRESHOLD_SIZE.
 */
const connectionStartTimes = new Map<string, number>()
const MAX_CONNECTION_TRACKING_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours
const PRUNE_THRESHOLD_SIZE = 1000

// Tracks initial-prompt metadata per socket for funnel events in onMessageComplete/onError
// Populated in onMessageStart, consumed and cleaned up in onMessageComplete/onError/onDisconnection
const initialPromptMetadata = new Map<string, { isInitialPrompt: boolean; customerId?: string; agentName?: string; startTime: number }>();

// Track assessment outcomes per socket for surfacing in completion
// Populated in onMessageStart, consumed in onMessageComplete, cleaned up in onDisconnection
const assessmentOutcomes = new Map<string, AssessmentOutcome>()

// Track pending budget overrides from assessment to apply in context provider
// Populated in onMessageStart, consumed in contextProvider, cleaned up in onDisconnection
const pendingBudgetOverrides = new Map<string, string>()

// Cache last user message per socket for assessment multi-turn context
const lastUserMessageCache = new Map<string, string>()

/**
 * Socket.IO server instance for emitting events
 * Exported for use in other services (e.g., OAuth result notifications)
 */
let ioInstance: SocketIOServer | null = null

/**
 * Retrieve a Socket.IO socket by its server-generated ID.
 *
 * SECURITY: This is safe because:
 * 1. Socket IDs are generated by the server as random UUIDs
 * 2. They cannot be guessed or enumerated by external actors
 * 3. Each socket was authenticated during the handshake phase
 * 4. Users cannot access another user's socket without their valid JWT
 *
 * @param socketId - Server-generated socket ID to retrieve
 * @returns Socket instance or null if not found or on error
 */
function getSocket(socketId: string | undefined): Socket | null {
  if (!socketId || !ioInstance) {
    return null
  }

  try {
    return ioInstance.sockets.sockets.get(socketId) ?? null
  } catch (error) {
    logger.error('websocket.socket_get_error', {
      socketId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return null
  }
}

/**
 * Client Action Service registry
 * Maps socketId -> ClientActionService for client-side tool execution
 */
const clientActionServices = new Map<string, ClientActionService>()

/**
 * Memory tracking data for request-scoped memory monitoring
 * Stored separately from context.metadata to avoid polluting the metadata contract
 */
interface MemoryTrackingData {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  timestamp: number;
}

/**
 * Map to track memory usage per socket request
 * Key: socketId, Value: memory snapshot at request start
 * Cleaned up on request completion or socket disconnection
 */
const requestMemoryTracking = new Map<string, MemoryTrackingData>()

/**
 * Threshold in bytes for high memory usage warnings
 * Configurable via MEMORY_HIGH_USAGE_THRESHOLD_MB env var (default: 50MB)
 * This value was chosen based on typical request memory footprint analysis -
 * requests exceeding 50MB delta often indicate inefficient operations or potential leaks
 */
const MEMORY_HIGH_USAGE_THRESHOLD_BYTES = (
  parseInt(process.env.MEMORY_HIGH_USAGE_THRESHOLD_MB || '50', 10) * 1024 * 1024
)

/**
 * Unified cleanup for message finalization across all termination paths.
 * Handles memory tracking cleanup, APM transaction end, and logging.
 * Called from onMessageComplete, onError, and onDisconnection.
 */
function finalizeMessage(
  socketId: string,
  reason: 'complete' | 'error' | 'aborted',
  meta?: { appId?: string; agentId?: string; steps?: number; duration?: number; error?: Error }
): void {
  // 1. Clean up memory tracking (fixes leak: was missing from onError/onDisconnection)
  const startTracking = requestMemoryTracking.get(socketId)
  if (startTracking) {
    const endMemory = process.memoryUsage()
    const heapDelta = endMemory.heapUsed - startTracking.heapUsed
    const rssDelta = endMemory.rss - startTracking.rss
    const requestDuration = Date.now() - startTracking.timestamp

    logger.info('memory.request.complete', {
      appId: meta?.appId,
      socketId,
      agentId: meta?.agentId,
      reason,
      heapUsedBytes: endMemory.heapUsed,
      heapTotalBytes: endMemory.heapTotal,
      rssBytes: endMemory.rss,
      heapDeltaBytes: heapDelta,
      rssDeltaBytes: rssDelta,
      requestDurationMs: requestDuration,
      steps: meta?.steps,
    })

    if (heapDelta > MEMORY_HIGH_USAGE_THRESHOLD_BYTES) {
      logger.warn('memory.request.high_usage', {
        appId: meta?.appId,
        socketId,
        agentId: meta?.agentId,
        heapDeltaBytes: heapDelta,
        heapUsedBytes: endMemory.heapUsed,
        thresholdBytes: MEMORY_HIGH_USAGE_THRESHOLD_BYTES,
        steps: meta?.steps,
      })
    }

    requestMemoryTracking.delete(socketId)
  } else {
    logger.debug('memory.request.tracking_missing', {
      appId: meta?.appId,
      socketId,
      reason: `No start tracking data found (finalize reason: ${reason})`,
    })
  }

  // 2. End APM message transaction with appropriate status
  const messageTransactionKey = `${socketId}:message`
  const messageTransaction = activeWebSocketTransactions.get(messageTransactionKey)
  if (messageTransaction) {
    if (meta?.steps !== undefined) messageTransaction.setLabel('steps', meta.steps)
    if (meta?.agentId) messageTransaction.setLabel('agent_id', meta.agentId)
    // Preserve original APM event label values for dashboard compatibility
    const eventLabel = reason === 'complete' ? 'message_complete' : reason === 'error' ? 'error' : 'disconnection'
    messageTransaction.setLabel('event', eventLabel)

    if (typeof meta?.duration === 'number') {
      messageTransaction.setLabel('duration_ms', meta.duration)
    }

    if (reason === 'error' && meta?.error) {
      messageTransaction.setLabel('error_message', meta.error.message)
      messageTransaction.setLabel('error_type', meta.error.name || 'Error')
      messageTransaction.result = 'error'
      messageTransaction.setOutcome('failure')
      apm.captureError(meta.error, {
        custom: { socketId, transactionType: 'websocket-message' }
      })
    } else if (reason === 'aborted') {
      messageTransaction.result = 'aborted'
      messageTransaction.setOutcome('unknown')
    } else {
      messageTransaction.result = 'success'
      messageTransaction.setOutcome('success')
    }

    messageTransaction.end()
    activeWebSocketTransactions.delete(messageTransactionKey)

    logger.debug(`apm.websocket.message.transaction.${reason}`, {
      socketId,
      appId: meta?.appId,
      transactionName: messageTransaction.name,
    })
  }
}

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
      sections.push(
        `Preview URL (draft builder only; not for custom-domain DNS): ${app.previewUrl}`
      )
    }
  }

  return {
    role: 'user',
    content: `## Dynamic Context\n\n${sections.join('\n')}`,
    insertionOrder: 'after_history'
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

  let backgroundSummarizer: {
    checkAndSummarize(appId: string, triggerTokenCount?: number, budgetOverride?: BudgetOverride): Promise<void>
    getMaxPromptTokens(): number
  } | null = null

  try {
    // Initialize context attachment registry with default renderers
    initializeContextRegistry()

    // Create the agent factory with state manager
    const agentFactory = await createWebSocketAgentFactory()
    const stateManager = agentFactory.stateManager

    // Create context manager for app context and template descriptions
    const contextManager = new AILibContextManager()

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

    backgroundSummarizer = await initializeBackgroundSummarization()

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

          // Check for unbuilt rebuild pages and add to metadata
          if (agentsAppContext.metadata.appId) {
            const hasRebuildPages = await hasUnbuiltRebuildPages(agentsAppContext.metadata.appId as string)
            agentsAppContext.metadata.hasUnbuiltRebuildPages = hasRebuildPages
          }

          // Add subscriptionId and customerId to metadata for LiteLLM cost tracking
          // If E2S auth is enabled (care session), use "care" instead of the customer's subscriptionId
          const appId = agentsAppContext.metadata?.appId as string | undefined
          if (appId) {
            const app = appRepo.findById(appId)
            if (app) {
              // Get socket to check for auth type and test budget flag
              const socketId = (context as any).socketId as string | undefined
              const socket = socketId && ioInstance ? ioInstance.sockets.sockets.get(socketId) : null
              const agentContext = socket?.handshake?.auth?.agentContext as {
                isE2S?: boolean
                authType?: TokenAuthType
                useTestBudget?: boolean
                budgetServiceEnabled?: boolean
                subscriptionId?: string
              } | undefined
              // Use authType to distinguish employee sessions (e2s, e2s2s, etc.) from delegate (s2s)
              const isEmployeeSession = isEmployeeAuthType(agentContext?.authType)
              const useTestBudget = agentContext?.useTestBudget === true
              logger.info('context.auth.check', {
                appId,
                socketId: socketId || 'missing',
                hasIoInstance: !!ioInstance,
                socketFound: !!socket,
                hasHandshakeAuth: !!socket?.handshake?.auth,
                authKeys: socket?.handshake?.auth ? Object.keys(socket.handshake.auth) : [],
                authType: agentContext?.authType,
                isEmployeeSession,
                useTestBudget,
                agentContext
              })

              if (isEmployeeSession) {
                // Employee session (e2s, e2s2s, etc.): use care-agent budget (takes precedence over test budget flag)
                agentsAppContext.metadata.subscriptionId = BudgetOverride.CareAgent
                logger.info('context.care_agent_subscription', {
                  appId,
                  authType: agentContext?.authType,
                  subscriptionId: BudgetOverride.CareAgent
                })
              } else if (useTestBudget) {
                // Test budget flag enabled: use test-accounts budget
                agentsAppContext.metadata.subscriptionId = BudgetOverride.TestAccounts
                logger.info('context.test_accounts_subscription', {
                  appId,
                  useTestBudget: true,
                  subscriptionId: BudgetOverride.TestAccounts
                })
              } else {
                // Check for assessment-based budget override (task-specific budgets)
                const pendingOverride = socketId ? pendingBudgetOverrides.get(socketId) : undefined
                if (pendingOverride) {
                  // Assessment agent determined this is a special task (publish/domain/fix)
                  agentsAppContext.metadata.subscriptionId = pendingOverride
                  pendingBudgetOverrides.delete(socketId!) // Consume override - only apply once per message
                  logger.info('context.assessment_budget_override', {
                    appId,
                    socketId,
                    subscriptionId: pendingOverride,
                  })
                } else {
                  // Regular auth: use the app's subscriptionId
                  agentsAppContext.metadata.subscriptionId = app.subscriptionId
                  logger.info('context.regular_subscription', {
                    appId,
                    socketId,
                    subscriptionId: app.subscriptionId,
                    source: 'app_record',
                  })
                }
              }
              agentsAppContext.metadata.customerId = app.customerId

              // Budget Service flag: propagate to metadata for pre-execution check.
              // Skip for employee/test sessions (not subject to budget limits).
              // Use JWT subscriptionId (not app DB) since the app record can be stale.
              if (agentContext?.budgetServiceEnabled && !isEmployeeSession && !useTestBudget) {
                agentsAppContext.metadata.budgetServiceEnabled = true
                if (agentContext.subscriptionId) {
                  agentsAppContext.metadata.subscriptionId = agentContext.subscriptionId
                }
              }

              // NOTE: SSO JWT is NOT passed through context for security reasons.
              // MCP tools that need user authentication use ClientActionService to proxy
              // calls through the browser, where the auth_idp cookie is available.
              // This ensures user credentials never flow through agent context.
            }
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
            const fromAttachment = todoListIdFromContextAttachments(agentsAppContext.contextAttachments)
            const sessionSelectedId = stateManager.getSelectedTodoList(sessionId)
            let selectedTodoListId = sessionSelectedId
            if (fromAttachment) {
              selectedTodoListId = fromAttachment
              stateManager.setSelectedTodoList(sessionId, fromAttachment)
              if (sessionSelectedId && sessionSelectedId !== fromAttachment) {
                logger.info('todo.list.selection.override_from_message', {
                  sessionId,
                  previousListId: sessionSelectedId,
                  listIdFromAttachment: fromAttachment,
                  message: 'todo_list_context on user message takes precedence over session selection'
                })
              }
            }
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
          // CACHING: KnowB results are query-dependent (change every request), so they MUST be
          // inserted 'after_history' to preserve caching of stable prefix content (system prompt,
          // template, memory summary, app context). Inserting query-dependent content in
          // 'before_history' would invalidate the cache on every request.
          let ragContextMessage: ContextMessage | null = null
          const userMessage = agentsAppContext.metadata?._userMessage as string | undefined

          if (userMessage && typeof userMessage === 'string' && userMessage.trim().length > 0) {
            try {
              const retrievalResult = await tracedSearchDocumentation({
                query: userMessage,
                kbNodeIds: ['/airo_info'],
                maxResults: 5,
                scoreThreshold: 0.50,
                appId: agentsAppContext.metadata?.appId,
                sessionId: agentsAppContext.metadata?.sessionId
              })

              if (retrievalResult && retrievalResult.results && retrievalResult.results.length > 0) {
                ragContextMessage = {
                  // Use 'user' role for injected context - more natural conversation flow
                  // and avoids breaking user/assistant alternation pattern
                  role: 'user',
                  content: `[Relevant Documentation from Knowledge Base]\n\n${retrievalResult.content}\n\n---\n*Use this documentation to inform your response, but respond naturally without explicitly referencing it unless directly relevant.*`,
                  // CRITICAL: Must be 'after_history' to preserve caching of stable prefix
                  insertionOrder: 'after_history'
                }
              }
            } catch (error) {
              logger.warn('websocket.context.rag.error', {
                error: error instanceof Error ? error.message : String(error),
                query: userMessage.substring(0, 100)
              })
              // Continue without RAG context if search fails
            }
          }

          logger.info('websocket.context.provider.success', {
            message: 'Built context messages',
            messageCount: contextResult.contextMessages.length + (dynamicDataMessage ? 1 : 0) + (todoContextMessage ? 1 : 0) + (ragContextMessage ? 1 : 0),
            hasDynamicData: !!dynamicDataMessage,
            hasTodoContext: !!todoContextMessage,
            hasRagContext: !!ragContextMessage
          })

          // Collect all context messages
          // Map context messages into the allMessages array. before_history messages
          // always carry explicit insertionOrder from AILibContextManager; the fallback
          // is defensive for after_history items that might omit it.
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

          // Append additional after_history messages (see docs/prompt-caching-architecture.md).
          // contextResult.contextMessages above already includes after_history items from
          // AILibContextManager (app context, context attachments). These extra messages
          // are added here because they're built outside the context manager:
          // Segment 6: KnowB Results (query-dependent, changes every request)
          // Segment 7: Todo Context (variable)
          // Segment 8: Dynamic Data (request-specific)
          //
          // All after_history content is outside the cache breakpoint (which lands on the
          // last conversation history message), so ordering doesn't affect caching.

          // Add KnowB documentation context if present (Segment 6)
          if (ragContextMessage) {
            allMessages.push({
              role: ragContextMessage.role as 'user' | 'system',
              content: ragContextMessage.content,
              insertionOrder: ragContextMessage.insertionOrder
            })
          }

          // Add todo context message if present (Segment 7)
          if (todoContextMessage) {
            allMessages.push({
              role: todoContextMessage.role as 'user' | 'system',
              content: todoContextMessage.content,
              insertionOrder: todoContextMessage.insertionOrder
            })
          }

          // Add dynamic data message if present (Segment 8)
          if (dynamicDataMessage) {
            allMessages.push({
              role: dynamicDataMessage.role,
              content: dynamicDataMessage.content,
              insertionOrder: dynamicDataMessage.insertionOrder
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

          const modelName = getModelOverride() || metadata.modelName || 'sonnet';
          const historyLoader = conversationContextManager.getHistoryLoader();

          // SECURITY: Verify conversation belongs to authenticated appId
          // This prevents cross-tenant data exfiltration where an attacker sends a valid
          // appId (their own, which passes context validation) but a conversationId from
          // another tenant. We must verify the conversation.appId matches the authenticated
          // metadata.appId before loading any messages.
          const conversationRepo = new ConversationRepository();
          const conversation = await conversationRepo.getById(conversationId);

          if (!conversation) {
            contextLogger.warn('websocket.message.provider.conversation_not_found', {
              message: 'Conversation not found',
              conversationId,
              appId
            });
            return [];
          }

          // CRITICAL: Verify conversation ownership
          if (conversation.appId !== appId) {
            logger.error('websocket.message.provider.cross_tenant_attempt', {
              message: 'SECURITY VIOLATION: Cross-tenant conversation access attempt',
              authenticatedAppId: appId,
              requestedConversationId: conversationId,
              conversationAppId: conversation.appId,
              severity: 'CRITICAL'
            }, { tags: ['security', 'authorization-failure', 'cross-tenant-attempt'] });
            return [];
          }

          // SECURITY FIX: Load messages for the SPECIFIC conversation, not all app conversations
          // Previous implementation loaded ALL conversations for the app, causing:
          // 1. Privacy leak: Users could see other users' messages
          // 2. Token exhaustion: Merged history exceeded context limits
          // 3. Authorization bypass: Conversation-level access controls were ignored
          //
          // Normal message streams MUST be scoped to the active conversation.
          const llmMessages = await historyLoader.loadMessagesWithTokenLimitByConversationId(
            conversationId,  // Load ONLY this conversation's messages
            40000,
            modelName,
            true,
            appId  // Enables summary pin refresh + stable prefix compression
          );

          const formattedMessages = historyLoader.formatMessagesForAISDK(llmMessages, appId, agentName);

          contextLogger.debug('websocket.message.provider.loaded', {
            message: 'Loaded messages for specific conversation',
            conversationId,
            messageCount: formattedMessages.length
          });

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

    // Create history provider for UI display (raw database rows)
    const historyProvider: HistoryProvider = {
      async loadHistory(
        conversationId: string,
        appId: string,
        options?: { before?: string; limit?: number }
      ): Promise<{
        messages: PersistedMessage[]
        hasMore: boolean
        nextCursor: string | null
        total?: number
      }> {
        const conversationRepo = new ConversationRepository()

        try {
          const result = await conversationRepo.getMessagesPaginated(conversationId, appId, {
            limit: options?.limit ?? 20,
            before: options?.before
          })

          // Convert database format to PersistedMessage format
          // IMPORTANT: Database uses 'agent' but client expects 'assistant' - normalize here
          const messages = result.messages.map(msg => {
            let normalizedSender: 'user' | 'assistant'
            if (msg.sender === 'agent') {
              normalizedSender = 'assistant'
            } else if (msg.sender === 'user') {
              normalizedSender = 'user'
            } else {
              logger.warn('websocket.history.provider.unexpected_sender', {
                message: 'Unexpected sender value in conversation history, defaulting to assistant',
                conversationId: msg.conversationId,
                messageId: msg.id,
                sender: msg.sender
              })
              normalizedSender = 'assistant'
            }

            const persistedMsg: PersistedMessage = {
              id: msg.id,
              conversationId: msg.conversationId,
              sender: normalizedSender,
              content: msg.content,
              createdAt: msg.createdAt.toISOString()
            }

            if (msg.messageType != null) {
              persistedMsg.messageType = msg.messageType
            }
            if (msg.toolCalls != null) {
              persistedMsg.toolCalls = msg.toolCalls
            }
            if (msg.segments != null) {
              persistedMsg.segments = msg.segments
            }
            if (msg.metadata != null) {
              persistedMsg.metadata = msg.metadata
            }
            if (msg.contextAttachments != null) {
              persistedMsg.contextAttachments = msg.contextAttachments
            }
            persistedMsg.origin = msg.origin

            return persistedMsg
          })

          return {
            messages,
            hasMore: result.hasMore,
            nextCursor: result.nextCursor,
            total: result.total
          }
        } catch (error) {
          logger.error('websocket.history.provider.failure', {
            message: 'Error in HistoryProvider',
            conversationId,
            appId,
            error: error instanceof Error ? error.message : String(error)
          })
          return { messages: [], hasMore: false, nextCursor: null, total: 0 }
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

      // History provider for raw UI history (not LLM context)
      historyProvider,

      // Get latest conversation for an app (used for cookie-less recovery)
      getLatestConversationForApp: async (appId: string) => {
        const latest = await conversationRepository.getLatestForApp(appId)
        return latest?.id ?? null
      },

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
          const rawTemplateId = metadata?.templateId
          const templateId = typeof rawTemplateId === 'string' && getTemplateIds().includes(rawTemplateId)
            ? rawTemplateId
            : undefined
          let agentId = templateId ? `initial-${templateId}` : 'initial'

          if (agentId === 'initial') {
            const socket = getSocket(socketId)
            const agentContext = socket?.handshake?.auth?.agentContext
            const profile = resolveProfile({
              agentProfileSelectorEnabled: !!agentContext?.agentProfileSelectorEnabled,
              perProjectProfile: metadata?.agentProfile as string | undefined,
              jwtAgentProfile: agentContext?.agentProfile as string | undefined,
            })
            if (profile) {
              const promptVersion = runWithProfile(profile, () => profileValue('initial.promptVersion', '' as string))
              if (promptVersion === '2.0') {
                agentId = 'initial-v2'
              }
            }
          }

          logger.info('websocket.agent_router.initial_selected', {
            socketId,
            appId,
            templateId: templateId || null,
            agentId,
            message: 'New app detected, routing to initial agent and setting session state'
          })

          // Set the initial agent in session state so subsequent messages continue with it
          // This ensures the initial agent receives follow-up messages (like attribute answers)
          // until it explicitly hands off to develop agent
          stateManager.switchAgent(socketId, agentId).catch(error => {
            logger.error('websocket.agent_router.session_state_error', {
              socketId,
              appId,
              templateId: templateId || null,
              error: error instanceof Error ? error.message : String(error),
              message: 'Failed to set initial agent in session state'
            })
          })

          // Also set the appId and templateId in session metadata for tracking/observability
          stateManager.setSessionMetadata?.(socketId, { appId, templateId })

          return agentId
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
        subscriptionId?: string
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

          // Calculate cache metrics for all token usage logs
          const cacheMetrics = calculateCacheMetrics(
            usage.inputTokens,
            usage.cachedInputTokens
          )
          const contextUtilization = calculateContextWindowUtilization(
            usage.inputTokens,
            metadata.modelName
          )

          logger.info('websocket.token_usage.tracked', {
            appId: metadata.appId,
            agentName: metadata.agentName,
            modelName: metadata.modelName,
            conversationId: metadata.conversationId,
            inputTokens: usage.inputTokens,
            cachedInputTokens: cacheMetrics.cachedTokens,
            freshInputTokens: cacheMetrics.freshTokens,
            totalTokens: usage.totalTokens,
            cost: costEstimate.totalCost,
            contextWindowUtilization: contextUtilization,
            cacheHitRate: cacheMetrics.cacheHitRate,
            hasConversation: !!metadata.conversationId
          })

          if (backgroundSummarizer) {
            const maxPromptTokens = backgroundSummarizer.getMaxPromptTokens()

            if (usage.inputTokens > maxPromptTokens) {
              // Extract budget override from metadata if present (E2S or test-accounts session)
              const subscriptionId = metadata.subscriptionId
              // Check if subscriptionId is a budget override value
              const budgetOverride = (subscriptionId === BudgetOverride.CareAgent || subscriptionId === BudgetOverride.TestAccounts)
                ? subscriptionId as BudgetOverride
                : undefined

              logger.info('summarization.background.trigger.token_usage_exceeded', {
                appId: metadata.appId,
                conversationId: metadata.conversationId,
                agentName: metadata.agentName,
                modelName: metadata.modelName,
                inputTokens: usage.inputTokens,
                cachedInputTokens: cacheMetrics.cachedTokens,
                freshInputTokens: cacheMetrics.freshTokens,
                totalTokens: usage.totalTokens,
                maxPromptTokens,
                contextWindowUtilization: contextUtilization,
                cacheHitRate: cacheMetrics.cacheHitRate,
                budgetOverride,
              })
              void backgroundSummarizer.checkAndSummarize(metadata.appId, usage.inputTokens, budgetOverride)
            }
          }
        } catch (error) {
          logger.error('websocket.token_usage.tracking_failed', {
            error: error instanceof Error ? error.message : String(error),
            appId: metadata.appId,
            agentName: metadata.agentName
          })
        }
      },

      // Context extractor to validate appId and inject JWT permissions
      // NOTE: _userMessage is set in processContext() in ai-lib, NOT here
      // because contextExtractor only receives data.context, not data.message
      // SECURITY: Tenant isolation is enforced at the onConnection middleware level
      // where we have access to the socket and JWT claims
      contextExtractor: (rawContext: Record<string, unknown>, socketId?: string) => {
        // Extract appId from context metadata
        const metadata = rawContext.metadata as any
        const appId = metadata?.appId

        if (!appId || typeof appId !== 'string') {
          throw new Error('appId is required in context.metadata.appId')
        }

        // Validate socketId before using it to extract permissions
        if (!socketId) {
          logger.warn('context.extractor.no-socket-id', {
            appId,
            message: 'socketId not provided to contextExtractor - permissions will not be populated',
          })
        }

        let agentContext: any = null
        const socket = socketId ? getSocket(socketId) : null
        if (socket?.handshake?.auth?.agentContext) {
          agentContext = socket.handshake.auth.agentContext
        }

        if (agentContext) {
          // Inject JWT-based permissions and auth info into context metadata for tool access
          rawContext.metadata = {
            ...metadata,
            permissions: {
              canDownload: agentContext.canDownload ?? false,
              canPublish: agentContext.canPublish ?? false,
              canPurchaseDomain: agentContext.canPurchaseDomain ?? false,
            },
            isE2S: agentContext.isE2S ?? false,
            authType: agentContext.authType,
          }
        }

        // Authentication already validated at WebSocket handshake
        const contextLogger = log.forApp(appId);
        contextLogger.debug('websocket.context.validated', {
          message: 'Context validated - authentication passed at handshake',
          appId,
          contextKeys: Object.keys(rawContext),
          hasMetadata: !!rawContext.metadata,
          hasAppContext: !!rawContext.appContext,
          hasVisualContext: !!rawContext.visualContext,
          hasAiEditContext: !!rawContext.aiEditContext,
          hasSelectedAssets: !!(rawContext as any).selectedAssets,
          hasConversation: !!rawContext.conversation,
          hasPermissions: !!(rawContext.metadata as any)?.permissions
        });

        return rawContext;
      },

      // Connection handler - fires for fresh AND recovered connections
      onConnection: async (socketId: string, meta?: { recoveryMode?: string; previousSocketId?: string }) => {
        connectionStartTimes.set(socketId, Date.now())

        // Defensive pruning: if map grows unexpectedly large, remove stale entries
        if (connectionStartTimes.size > PRUNE_THRESHOLD_SIZE) {
          const now = Date.now()
          for (const [id, startTime] of connectionStartTimes) {
            if (now - startTime > MAX_CONNECTION_TRACKING_AGE_MS) {
              connectionStartTimes.delete(id)
            }
          }
        }

        // Start APM transaction for WebSocket connection lifecycle
        const transaction = apm.startTransaction('WebSocket Connection', 'websocket')
        if (transaction) {
          transaction.setLabel('socket_id', socketId)
          transaction.setLabel('event', 'connection')
          if (meta?.recoveryMode) {
            transaction.setLabel('recovery_mode', meta.recoveryMode)
          }
          activeWebSocketTransactions.set(socketId, transaction)
        }
      },

      // Optional event handlers (persistence is now handled automatically)
      onMessageStart: async (socketId: string, message: string, agentName?: string, context?: Record<string, unknown>) => {
        // Extract siteId from context metadata (which comes from the client)
        const typedContext = context as AgentsAppContext;
        const siteId = typedContext?.metadata?.appId;

        // Track memory at request start for leak detection
        // Store in dedicated Map to avoid polluting context.metadata
        const startMemory = process.memoryUsage();
        requestMemoryTracking.set(socketId, {
          heapUsed: startMemory.heapUsed,
          heapTotal: startMemory.heapTotal,
          rss: startMemory.rss,
          timestamp: Date.now(),
        });

        logger.debug('memory.request.start', {
          appId: siteId,
          socketId,
          heapUsedBytes: startMemory.heapUsed,
          heapTotalBytes: startMemory.heapTotal,
          rssBytes: startMemory.rss,
        });

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

        // Check if this is the initial prompt (first message in the app's conversation)
        // This is used for funnel tracking to correlate with client-side logs
        // Note: startConversation() has already persisted the user message, so we check for exactly 1 message
        const latestConversation = conversationRepository.getLatestForAppSync(siteId)
        let isInitialPrompt = false
        if (latestConversation) {
          // Check if this is the first user message (efficient count query)
          const messageCount = await conversationRepository.getMessageCount(latestConversation.id)
          // startConversation() has already persisted the initial user message, so a count of 1 indicates the initial prompt
          isInitialPrompt = messageCount === 1
        }
        const app = appRepo.findById(siteId)
        const customerId = app?.customerId

        // Calculate time since app creation for initial prompts
        let timeSinceCreationMs: number | null = null
        if (isInitialPrompt && app?.createdAt) {
          timeSinceCreationMs = Date.now() - new Date(app.createdAt).getTime()
        }

        // Start APM transaction for message processing
        const messageTransaction = apm.startTransaction(
          'WebSocket Message',
          'websocket-message'
        )
        if (messageTransaction) {
          messageTransaction.setLabel('socket_id', socketId)
          // appId is set via globalLabels in APM config
          messageTransaction.setLabel('agent_name', agentName || 'default')
          messageTransaction.setLabel('message_length', message.length)
          messageTransaction.setLabel('event', 'message_start')
          messageTransaction.setLabel('isInitialPrompt', String(isInitialPrompt))

          // Add time since creation for initial prompts (key funnel metric)
          if (timeSinceCreationMs !== null) {
            messageTransaction.setLabel('timeSinceCreationMs', timeSinceCreationMs)
          }

          // Add customerId for correlation with logs (required for funnel analysis)
          if (customerId) {
            messageTransaction.setLabel('customerId', customerId)
          }

          // Add session and conversation IDs if available
          if (typedContext?.metadata?.sessionId) {
            messageTransaction.setLabel('sessionId', typedContext.metadata.sessionId)
          }
          if (typedContext?.metadata?.userId) {
            messageTransaction.setLabel('userId', typedContext.metadata.userId)
          }
          if (typedContext?.conversation?.conversationId) {
            messageTransaction.setLabel('conversationId', typedContext.conversation.conversationId)
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

        // Git hook: check setup status, ensure correct branch, create feature branch
        // Coordinates with nomad_setup.sh via dev-supervisor setup status API
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

        // Budget Service pre-execution check + session creation
        const budgetResult = await performBudgetPreCheck(
          {
            budgetServiceEnabled: typedContext?.metadata?.budgetServiceEnabled,
            subscriptionId: typedContext?.metadata?.subscriptionId as string | undefined,
            appId: siteId,
          },
          { getClient: getBudgetServiceClient, logger },
        )
        if (budgetResult) {
          // Write to ExecutionContextMetadata for GoCode header propagation
          // via buildLitellmMetadataFromContext -> createS2SFetchWrapper.
          // experimental-websocket-server copies metadata fields to conversation.context
          // for handoff persistence.
          // Guard is defensive: performBudgetPreCheck returns null when
          // budgetServiceEnabled !== true, which requires metadata to exist.
          if (typedContext?.metadata) {
            typedContext.metadata.bmsBudgetId = budgetResult.budgetId
            typedContext.metadata.budgetSessionId = budgetResult.sessionId
          }
        }

        // Funnel event: Log initial prompt processing with timing metric
        if (isInitialPrompt) {
          logger.info('funnel.initial_prompt.processing', {
            appId: siteId,
            customerId: customerId,
            timeSinceCreationMs: timeSinceCreationMs,
            messageLength: message.length,
            sessionId: typedContext?.metadata?.sessionId,
            conversationId: typedContext?.conversation?.conversationId
          });
        }

        // Assessment Agent: Classify prompt to determine if task-specific budget override should apply
        // BLOCKING: Must complete before main agent execution to override grants
        // Get Switchboard flags from JWT context (takes precedence over env var)
        // - enableAssessmentAgent: Run classification and log results (for monitoring)
        // - enableAssessmentOverride: Actually apply budget override (requires enableAssessmentAgent)
        const socket = getSocket(socketId)
        const enableAssessmentAgent = socket?.handshake?.auth?.agentContext?.enableAssessmentAgent
        const enableAssessmentOverride = socket?.handshake?.auth?.agentContext?.enableAssessmentOverride

        logger.info('assessment.feature_flag', {
          appId: siteId,
          socketId,
          enableAssessmentAgent,
          enableAssessmentOverride,
          hasAgentContext: !!socket?.handshake?.auth?.agentContext,
        })

        // Only run assessment classification if feature flag is enabled
        if (enableAssessmentAgent) {
          const assessmentAgent = getAssessmentAgent()

          // Get previous user message for multi-turn context
          // Helps classify follow-ups (e.g., "it doesn't work" after "fix my button")
          // Try cache first, fall back to DB on miss (reconnect scenario)
          let previousUserMessage = lastUserMessageCache.get(socketId)

          if (previousUserMessage) {
            logger.debug('assessment.previous_message.from_cache', {
              appId: siteId,
              socketId,
              previousMessagePreview: previousUserMessage.substring(0, 50),
            })
          } else if (conversationId && conversationId !== 'default') {
            const conversationRepo = new ConversationRepository()
            previousUserMessage = (await conversationRepo.getLastUserMessage(conversationId)) ?? undefined

            if (previousUserMessage) {
              logger.debug('assessment.previous_message.from_db', {
                appId: siteId,
                conversationId,
                previousMessagePreview: previousUserMessage.substring(0, 50),
              })
            }
          }

          const assessmentOutcome = await assessmentAgent.classify(message, {
            appId: siteId,
            customerId,
            socketId,
            enabledOverride: enableAssessmentAgent,
            previousUserMessage,
            isInitialPrompt,
          })

          // Store for later use in onMessageComplete
          assessmentOutcomes.set(socketId, assessmentOutcome)

          // Cache current message for next request's multi-turn context
          lastUserMessageCache.set(socketId, message)

          // Queue budget override for application in contextProvider
          // Only apply if both:
          // 1. Assessment determined override should apply (overrideApplied)
          // 2. Override feature flag is enabled (enableAssessmentOverride)
          if (assessmentOutcome.overrideApplied && assessmentOutcome.appliedBudget && enableAssessmentOverride) {
            pendingBudgetOverrides.set(socketId, assessmentOutcome.appliedBudget)

            logger.info('grants.assessment.override.pending', {
              appId: siteId,
              customerId,
              socketId,
              taskType: assessmentOutcome.result?.taskType,
              confidence: assessmentOutcome.result?.confidence,
              appliedBudget: assessmentOutcome.appliedBudget,
              durationMs: assessmentOutcome.durationMs,
              reason: assessmentOutcome.reason,
            })
          } else if (assessmentOutcome.overrideApplied && assessmentOutcome.appliedBudget && !enableAssessmentOverride) {
            // Log that override would have been applied but is disabled (dry run mode)
            logger.info('grants.assessment.override.dry_run', {
              appId: siteId,
              customerId,
              socketId,
              taskType: assessmentOutcome.result?.taskType,
              confidence: assessmentOutcome.result?.confidence,
              wouldApplyBudget: assessmentOutcome.appliedBudget,
              durationMs: assessmentOutcome.durationMs,
              reason: assessmentOutcome.reason,
              enableAssessmentOverride,
            })
          }
        }

        // Store metadata for funnel events in onMessageComplete/onError
        // These callbacks don't receive per-message data from ai-transport
        initialPromptMetadata.set(socketId, {
          isInitialPrompt,
          customerId,
          agentName: agentName || undefined,
          startTime: Date.now(),
        });
      },

      // Pre-completion callback for git operations and free grants flag
      beforeMessageComplete: async (socketId: string, context: Record<string, unknown>) => {
        const typedContext = context as AgentsAppContext
        const siteId = typedContext?.metadata?.appId

        // Get assessment outcome for free grants flag (before cleanup in onMessageComplete)
        // Only report usedFreeGrants if override was actually applied (not dry run)
        const assessmentOutcome = assessmentOutcomes.get(socketId)
        const socket = getSocket(socketId)
        const enableAssessmentOverride = socket?.handshake?.auth?.agentContext?.enableAssessmentOverride ?? false
        const usedFreeGrants = (assessmentOutcome?.overrideApplied && enableAssessmentOverride) ?? false

        if (!siteId) {
          logger.debug('websocket.before_complete.no_app_id', { socketId })
          return { commitHash: null, usedFreeGrants }
        }

        try {
          const conversationId = typedContext?.conversation?.conversationId

          logger.debug('websocket.before_complete.begin', {
            socketId,
            appId: siteId,
            conversationId,
            usedFreeGrants,
          })

          // Execute git squash merge and get commit hash
          const commitHash = await gitHookService.handleConnectionEnd(
            siteId,
            'complete',
            conversationId,
            socketId
          )

          logger.info('websocket.before_complete.success', {
            socketId,
            appId: siteId,
            conversationId,
            commitHash: commitHash ? commitHash.substring(0, 7) : 'none',
            usedFreeGrants,
          })

          return { commitHash, usedFreeGrants }

        } catch (error) {
          logger.error('websocket.before_complete.error', {
            socketId,
            appId: siteId,
            error: error instanceof Error ? error.message : String(error)
          })
          return { commitHash: null, usedFreeGrants }
        }
      },

      onMessageComplete: async (socketId: string, result: any, context?: Record<string, unknown>) => {
        const duration = result.duration || 'unknown';
        const steps = result.steps || 0;
        const agentId = result.agentId || 'unknown';
        const typedContext = context as AgentsAppContext;
        const appId = typedContext?.metadata?.appId;

        logger.info('websocket.message.completed', {
          socketId,
          steps,
          duration,
          agentId
        });

        // Funnel event: Track completion of initial prompt (first build)
        const promptMeta = initialPromptMetadata.get(socketId);
        if (promptMeta?.isInitialPrompt && appId) {
          const durationMs = Date.now() - promptMeta.startTime;
          logger.info('funnel.initial_prompt.complete', {
            appId,
            customerId: promptMeta.customerId,
            durationMs,
            agentName: promptMeta.agentName || result.agentName || result.agentId || 'unknown',
          });
        }
        // Always clean up regardless of isInitialPrompt
        if (promptMeta) {
          initialPromptMetadata.delete(socketId);
        }

        // Log free grants usage (flag is now included in complete event via beforeMessageComplete)
        const assessmentOutcome = assessmentOutcomes.get(socketId)
        const socket = getSocket(socketId)
        const enableAssessmentOverride = socket?.handshake?.auth?.agentContext?.enableAssessmentOverride ?? false

        if (assessmentOutcome?.overrideApplied && enableAssessmentOverride && appId) {
          logger.info('grants.assessment.free_task_completed', {
            appId,
            customerId: promptMeta?.customerId,
            taskType: assessmentOutcome?.result?.taskType,
            appliedBudget: assessmentOutcome?.appliedBudget,
            durationMs: assessmentOutcome?.durationMs,
          })
        }
        // Clean up per-message socket state
        assessmentOutcomes.delete(socketId)
        pendingBudgetOverrides.delete(socketId)

        if (appId) {
          const contextLogger = log.forApp(appId);
          contextLogger.info('websocket.request.site_completed', {});
        } else {
          logger.debug('websocket.message.completion.no_appid', {
            socketId,
            hasContext: !!context,
          });
        }

        // Unified cleanup: memory tracking, APM transaction
        finalizeMessage(socketId, 'complete', { appId, agentId, steps, ...(typeof duration === 'number' && { duration }) });
      },

      onBudgetReport: async (budgetId: string, sessionId: string) => {
        const client = getBudgetServiceClient()
        if (!client) {
          throw new Error('Budget service client unavailable')
        }

        // Get session cost (GoCode reports cost async, may be 0 due to race)
        let session
        try {
          session = await client.getSession(sessionId)
        } catch (err) {
          logger.error('budget.report.getSessionFailed', {
            budgetId, sessionId, error: err instanceof Error ? err.message : String(err),
          })
          throw err
        }

        // createReport is the critical path (credits deducted). Must not be blocked
        // by getBudget failure. Returns full ReportResponse (BMS parity, PR #2577).
        let report
        try {
          report = await client.createReport(sessionId, {
            reportItems: [{
              budgetCost: session.costTotal.toString(),
              productCost: '0',
              label: 'airo-builder:general',
            }],
          })
        } catch (err) {
          logger.error('budget.report.createReportFailed', {
            budgetId, sessionId, error: err instanceof Error ? err.message : String(err),
          })
          throw err
        }

        // getBudget for per-item breakdown (post-deduction state). Graceful degradation.
        try {
          const budget = await client.getBudget(budgetId)
          return { refreshRequired: false, payload: toBudgetUpdatePayload(report, budget) }
        } catch (err) {
          logger.error('budget.report.payload_failed', {
            budgetId,
            sessionId,
            reportId: report.reportId,
            error: err instanceof Error ? err.message : String(err),
          })
          return { refreshRequired: true }
        }
      },

      onDisconnection: async (socketId: string, meta?: { reason?: string; transport?: string }) => {
        // Log connection duration for quality monitoring
        const connectTime = connectionStartTimes.get(socketId)
        if (connectTime) {
          const connectionDurationMs = Date.now() - connectTime
          logger.info('websocket.quality.connection_ended', {
            socketId,
            connectionDurationMs,
            connectionDurationMinutes: Math.round(connectionDurationMs / 60_000 * 10) / 10,
            disconnectReason: meta?.reason,
            transport: meta?.transport,
          })
          connectionStartTimes.delete(socketId)
        }

        initialPromptMetadata.delete(socketId);

        // Clean up assessment tracking
        assessmentOutcomes.delete(socketId)
        pendingBudgetOverrides.delete(socketId)
        lastUserMessageCache.delete(socketId)

        // Cleanup ClientActionService
        cleanupClientActionService(socketId)

        // Cleanup grant session
        grantSessionManager.removeSession(socketId)

        // Git hook: Squash merge to main on disconnection
        // Try to find appId from active branches using socketId (conversationId not available here)
        const appId = gitHookService.findAppIdBySocketId(socketId);

        if (appId) {
          // Get branch info to extract conversationId if available
          const branchInfo = gitHookService.getAppBranch(appId);
          const conversationId = branchInfo?.conversationId;

          // Track the git operation so shutdown can await it
          const gitOp = gitHookService.handleConnectionEnd(
            appId,
            'disconnection',
            conversationId,
            socketId
          ).then(() => {
            logger.debug('websocket.git_hook.connection_end.success', {
              message: 'Git hook connection end completed on disconnection',
              appId,
              conversationId,
              socketId,
              reason: 'disconnection'
            });
          }).catch((error: unknown) => {
            logger.warn('websocket.git_hook.connection_end.error', {
              message: 'Git hook connection end failed (non-blocking)',
              appId,
              socketId,
              reason: 'disconnection',
              error: error instanceof Error ? error.message : String(error)
            });
          });

          gitHookService.trackOperation(gitOp);
          await gitOp;
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

        // Unified cleanup: memory tracking + orphaned message transaction
        finalizeMessage(socketId, 'aborted', { appId: appId ?? undefined });
      },

      onAgentChanged: async (conversationId: string, oldAgentName: string, newAgentName: string, appId?: string) => {
        logger.info('websocket.agent.handoff', {
          conversationId,
          oldAgent: oldAgentName,
          newAgent: newAgentName,
          appId
        })

        try {
          await conversationRepository.updateAgentId(conversationId, newAgentName)
          logger.debug('websocket.agent.handoff.updated', {
            conversationId,
            newAgent: newAgentName
          })
        } catch (error) {
          logger.error('websocket.agent.handoff.update_failed', {
            conversationId,
            oldAgent: oldAgentName,
            newAgent: newAgentName,
            error: error instanceof Error ? error.message : String(error)
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

        // Funnel event: Track failure of initial prompt
        const promptMeta = initialPromptMetadata.get(socketId);
        if (promptMeta?.isInitialPrompt && appId) {
          logger.info('funnel.initial_prompt.error', {
            appId,
            customerId: promptMeta.customerId,
            error: error.message,
            agentName: promptMeta.agentName || 'unknown',
          });
        }
        // Always clean up
        if (promptMeta) {
          initialPromptMetadata.delete(socketId);
        }

        // Clean up assessment tracking (prevent stale overrides on next message)
        assessmentOutcomes.delete(socketId)
        pendingBudgetOverrides.delete(socketId)

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

        // Unified cleanup: memory tracking + APM message transaction
        finalizeMessage(socketId, 'error', { appId, error });

        // Also mark connection transaction if it exists
        const connectionTransaction = activeWebSocketTransactions.get(socketId)
        if (connectionTransaction) {
          connectionTransaction.setLabel('error_message', error.message)
          connectionTransaction.setLabel('has_error', 'true')
        }
      },

      onLlmEnd: async (data: { socketId: string; model: string; provider: string; correlationId?: string; conversationId?: string; appId?: string }) => {
        logger.info('llm.call.end', {
          socketId: data.socketId,
          model: data.model,
          provider: data.provider,
          ...(data.correlationId && { correlationId: data.correlationId }),
          ...(data.conversationId && { conversationId: data.conversationId }),
          ...(data.appId && { appId: data.appId }),
        })
      },

      // messageMiddleware reads metadata.modelOverride from the raw incoming
      // data.context (before processContext runs). This field is client-owned
      // metadata that passes through context processing unchanged. If context
      // extraction is ever modified to strip or transform client metadata,
      // this must be updated to resolve from post-extraction context instead.
      messageMiddleware: async (
        socketId: string,
        context: Record<string, unknown> | undefined,
        execute: () => Promise<void>
      ) => {
        const socket = getSocket(socketId)
        const agentContext = socket?.handshake?.auth?.agentContext

        const profile = resolveProfile({
          agentProfileSelectorEnabled: !!agentContext?.agentProfileSelectorEnabled,
          perProjectProfile: (context as any)?.metadata?.agentProfile as string | undefined,
          jwtAgentProfile: agentContext?.agentProfile as string | undefined,
        })

        if (profile) {
          logger.info('profile.resolve.active', { profileName: profile.name, socketId })
        }

        const effectiveOverride = resolveOverride({
          modelSelectorEnabled: !!agentContext?.modelSelectorEnabled,
          perProjectModel: (context as any)?.metadata?.modelOverride as string | undefined,
          jwtModelOverride: agentContext?.modelOverride as string | undefined,
        })

        const executeWithModelOverride = async () => {
          if (effectiveOverride) {
            const allowed = guardAllowedOverrideModel(
              effectiveOverride,
              'messageMiddleware',
              function logReject(event: string, data: Record<string, unknown>) {
                logger.warn(event, data)
              },
            )
            if (allowed) {
              logger.info('model.override.context.active', { effectiveOverride: allowed, socketId })
              await runWithModelOverride(allowed, execute)
              return
            }
          }
          await execute()
        }

        if (profile) {
          await runWithProfile(profile, executeWithModelOverride)
        } else {
          await executeWithModelOverride()
        }
      }
    }


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

    // Start periodic cleanup of stale grant sessions
    grantSessionManager.startCleanupInterval()

    // Register refresh callback to emit request_grant_refresh to frontend
    // This allows the grant session manager to request fresh grants when exhausted
    grantSessionManager.setRefreshCallback((sessionId: string) => {
      // Get subscription info for logging correlation and alternative socket lookup
      const subscriptionId = grantSessionManager.getSubscriptionIdForSession(sessionId)

      // Try the original socket first
      let socket = ioInstance?.sockets.sockets.get(sessionId)

      // If original socket disconnected, try to find another socket for the same subscription
      // This handles the case where a user has multiple tabs open
      if (!socket && subscriptionId) {
        const alternativeSockets = grantSessionManager.getSocketsForSubscription(subscriptionId)
        for (const altSocketId of alternativeSockets) {
          if (altSocketId === sessionId) continue // Skip the original
          const altSocket = ioInstance?.sockets.sockets.get(altSocketId)
          if (altSocket) {
            logger.info('websocket.grant_context.refresh_using_alternative', {
              originalSocketId: sessionId,
              alternativeSocketId: altSocketId,
              subscriptionId,
            })
            socket = altSocket
            break
          }
        }
      }

      if (socket) {
        logger.info('websocket.grant_context.refresh_emitted', {
          socketId: socket.id,
          subscriptionId,
        })
        socket.emit('request_grant_refresh')
      } else {
        // No connected sockets for this subscription - the pending refresh will timeout
        logger.warn('websocket.grant_context.refresh_no_sockets', {
          socketId: sessionId,
          subscriptionId,
          message: 'No connected sockets for subscription - refresh will timeout',
        })
      }
    })

    // Graceful shutdown handler for grant session cleanup
    process.on('SIGTERM', () => {
      grantSessionManager.stopCleanupInterval()
    })

    // Registers a socket.use() middleware that validates tenant isolation for
    // chat events. Using socket.use() rather than wrapping individual handlers
    // avoids reading socket._events (a private Socket.IO API) and works
    // correctly even when multiple handlers are registered on the same event.
    const addTenantValidationMiddleware = (socket: Socket): void => {
      socket.use(([event, ...args]: [string, ...any[]], next: (err?: Error) => void) => {
        if (event !== 'chat' && event !== 'chat_message') {
          next()
          return
        }

        const data = args[0]
        const authenticatedSiteId = socket.handshake.auth?.agentContext?.siteId

        // Check presence before bypass so bypass only applies to known siteIds,
        // never to unauthenticated sockets (prevents empty-string bypass edge case).
        if (!authenticatedSiteId) {
          logger.error('websocket.message.no_authenticated_siteid', {
            message: 'SECURITY VIOLATION: No authenticated siteId in socket',
            socketId: socket.id,
            hasAgentContext: !!socket.handshake.auth?.agentContext
          }, { tags: ['security', 'authorization-failure'] })
          socket.emit('error', {
            type: 'authorization_error',
            message: 'Authentication context missing'
          })
          return
        }

        if (BYPASS_SITE_IDS.includes(authenticatedSiteId)) {
          next()
          return
        }

        const requestedAppId = data?.context?.metadata?.appId

        if (!requestedAppId) {
          logger.warn('websocket.message.no_app_id', {
            message: 'No appId in message context',
            socketId: socket.id
          })
          socket.emit('error', {
            type: 'validation_error',
            message: 'appId required in message context'
          })
          return
        }

        if (requestedAppId !== authenticatedSiteId) {
          logger.error('websocket.message.cross_tenant_attempt', {
            message: 'SECURITY VIOLATION: Cross-tenant access attempt via WebSocket message',
            authenticatedSiteId,
            requestedAppId,
            socketId: socket.id,
            severity: 'CRITICAL'
          }, { tags: ['security', 'authorization-failure', 'cross-tenant-attempt'] })
          socket.emit('error', {
            type: 'authorization_error',
            message: 'Access denied: appId does not match authenticated tenant'
          })
          return
        }

        next()
      })
    }

    let pendingAuthCount = 0

    // SETUP_TIMEOUT_MS must be strictly less than the client machine's AUTH_TIMEOUT (35s).
    // If setup hangs this long, the socket is disconnected before the machine's safety net fires.
    const SETUP_TIMEOUT_MS = 30000;

    // Shared JWT validation logic used by both handshake middleware and authenticate event
    const AUTH_TIMEOUT_MS = 30000;

    // Single connection handler — three concerns in a deterministic order:
    //   1. Grant context listeners   (all sockets)
    //   2. Auth routing              (handshake-auth vs connect-then-auth)
    //   3. Tenant validation         (wraps chat handlers AFTER they exist)
    //
    // Tenant validation must run after chat handlers are registered, which
    // happens at different times depending on the auth path:
    //   handshake-auth  → base class already called completeConnectionSetup
    //   connect-then-auth → completeConnectionSetup runs after authenticate succeeds
    ioInstance.on('connection', (socket: Socket) => {
      // ── Grant context listeners (always) ──────────────────────────────
      socket.on('grant_context', (data: GrantContextPayload) => {
        logger.info('websocket.grant_context.received', {
          socketId: socket.id,
          grantCount: data.grants.length,
        })

        grantSessionManager.setGrants(socket.id, data.grants)
      })

      socket.on('request_grant_refresh_ack', () => {
        logger.debug('websocket.grant_context.refresh_acknowledged', {
          socketId: socket.id,
        })
      })

      // ── Handshake-auth path (old clients, PaaS, reconnects) ───────────
      // Base class already ran completeConnectionSetup, so chat handlers
      // exist and we can wrap them with tenant validation immediately.
      const isHandshakeAuth = socket.handshake.auth?.agentContext && !socket.handshake.auth?.pendingAuth;

      if (isHandshakeAuth) {
        socket.on('authenticate', () => {
          socket.emit('authenticateSuccess', {
            siteId: socket.handshake.auth.agentContext.siteId,
            socketId: socket.id,
          });
        });
        addTenantValidationMiddleware(socket);
        return;
      }

      // ── Connect-then-auth path ────────────────────────────────────────
      if (!socket.handshake.auth?.pendingAuth) return;

      pendingAuthCount++
      logger.info('websocket.connection.pending_auth_count', {
        pendingCount: pendingAuthCount,
        socketId: socket.id,
      })

      const authTimeout = setTimeout(() => {
        if (socket.handshake.auth?.pendingAuth) {
          logger.warn('websocket.auth.timeout', {
            message: 'Authentication timeout - disconnecting unauthenticated socket',
            socketId: socket.id,
            timeoutMs: AUTH_TIMEOUT_MS,
          }, { tags: ['security'] });
          socket.emit('authenticateError', { error: 'Authentication timeout' });
          socket.disconnect(true);
        }
      }, AUTH_TIMEOUT_MS);

      attachConnectThenAuthPendingInboundGate(socket);

      let authInProgress = false;

      const handleAuthenticate = async (data: { token: string }) => {
        if (authInProgress) {
          logger.debug('websocket.auth.concurrent_rejected', {
            message: 'Rejected concurrent authenticate event',
            socketId: socket.id,
          });
          socket.emit('authenticateError', { error: 'Authentication already in progress' });
          return;
        }

        if (socket.handshake.auth?.agentContext) {
          logger.warn('websocket.auth.already_authenticated', {
            message: 'Rejected authenticate event on already-authenticated socket',
            socketId: socket.id,
            siteId: socket.handshake.auth.agentContext.siteId,
          }, { tags: ['security'] });
          socket.emit('authenticateError', { error: 'Already authenticated' });
          return;
        }

        if (!data?.token) {
          socket.emit('authenticateError', { error: 'Missing token' });
          return;
        }

        authInProgress = true;
        try {
          const authResult = await validateAndCreateAgentContext(data.token);
          if (!authResult.valid) {
            clearTimeout(authTimeout);
            logger.warn('websocket.auth.authenticate_failed', {
              message: 'Authentication failed via authenticate event',
              error: authResult.error,
              socketId: socket.id,
            }, { tags: ['security'] });
            socket.emit('authenticateError', { error: authResult.error });
            socket.disconnect(true);
            return;
          }

          clearTimeout(authTimeout);

          const originalAuth = socket.handshake.auth;
          socket.handshake.auth = {
            ...originalAuth,
            pendingAuth: true,
            token: data.token,
            decoded: authResult.claims,
            agentContext: authResult.agentContext,
          };

          logger.info('websocket.auth.connection_approved', {
            message: 'Connection approved: JWT validation passed (authenticate event)',
            siteId: authResult.agentContext!.siteId,
            tokenTTL: authResult.agentContext!.exp - authResult.agentContext!.iat,
            socketId: socket.id,
            authPhaseMs: Date.now() - (socket.data?.connectTime || Date.now()),
          }, { tags: ['security'] });

          registerTokenRefreshHandler(socket);

          if (!socket.connected) {
            logger.warn('websocket.auth.disconnected_during_auth', {
              message: 'Socket disconnected during authentication - skipping connection setup',
              socketId: socket.id,
            });
            return;
          }

          // Tenant validation must be installed before chat is allowed. Inbound chat stays
          // blocked via pendingAuth until completeConnectionSetup finishes so the client
          // cannot race recovery / subscriber wiring with the first chat_message.
          addTenantValidationMiddleware(socket);

          let setupFailed = false
          try {
            await wsServer.completeConnectionSetup(socket, AbortSignal.timeout(SETUP_TIMEOUT_MS))
          } catch (setupError) {
            logger.error('websocket.auth.connection_setup_failed', {
              message: 'completeConnectionSetup failed after successful auth - disconnecting socket',
              error: setupError instanceof Error ? setupError.message : String(setupError),
              socketId: socket.id,
            });
            setupFailed = true
          }

          if (setupFailed) {
            socket.disconnect(true)
            return
          }

          if (!socket.connected) {
            logger.warn('websocket.auth.disconnected_during_setup', {
              message: 'Socket disconnected during connection setup - skipping authenticateSuccess',
              socketId: socket.id,
            });
            return;
          }

          pendingAuthCount = Math.max(0, pendingAuthCount - 1)
          finalizeConnectThenAuthSessionReady(socket, authResult.agentContext!.siteId)
        } catch (error) {
          clearTimeout(authTimeout);
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error('websocket.auth.authenticate_error', {
            message: 'Error during authenticate event',
            error: errorMessage,
            socketId: socket.id,
          }, { tags: ['security'] });
          socket.emit('authenticateError', { error: errorMessage });
          socket.disconnect(true);
        } finally {
          authInProgress = false;
        }
      };

      socket.on('authenticate', handleAuthenticate);

      socket.on('disconnect', () => {
        if (socket.handshake.auth?.pendingAuth) {
          pendingAuthCount = Math.max(0, pendingAuthCount - 1)
        }
        clearTimeout(authTimeout);
      });
    })

    const validateAndCreateAgentContext = async (token: string): Promise<{
      valid: boolean;
      error?: string;
      claims?: any;
      agentContext?: AgentContext;
    }> => {
      logger.info('websocket.auth.jwt_validation.start', {
        message: 'Validating JWT token using public key'
      }, { tags: ['security'] });

      const validationResult = await jwtAuthMiddleware.jwtValidator.validateToken(token);

      if (!validationResult.valid) {
        logger.warn('websocket.auth.connection_rejected', {
          message: 'CONNECTION REJECTED: JWT validation failed',
          reason: validationResult.reason
        }, { tags: ['security'] });
        return { valid: false, error: `JWT validation failed: ${validationResult.reason}` };
      }

      const agentContext = buildAgentContext((validationResult.claims ?? {}) as unknown as Record<string, unknown>);

      const ttlValidation = jwtAuthMiddleware.validateWebSocketTokenTTL(agentContext);
      if (!ttlValidation.valid) {
        logger.warn('websocket.auth.connection_rejected.ttl', {
          message: 'CONNECTION REJECTED: Token TTL validation failed',
          error: ttlValidation.error,
          tokenTTL: agentContext.exp - agentContext.iat,
          maxAllowed: 600
        });
        return { valid: false, error: ttlValidation.error || 'Token TTL validation failed' };
      }

      // Deny WebSocket access for PaaS callers
      if (agentContext.product === 'PaaSNodeJS') {
        logger.warn('websocket.auth.productDenied', {
          message: 'WebSocket connection denied for PaaS consumer',
          siteId: agentContext.siteId,
        }, { tags: ['security'] });
        return { valid: false, error: 'WebSocket connections are not available for PaaS consumers' };
      }

      return { valid: true, claims: validationResult.claims, agentContext };
    };

    // Register tokenRefresh handler on a socket (shared between handshake-auth and authenticate-event paths)
    const registerTokenRefreshHandler = (socket: Socket): void => {
      socket.on('tokenRefresh', async (data: any) => {
        try {
          const originalSiteId = socket.handshake.auth.agentContext?.siteId;

          if (!originalSiteId) {
            logger.error('websocket.auth.token_refresh.no_original_siteid', {
              message: 'Token refresh attempted but no original siteId found',
              socketId: socket.id
            }, { tags: ['security'] });
            socket.emit('tokenRefreshError', { error: 'Session state invalid - please reconnect' });
            return;
          }

          logger.info('websocket.auth.token_refresh.requested', {
            message: 'Token refresh requested',
            siteId: originalSiteId,
            socketId: socket.id
          }, { tags: ['security'] });

          const refreshResult = await jwtAuthMiddleware.jwtValidator.validateToken(data.newToken);

          if (!refreshResult.valid) {
            logger.warn('websocket.auth.token_refresh.failed', {
              message: 'Token refresh failed - invalid token',
              reason: refreshResult.reason,
              siteId: originalSiteId
            }, { tags: ['security'] });
            socket.emit('tokenRefreshError', { error: refreshResult.reason });
            return;
          }

          const refreshAgentContext = buildAgentContext((refreshResult.claims ?? {}) as unknown as Record<string, unknown>);

          const refreshTTLValidation = jwtAuthMiddleware.validateWebSocketTokenTTL(refreshAgentContext);
          if (!refreshTTLValidation.valid) {
            logger.warn('websocket.auth.token_refresh.ttl_failed', {
              message: 'Token refresh TTL validation failed',
              error: refreshTTLValidation.error,
              tokenTTL: refreshAgentContext.exp - refreshAgentContext.iat,
              siteId: originalSiteId
            }, { tags: ['security'] });
            socket.emit('tokenRefreshError', { error: refreshTTLValidation.error });
            return;
          }

          // Deny product type change on refresh (prevent PaaS escalation)
          const originalProduct = socket.handshake.auth.agentContext?.product;
          if (originalProduct && refreshAgentContext.product !== originalProduct) {
            logger.error('websocket.auth.token_refresh.productMismatch', {
              message: 'SECURITY VIOLATION: Token refresh attempted with different product type',
              originalProduct,
              newProduct: refreshAgentContext.product,
              siteId: originalSiteId,
              socketId: socket.id,
              action: 'disconnecting_socket'
            }, { tags: ['security', 'authorization-failure'] });
            socket.emit('tokenRefreshError', {
              error: 'Token product type mismatch - please reconnect with correct credentials'
            });
            socket.disconnect(true);
            return;
          }

          if (refreshAgentContext.siteId !== originalSiteId) {
            logger.error('websocket.auth.token_refresh.siteid_mismatch', {
              message: 'SECURITY VIOLATION: Token refresh attempted with different siteId',
              originalSiteId,
              newSiteId: refreshAgentContext.siteId,
              socketId: socket.id,
              action: 'disconnecting_socket'
            }, { tags: ['security', 'authorization-failure'] });
            socket.emit('tokenRefreshError', {
              error: 'Token tenant mismatch - please reconnect with correct credentials'
            });
            socket.disconnect(true);
            return;
          }

          const preservedAuth = socket.handshake.auth;
          socket.handshake.auth = {
            ...preservedAuth,
            token: data.newToken,
            decoded: refreshResult.claims,
            agentContext: refreshAgentContext
          };

          logger.info('websocket.auth.token_refresh.success', {
            message: 'Token refreshed successfully - siteId verified',
            siteId: refreshAgentContext.siteId,
            tokenTTL: refreshAgentContext.exp - refreshAgentContext.iat,
            expiryTime: new Date((refreshResult.claims?.exp || 0) * 1000).toISOString(),
            preservedMetadata: Object.keys(preservedAuth).filter(k => k !== 'token' && k !== 'decoded' && k !== 'agentContext')
          }, { tags: ['security'] });
          socket.emit('tokenRefreshSuccess', {
            newExpiry: refreshResult.claims?.exp,
            siteId: refreshResult.claims?.siteId
          });

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error('websocket.auth.token_refresh.error', {
            message: 'Token refresh error',
            error: errorMessage,
            socketId: socket.id
          }, { tags: ['security'] });
          socket.emit('tokenRefreshError', { error: errorMessage });
        }
      });
    };

    // Add Socket.IO authentication middleware
    wsServer.getIO().use(async (socket, next) => {
      try {
        socket.data = { ...socket.data, connectTime: Date.now() }

        const authType = auth.getType();

        if (authType === AuthType.NONE) {
          const siteId = auth.getSiteId(AuthType.NONE);
          const now = Math.floor(Date.now() / 1000);
          socket.handshake.auth = {
            ...socket.handshake.auth,
            siteId,
            agentContext: {
              siteId,
              canDownload: true,
              canPublish: true,
              canPurchaseDomain: true,
              isE2S: false,
              product: 'AiroAppBuilder' as ProductType,
              modelSelectorEnabled: true,
              exp: now + 3600,
              iat: now
            }
          };
          next();
          return;
        }

        if (authType === AuthType.MOCK) {
          const siteId = auth.getSiteId(AuthType.MOCK);
          const now = Math.floor(Date.now() / 1000);
          socket.handshake.auth = {
            ...socket.handshake.auth,
            siteId,
            agentContext: {
              siteId,
              canDownload: true,
              canPublish: true,
              canPurchaseDomain: true,
              isE2S: false,
              product: 'AiroAppBuilder' as ProductType,
              modelSelectorEnabled: true,
              exp: now + 3600,
              iat: now
            }
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

        // Connect-then-auth: If no token, allow connection with pendingAuth flag.
        // The client will send an `authenticate` event with the token after connecting.
        if (!token) {
          logger.debug('websocket.auth.pending', {
            message: 'No JWT token in handshake, allowing connection with pending auth',
            hasAuth: !!socket.handshake.auth,
            hasAuthHeader: !!socket.handshake.headers.authorization
          }, {
            tags: ['security']
          });
          socket.handshake.auth = {
            ...socket.handshake.auth,
            pendingAuth: true,
          };
          next();
          return;
        }

        // Token present in handshake — validate inline (backward compatible with old clients and PaaS)
        const authResult = await validateAndCreateAgentContext(token);
        if (!authResult.valid) {
          throw new Error(authResult.error!);
        }

        // Store validated context in socket for reuse
        const originalAuth = socket.handshake.auth;
        socket.handshake.auth = {
          ...originalAuth,
          token,
          decoded: authResult.claims,
          agentContext: authResult.agentContext
        };

        logger.info('websocket.auth.connection_approved', {
          message: 'Connection approved: JWT validation passed (handshake)',
          siteId: authResult.agentContext!.siteId,
          tokenTTL: authResult.agentContext!.exp - authResult.agentContext!.iat,
          authPhaseMs: Date.now() - (socket.data?.connectTime || Date.now()),
        }, {
          tags: ['security']
        });

        // Register token refresh handler
        registerTokenRefreshHandler(socket);

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

    // Handlers 2 & 3 (auth state machine, tenant validation) are now part of
    // the consolidated connection handler above.

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

/**
 * Get the GitHookService instance for shutdown git operations
 */
export function getGitHookService() {
  return gitHookService;
}

