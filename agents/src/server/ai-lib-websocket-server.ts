/**
 * AI-Lib WebSocket Server Implementation
 * Uses AgentFactory system for modern agent management
 */

import { Server as HTTPServer } from 'node:http'
import {
  calculateCostEstimate,
  parseChunkTimeoutMs,
} from '@airo/ai-lib'
import {
  createWebSocketServer,
  hasNonIdempotentTools,
  type MessageProvider,
  type ContextProvider,
  type ConversationMessage,
  type HistoryProvider,
  type PersistedMessage,
} from '@airo/ai-transport'
import { grantSessionManager, type GrantContextPayload, BudgetOverride, resolveBmsSubscriptionId } from '@airo/ai-grants'
import { getBudgetServiceClient } from '../services/budget-service-instance.js'
import { maybeEmitDebugTurnStats } from './debug-stats-emit.js'
import { performBudgetPreCheck } from './budget-pre-check.js'
import {
  toBudgetUpdatePayload,
  BudgetServiceError,
  BudgetServiceConflictError,
  BudgetServiceTimeoutError,
  BudgetServiceUnavailableError,
  buildAttributionPayload,
  emitCostAttributionResult,
  logReportCreated,
  type AttributionAssessment,
  type AttributionContext,
  type ExecutionStep,
} from '@airo/ai-lib/budget'
import { context as otelContext } from '@opentelemetry/api'
import { createAgentContext } from '@godaddy/agent-otel-sdk'
import { safeProcessBudgetReport, type BudgetReportResult } from './budget-report-handler.js'
import { auth, AuthType, BYPASS_SITE_IDS } from '../services/features.js'
import { getTemplateIds } from '../agents/template-registry.js'
import { isEmployeeAuthType, type AuthType as TokenAuthType, type ProductType } from '@airo/shared/auth'
import apm from 'elastic-apm-node'
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

import {
  getConversationLifecycleStore,
  getMessageStore,
} from '../memory/adapters/index.js'
import { workspaceScopeFromAppId } from '../memory/interfaces/scope.js'
import { fileUploadService } from '../services/FileUploadService.js'
import { logger, log } from '../logging/index.js'
import { jwtAuthMiddleware, buildAgentContext, type AgentContext } from './middleware/jwt-auth.js'
import { getAgentConfig } from '../services/features.js'
import { runWithModelOverride } from '@airo/ai-lib'
import { resolveProfile, runWithProfile } from '../profiles/index.js'
import { createAgentRouter } from './agent-router.js'
import { getModelOverride } from '../utils/model-selection.js'
import {
  guardAllowedOverrideModel,
  resolveOverride,
} from './model-override.js'
import {
  calculateCacheMetrics,
  calculateContextWindowUtilization
} from '../utils/model-context-window.js'
import type { AgentsAppContext } from '../types/websocket-context.js'
import { selectCacheConversationId } from './budget-report-conversation-id.js'
import { AppRepository } from '../database/repositories/AppRepository.js'
import { initializeContextRegistry } from '../services/initializeContextRegistry.js'
import {
  buildDynamicDataMessage,
  buildTodoContextMessage,
  buildRagContextMessage,
  collectImagesFromFormattedContexts,
  checkAndTriggerSummarization,
} from './context-builders.js'
import { GitHookService } from '../services/git-hook-service.js'
import { buildSharedPostStreamValidator } from './post-stream-validator.js'
import { buildPinnedSkillsContextMessages } from './pinned-skills-context.js'
import {
  runStartGitHook, runStartAssessment, runMessageEndHooks,
  LifecycleSessionStore,
  type MessageLifecycleDeps,
} from './message-lifecycle.js'
import { ClientActionService, type IClientActionService } from '../services/ClientActionService.js'
import { hasUnbuiltRebuildPages } from '../tools/ai-lib-tools/rebuild-page-selector.js'
import { getAssessmentAgent, type AssessmentOutcome, AssessmentTaskType } from '../agents/assessment-agent/index.js'
import { withTimeout } from '../utils/promise-utils.js'
import {
  executeAssessment,
  assertNever,
  ASSESSMENT_MODE,
  PARALLEL_ASSESSMENT_TIMEOUT_MS,
  AWAIT_ASSESSMENT_REASON,
  deriveUsedFreeGrants,
  cleanupAssessmentStateOnError,
  shouldAwaitParallelAssessment,
  type ParallelAssessmentState,
} from './assessment-executor.js'
import { ConversationEventChannel } from '@airo/ai-transport'
import { getSSERegistry } from './sse/registry-singleton.js'
import { mapToolCallsToUI } from './tool-call-mapper.js'

/**
 * Shared AppRepository instance to avoid repeated initialization
 */
const appRepo = new AppRepository()

/**
 * Shared ConversationEventChannel for SSE transport.
 * Initialized once during setupAILibWebSocketServer and shared with
 * MessageExecutionService so SSE subscribers receive agent events.
 */
let sseEventChannelInstance: ConversationEventChannel | null = null
let sseEventChannelCleanupInterval: NodeJS.Timeout | null = null

/**
 * Shared agentFactory reference for SSE execution.
 * Set during setupAILibWebSocketServer once agents are initialized.
 */
let sseAgentFactoryInstance: Awaited<ReturnType<typeof import('../agents/ai-lib-agents/index.js').createWebSocketAgentFactory>> | null = null

/**
 * Get the SSE event channel (available after setupAILibWebSocketServer resolves).
 */
export function getSSEEventChannel(): ConversationEventChannel | null {
  return sseEventChannelInstance
}

/**
 * Get the SSE agent factory (available after setupAILibWebSocketServer resolves).
 */
export function getSSEAgentFactory(): typeof sseAgentFactoryInstance {
  return sseAgentFactoryInstance
}

/**
 * Shared GitHookService instance for tracking feature branches across connections
 */
const gitHookService = new GitHookService()

/**
 * Shared lifecycle deps used by both onMessageStart and beforeMessageComplete,
 * and re-exported to the SSE path via `getMessageLifecycleDeps()`.
 */
const lifecycleSessionStore = new LifecycleSessionStore()
const lifecycleDeps: MessageLifecycleDeps = {
  gitHookService,
  getAssessmentAgent,
  sessionStore: lifecycleSessionStore,
  logger,
}

export function getMessageLifecycleDeps(): MessageLifecycleDeps {
  return lifecycleDeps
}

/**
 * Post-stream validator (tsc + runtime-error checks with bounded retries).
 * Shared with the SSE path via the same factory in app.ts.
 */
const { validator: wsPostStreamValidator, resetRetries: wsResetPostStreamRetries } =
  buildSharedPostStreamValidator(logger)

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

// Unified parallel assessment state per socket
// In budget service mode (budgetServiceEnabled=true), stores both the promise and its resolved outcome.
// The outcome is eagerly cached via .then() when the promise resolves, ensuring it's available
// before onBudgetReport fires (which can happen before beforeMessageComplete in some flows).
// Lifecycle: created in onMessageStart, outcome populated on promise resolution,
// cleaned up in onMessageComplete (promise) and onBudgetReport (full state).
// TTL pruning: if onBudgetReport never fires (error before budget session, disconnect mid-message),
// entries are pruned after MAX_ASSESSMENT_STATE_AGE_MS when map exceeds threshold.
const parallelAssessmentStates = new Map<string, ParallelAssessmentState>()
const MAX_ASSESSMENT_STATE_AGE_MS = 60 * 60 * 1000 // 1 hour (assessment should complete in seconds)

// Track assessment outcomes per socket for blocking mode (grants)
// In blocking mode (budgetServiceEnabled=false), the outcome is stored directly after awaiting.
// Lifecycle: populated in onMessageStart, consumed in beforeMessageComplete/onMessageComplete,
// cleaned up in onMessageComplete
const blockingAssessmentOutcomes = new Map<string, AssessmentOutcome>()

// Track pending budget overrides from assessment to apply in context provider
// Populated in onMessageStart, consumed in contextProvider, cleaned up in onDisconnection
const pendingBudgetOverrides = new Map<string, string>()

// Track effective subscriptionId per socket for onBudgetReport override detection
// Needed because socket may disconnect before report fires, losing access to agentContext.
// Set in onMessageStart, consumed in onBudgetReport, cleaned up after createReport/onDisconnection.
const effectiveSubscriptionIds = new Map<string, string>()

// Cache agentContext per socket so mid-turn LLM steps can read JWT fields
// even if the socket disconnects during execution. Set in onMessageStart,
// cleaned up in onMessageComplete, onBudgetReport, onError, and onDisconnection.
const cachedAgentContexts = new Map<string, Record<string, unknown>>()

// Cache last user message per socket for assessment multi-turn context
const lastUserMessageCache = new Map<string, string>()

// Cache last assessment task type per socket for session context gating
// Self-healing: updates on every classification (including general) so the gate
// only fires at intent-transition boundaries, not for the rest of the session
const lastAssessmentTaskTypeCache = new Map<string, AssessmentTaskType>()

// Map socketId -> { conversationId, createdAt } for cost-attribution OTel context.
// Same keying pattern as parallelAssessmentStates: set in onMessageStart with socketId;
// onBudgetReport reads and clears with originalSocketId. TTL-pruned when the map exceeds
// threshold to handle cases where onBudgetReport never fires.
const budgetReportConversationCache = new Map<string, { conversationId: string; createdAt: number }>()
const MAX_BUDGET_REPORT_CONVERSATION_CACHE_AGE_MS = 60 * 60 * 1000 // 1 hour

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
const clientActionServices = new Map<string, IClientActionService>()

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
): IClientActionService | null {
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
export function getClientActionService(socketId: string): IClientActionService | null {
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
 * Register an external (non-WebSocket) action service keyed by an arbitrary ID.
 * Used by SSE transport to make client-action dispatching work without a Socket.IO socket.
 */
export function registerExternalActionService(key: string, service: IClientActionService): void {
  clientActionServices.set(key, service)
}

export function unregisterExternalActionService(key: string): void {
  cleanupClientActionService(key)
}

/**
 * Build dynamic data message for system prompt enrichment
 * Note: Must be a user message to avoid Anthropic's restriction on multiple system messages
 */

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
    checkAndSummarize(appId: string, triggerTokenCount?: number, budgetOverride?: BudgetOverride, customerId?: string): Promise<void>
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

    // Resolve the conversation stores and initialize background summarization
    const lifecycleStore = getConversationLifecycleStore()
    const messageStore = getMessageStore()
    const { initializeBackgroundSummarization } = await import('../services/summarization/index.js')

    backgroundSummarizer = await initializeBackgroundSummarization()

    // Initialize SSE transport infrastructure
    sseEventChannelInstance = new ConversationEventChannel()
    sseAgentFactoryInstance = agentFactory

    // Periodically purge idle per-conversation event buffers (matches the WS
    // server's 60s cleanup cadence in packages/ai-transport).
    sseEventChannelCleanupInterval = setInterval(() => {
      const removed = sseEventChannelInstance?.cleanup() ?? 0
      if (removed > 0) {
        logger.debug('sse.event_channel.cleanup', { removedConversations: removed })
      }
    }, 60_000)
    sseEventChannelCleanupInterval.unref?.()

    const wsAgentRouter = createAgentRouter({
      hasMessagesForApp: (appId) => messageStore.hasMessagesForApp(workspaceScopeFromAppId(appId)),
      getTemplateIds,
    })

    // Create token-based conversation history provider using the message store
    const conversationContextManager = new ConversationContextManager(messageStore, 10) // Max 10 messages

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
              // Get agentContext from socket (live) or cached (if socket disconnected mid-turn)
              const socketId = (context as any).socketId as string | undefined
              const socket = socketId && ioInstance ? ioInstance.sockets.sockets.get(socketId) : null
              // Both sources hold the buildAgentContext output — the typed
              // AgentContext is authoritative. An inline cast here previously
              // claimed fields that buildAgentContext didn't actually map
              // (e.g. useAtlasCrawler), which silently broke the
              // appbuilder-atlas-crawler rollout. Read through AgentContext
              // so omissions surface as compile errors.
              const agentContext = (socket?.handshake?.auth?.agentContext ?? (socketId ? cachedAgentContexts.get(socketId) : undefined)) as AgentContext | undefined
              // Use authType to distinguish employee sessions (e2s, e2s2s, etc.) from delegate (s2s)
              const isEmployeeSession = isEmployeeAuthType(agentContext?.authType)
              const useTestBudget = agentContext?.useTestBudget === true
              const budgetServiceEnabled = agentContext?.budgetServiceEnabled === true
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
                budgetServiceEnabled,
                subscriptionId: agentContext?.subscriptionId,
                bmsBudgetId: agentContext?.bmsBudgetId,
                agentContext
              })

              // TODO: Move budget override to its own field (e.g., metadata.budgetOverrideType) instead of
              // overriding subscriptionId. This conflates the customer's real subscription ID with the
              // override type, making it harder to track the original subscription for analytics/billing.
              // The override should be a separate field that processBudgetReport checks for attribution.
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
              // Employee/test sessions flow through BMS with 100% GoDaddy attribution (isBmsOverride).
              // Use JWT bmsBudgetId (not app DB) since the app record can be stale.
              // Note: subscriptionId is already set above to BudgetOverride.CareAgent/TestAccounts
              // for employee/test sessions - don't overwrite it with JWT subscriptionId.
              if (agentContext?.budgetServiceEnabled) {
                agentsAppContext.metadata.budgetServiceEnabled = true
                // Only use JWT subscriptionId for regular sessions - employee/test sessions
                // keep their override subscriptionId (set above) for isBmsOverride() detection
                if (agentContext.subscriptionId && !isEmployeeSession && !useTestBudget) {
                  agentsAppContext.metadata.subscriptionId = agentContext.subscriptionId
                }
                if (agentContext.bmsBudgetId) {
                  agentsAppContext.metadata.bmsBudgetId = agentContext.bmsBudgetId
                }

                logger.info('context.budget_service_mode.enabled', {
                  appId,
                  socketId: socketId || 'missing',
                  hasSubscriptionId: !!agentsAppContext.metadata.subscriptionId,
                  hasBmsBudgetId: !!agentContext.bmsBudgetId,
                  isEmployeeSession,
                  useTestBudget,
                  subscriptionId: agentsAppContext.metadata.subscriptionId,
                })
              }

              if (agentContext?.useAtlasCrawler) {
                agentsAppContext.metadata.useAtlasCrawler = true
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
          const allImages = collectImagesFromFormattedContexts(contextResult.formattedContexts as any)
          if (allImages.length > 0) {
            if (!agentsAppContext.metadata) {
              agentsAppContext.metadata = {}
            }
            agentsAppContext.metadata._screenshots = allImages
            logger.info('websocket.context.provider.images_attached', { total: allImages.length })
          }

          // Build dynamic data section
          const dynamicDataMessage = buildDynamicDataMessage(agentsAppContext.metadata ?? {})

          // Build todo list context if a list is selected
          const sessionId = agentsAppContext.metadata?.sessionId as string
          const todoContextMessage = sessionId ? await buildTodoContextMessage({
            sessionId,
            appId: agentsAppContext.metadata?.appId as string,
            metadata: agentsAppContext.metadata ?? {},
            contextAttachments: agentsAppContext.contextAttachments,
            stateManager,
          }) : null

          // Search KnowB with user's message for relevant documentation
          // CACHING: KnowB results are query-dependent (change every request), so they MUST be
          // inserted 'after_history' to preserve caching of stable prefix content.
          const ragContextMessage = await buildRagContextMessage({
            userMessage: agentsAppContext.metadata?._userMessage as string,
            appId: agentsAppContext.metadata?.appId as string,
            sessionId,
          })

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

          // Append pinned-skill mode context (deep-build, etc.) so pinned skill
          // instructions are present on every turn without requiring the agent
          // to re-load them. These are system-role messages tagged
          // `insertionOrder: 'before_history'` so they bucket with the leading
          // system messages — Anthropic rejects system messages interleaved
          // between user/assistant turns.
          const pinSelection = selectCacheConversationId(agentsAppContext);
          if (pinSelection.value) {
            const pinAppId = agentsAppContext.metadata?.appId as string | undefined;
            const pinAppPath = pinAppId ? appRepo.findById(pinAppId)?.path : undefined;
            const pinnedMessages = await buildPinnedSkillsContextMessages(pinSelection.value, pinAppPath);
            for (const msg of pinnedMessages) {
              allMessages.push(msg);
            }
          } else {
            logger.warn('skill.pinned.context.no_conversation_id', {
              metadataKeys: Object.keys(agentsAppContext.metadata ?? {})
            });
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
          const conversation = await getConversationLifecycleStore().getById(conversationId);

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
            appId,  // Enables summary pin refresh + stable prefix compression
            metadata.customerId as string | undefined
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
        try {
          const result = await getMessageStore().getMessagesPaginated(
            workspaceScopeFromAppId(appId),
            conversationId,
            {
              limit: options?.limit ?? 20,
              before: options?.before
            }
          )

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
              persistedMsg.toolCalls = mapToolCallsToUI(msg.toolCalls as any)
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
        const latest = await lifecycleStore.getLatestForApp(workspaceScopeFromAppId(appId))
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
      agentRouter: async (socketId: string, data: any) => {
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

        const socket = getSocket(socketId)
        const agentContext = socket?.handshake?.auth?.agentContext
        return wsAgentRouter({
          appId,
          agentId: data.agentId || data.agentName,
          templateId: metadata?.templateId,
          agentProfile: metadata?.agentProfile,
          agentContext,
          session: { sessionId: socketId, stateManager },
        })
      },

      // Transport-layer chunk timeout (env override: AI_CHUNK_TIMEOUT_MS)
      chunkTimeoutMs: parseChunkTimeoutMs(),

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
        customerId?: string
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

          maybeEmitDebugTurnStats({
            appId: metadata.appId,
            conversationId: typeof metadata.conversationId === 'string' ? metadata.conversationId : 'unknown',
            agentName: metadata.agentName,
            modelName: metadata.modelName,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            cachedInputTokens: usage.cachedInputTokens || 0,
            cacheWriteInputTokens: usage.cacheWriteInputTokens || 0,
            cacheHitRate: cacheMetrics.cacheHitRate,
            contextWindowUtilization: contextUtilization,
            costUsd: costEstimate.totalCost,
          })

          if (backgroundSummarizer) {
            checkAndTriggerSummarization({
              inputTokens: usage.inputTokens,
              appId: metadata.appId!,
              conversationId: metadata.conversationId as string | undefined,
              subscriptionId: metadata.subscriptionId as string | undefined,
              customerId: metadata.customerId as string | undefined,
              summarizer: backgroundSummarizer,
            })
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
        } else if (socketId) {
          // Socket disconnected mid-turn — use cached agentContext from turn start
          agentContext = cachedAgentContexts.get(socketId) ?? null
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

        // Prune stale parallelAssessmentStates (leaked when onBudgetReport never fires)
        if (parallelAssessmentStates.size > PRUNE_THRESHOLD_SIZE || effectiveSubscriptionIds.size > PRUNE_THRESHOLD_SIZE) {
          const now = Date.now()
          for (const [id, state] of parallelAssessmentStates) {
            if (now - state.createdAt > MAX_ASSESSMENT_STATE_AGE_MS) {
              parallelAssessmentStates.delete(id)
              effectiveSubscriptionIds.delete(id)
              cachedAgentContexts.delete(id)
              // Warn-level so operators can correlate with budget.report.assessment_outcome_missing
              // hadOutcome distinguishes true leaks (false) from potential billing attribution loss (true)
              logger.warn('assessment.parallel_mode.stale_entry_pruned', {
                socketId: id,
                hadOutcome: !!state.outcome,
                ageMs: now - state.createdAt,
              })
            }
          }
        }

        // Prune stale budgetReportConversationCache (leaked when onBudgetReport never fires)
        if (budgetReportConversationCache.size > PRUNE_THRESHOLD_SIZE) {
          const now = Date.now()
          for (const [key, entry] of budgetReportConversationCache) {
            if (now - entry.createdAt > MAX_BUDGET_REPORT_CONVERSATION_CACHE_AGE_MS) {
              budgetReportConversationCache.delete(key)
              logger.warn('budget.session_conversation_id.stale_entry_pruned', {
                socketId: key,
                ageMs: now - entry.createdAt,
              })
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

        // Reset the post-hook retry counters for this turn. Any leftover
        // count from a prior message on the same socket would incorrectly
        // shrink either retry budget here.
        wsResetPostStreamRetries(socketId);

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
        const latestConversation = await lifecycleStore.getLatestForApp(workspaceScopeFromAppId(siteId))
        let isInitialPrompt = false
        if (latestConversation) {
          // Check if this is the first user message (efficient count query)
          const messageCount = await messageStore.getMessageCount(latestConversation.id)
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

        // Git hook: check setup status, ensure correct branch, create feature branch.
        // Coordinates with nomad_setup.sh via dev-supervisor setup status API.
        // Shared with SSE via `runStartGitHook`; failures are logged inside and never throw.
        await runStartGitHook(lifecycleDeps, {
          appId: siteId,
          conversationId: typedContext?.conversation?.conversationId,
          sessionKey: socketId,
          message,
        })

        // Authentication already done at handshake - just log the message start

        logger.info('websocket.message.start', {
          message: 'WebSocket message from site',
          siteId,
          messagePreview: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
          agentName
        });

        // Budget Service pre-execution check + session creation
        // Read budget flags from JWT (socket handshake auth), not client context.
        // contextProvider enriches metadata later, but pre-check runs before that.
        const preCheckSocket = getSocket(socketId)
        const preCheckAgentContext = preCheckSocket?.handshake?.auth?.agentContext

        // Cache agentContext for the duration of this turn so contextProvider/contextExtractor
        // can read JWT fields even if the socket disconnects mid-execution.
        if (preCheckAgentContext) {
          cachedAgentContexts.set(socketId, preCheckAgentContext)
        }
        const budgetResult = await performBudgetPreCheck(
          {
            budgetServiceEnabled: preCheckAgentContext?.budgetServiceEnabled,
            subscriptionId: preCheckAgentContext?.subscriptionId as string | undefined,
            bmsBudgetId: preCheckAgentContext?.bmsBudgetId as string | undefined,
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

          const selection = selectCacheConversationId(typedContext)
          if (selection.value) {
            budgetReportConversationCache.set(socketId, {
              conversationId: selection.value,
              createdAt: Date.now(),
            })
            logger.debug('budget.report.cache_written', {
              socketId,
              appId: siteId,
              customerId,
              conversationId: selection.value,
              sourceField: selection.source,
            })
          } else {
            logger.warn('budget.report.cache_write_skipped', {
              socketId,
              appId: siteId,
              customerId,
              reason: 'no conversationId on metadata or conversation context',
              hasMetadata: !!typedContext?.metadata,
              hasConversation: !!typedContext?.conversation,
            })
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

        // Assessment Agent: Classify prompt to determine intent
        // Behavior depends on budget service mode:
        // - Flag OFF (grants mode): BLOCKING - must complete to set GoCode userId for budget routing
        // - Flag ON (budget service mode): PARALLEL - non-blocking, used for post-execution attribution
        //
        // Get Switchboard flags from JWT context (takes precedence over env var)
        // - enableAssessmentAgent: Run classification and log results (for monitoring)
        // - enableAssessmentOverride: Actually apply budget override (requires enableAssessmentAgent, grants mode only)
        const socket = getSocket(socketId)
        const agentContext = socket?.handshake?.auth?.agentContext
        const enableAssessmentAgent = agentContext?.enableAssessmentAgent
        const enableAssessmentOverride = agentContext?.enableAssessmentOverride
        const assessmentClassifier = agentContext?.assessmentClassifier
        // Read budgetServiceEnabled from JWT agentContext, not context metadata
        // Context metadata isn't populated until contextProvider runs (after onMessageStart)
        // Employee/test sessions flow through BMS with 100% GoDaddy attribution (isBmsOverride)
        const isEmployeeSession = isEmployeeAuthType(agentContext?.authType)
        const useTestBudget = agentContext?.useTestBudget === true
        const budgetServiceEnabled = agentContext?.budgetServiceEnabled === true

        const effectiveSubscriptionId = resolveBmsSubscriptionId(
          isEmployeeSession,
          useTestBudget,
          agentContext?.subscriptionId as string | undefined,
        )
        if (effectiveSubscriptionId) {
          effectiveSubscriptionIds.set(socketId, effectiveSubscriptionId)
        }

        logger.info('assessment.feature_flag', {
          appId: siteId,
          socketId,
          enableAssessmentAgent,
          enableAssessmentOverride,
          assessmentClassifier,
          budgetServiceEnabled,
          budgetServiceFlagFromJwt: agentContext?.budgetServiceEnabled === true,
          isEmployeeSession,
          useTestBudget,
        })

        if (enableAssessmentAgent) {
          // Get previous user message for multi-turn context
          // Helps classify follow-ups (e.g., "it doesn't work" after "fix my button")
          // Try cache first, fall back to DB on miss (reconnect scenario)
          let previousUserMessage = lastUserMessageCache.get(socketId)


          if (previousUserMessage) {
            logger.debug('assessment.previous_message.from_cache', {
              appId: siteId, socketId,
              previousMessagePreview: previousUserMessage.substring(0, 50),
            })
          } else if (conversationId && conversationId !== 'default') {
            previousUserMessage = (await messageStore.getLastUserMessage(conversationId)) ?? undefined
            if (previousUserMessage) {
              logger.debug('assessment.previous_message.from_db', {
                appId: siteId, conversationId,
                previousMessagePreview: previousUserMessage.substring(0, 50),
              })
            }
          }

          const previousAssessmentTaskType = lastAssessmentTaskTypeCache.get(socketId)

          // Execute assessment (parallel or blocking based on budgetServiceEnabled)
          // Try/catch is narrowed to executeAssessment only - programmer errors in the switch
          // (assertNever, Map operations) should propagate, not be absorbed as assessment noise.
          let assessmentResult: Awaited<ReturnType<typeof executeAssessment>> | undefined
          try {
            assessmentResult = await executeAssessment({
              socketId,
              message,
              appId: siteId,
              customerId,
              budgetServiceEnabled,
              enableAssessmentOverride: enableAssessmentOverride ?? false,
              isInitialPrompt,
              previousUserMessage,
              previousAssessmentTaskType,
              classifierMode: assessmentClassifier,
            })
          } catch (err) {
            // Assessment failed - log with context and clean up tracking state
            // In blocking mode (grants), this means usedFreeGrants will default to false (customer pays)
            logger.error('assessment.execute.failure', {
              socketId,
              appId: siteId,
              customerId,
              budgetServiceEnabled,
              isInitialPrompt,
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            })
          }

          // Store results based on execution mode (switch ensures exhaustiveness)
          // This block is outside try/catch so assertNever and Map errors propagate as programmer errors
          if (assessmentResult) {
            switch (assessmentResult.mode) {
              case ASSESSMENT_MODE.PARALLEL: {
                // Parallel mode: create unified state with promise and eager outcome caching
                const state: ParallelAssessmentState = {
                  promise: assessmentResult.assessmentPromise,
                  outcome: undefined,
                  createdAt: Date.now(),
                }
                parallelAssessmentStates.set(socketId, state)
                lastUserMessageCache.set(socketId, assessmentResult.messageToCache)

                // Eagerly populate outcome when promise resolves (non-blocking)
                // This ensures state.outcome is available before onBudgetReport fires,
                // which can happen before beforeMessageComplete in some ai-transport flows
                assessmentResult.assessmentPromise.then((outcome) => {
                  state.outcome = outcome
                  // Guard cache write: only update if this state is still current and socket connected.
                  // If message N times out and N+1 starts, N+1 overwrites parallelAssessmentStates -
                  // without this check, N's late .then() would write stale taskType to the cache.
                  const isCurrentState = parallelAssessmentStates.get(socketId) === state
                  const socketStillConnected = getSocket(socketId) != null
                  if (isCurrentState && socketStillConnected && outcome.result?.taskType) {
                    lastAssessmentTaskTypeCache.set(socketId, outcome.result.taskType)
                  }
                  logger.debug('assessment.parallel_mode.eager_cache', {
                    socketId,
                    appId: siteId,
                    taskType: outcome.result?.taskType,
                    confidence: outcome.result?.confidence,
                    cacheUpdated: isCurrentState && socketStillConnected && !!outcome.result?.taskType,
                  })
                }).catch((err) => {
                  // Log at error for production visibility - systematic assessment failures
                  // (network down, quota exhausted, provider 500) need monitoring signals.
                  // Primary error handling is in beforeMessageComplete/onMessageComplete
                  // try/catch blocks via withTimeout.
                  logger.error('assessment.parallel_mode.eager_cache_rejection', {
                    socketId,
                    appId: siteId,
                    error: err instanceof Error ? err.message : String(err),
                    stack: err instanceof Error ? err.stack : undefined,
                  })
                })
                break
              }
              case ASSESSMENT_MODE.BLOCKING: {
                // Blocking mode: store completed outcome directly
                blockingAssessmentOutcomes.set(socketId, assessmentResult.assessmentOutcome)
                lastUserMessageCache.set(socketId, assessmentResult.messageToCache)
                // Cache task type for session context gating (derive from assessmentOutcome)
                if (assessmentResult.assessmentOutcome.result?.taskType) {
                  lastAssessmentTaskTypeCache.set(socketId, assessmentResult.assessmentOutcome.result.taskType)
                }
                if (assessmentResult.pendingBudgetOverride) {
                  pendingBudgetOverrides.set(socketId, assessmentResult.pendingBudgetOverride)
                }
                break
              }
              default:
                assertNever(assessmentResult)
            }
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

      /**
       * Post-stream validator — runs after every completed agent stream
       * iteration, before `beforeMessageComplete`. When the agent has
       * just edited files, we shell out to `tsc --noEmit` inside the
       * preview container and drain the per-app runtime-error buffer in
       * parallel; if either surfaces problems, we trigger another LLM
       * turn with a synthetic prompt listing the errors.
       *
       * Retry budget is enforced here (not inside the service) because the
       * ai-transport hook is the only place with a stable per-turn socketId.
       * The validator is additive: any failure — missing appId, dev-supervisor
       * unreachable, exec crash, etc. — falls through silently so the user's
       * message still finalizes normally and git-squash still runs.
       */
      postStreamValidator: wsPostStreamValidator,

      // Pre-completion callback: runs the shared end-of-message lifecycle
      // (git squash-merge + usedFreeGrants accounting). Shared with SSE.
      beforeMessageComplete: async (socketId: string, context: Record<string, unknown>) => {
        const typedContext = context as AgentsAppContext
        const siteId = typedContext?.metadata?.appId
        const budgetServiceEnabled = typedContext?.metadata?.budgetServiceEnabled === true

        // Get assessment outcome for free grants flag
        // Check both parallel state (budget service mode) and blocking outcomes (grants mode)
        // Note: In rare socket migration scenarios, this lookup may fail. The fallback is safe
        // (usedFreeGrants=false, customer pays). onBudgetReport receives originalSocketId from
        // ai-transport and handles the critical billing path correctly.
        let assessmentOutcome: AssessmentOutcome | undefined
        const parallelState = parallelAssessmentStates.get(socketId)

        if (budgetServiceEnabled && parallelState) {
          // Parallel mode: check eager cache first, then await if needed
          if (parallelState.outcome) {
            assessmentOutcome = parallelState.outcome
          } else if (!parallelState.timedOut) {
            // Only await if not already timed out (prevents double-await in onMessageComplete)
            try {
              const assessmentResult = await withTimeout(
                parallelState.promise,
                PARALLEL_ASSESSMENT_TIMEOUT_MS,
                () => {
                  // Mark as timed out so onMessageComplete skips the second await
                  parallelState.timedOut = true
                  logger.warn('websocket.before_complete.assessment_timeout', {
                    socketId,
                    appId: siteId,
                    timeoutMs: PARALLEL_ASSESSMENT_TIMEOUT_MS,
                    cacheStale: 'lastAssessmentTaskTypeCache not updated, next turn will use stale task type',
                  })
                },
                (err) => {
                  // Log at error for consistency with eager cache rejection handler -
                  // same failure class (LLM network/quota/provider error) should have same severity
                  logger.error('websocket.before_complete.assessment_late_rejection', {
                    socketId,
                    appId: siteId,
                    error: err instanceof Error ? err.message : String(err),
                    detail: 'Assessment promise rejected after timeout, rejection suppressed',
                  })
                }
              )
              if (assessmentResult) {
                assessmentOutcome = assessmentResult
                parallelState.outcome = assessmentResult
                if (assessmentResult.result?.taskType) {
                  lastAssessmentTaskTypeCache.set(socketId, assessmentResult.result.taskType)
                }
                logger.info('websocket.before_complete.assessment_awaited', {
                  socketId,
                  appId: siteId,
                  taskType: assessmentResult.result?.taskType,
                  confidence: assessmentResult.result?.confidence,
                  overrideApplied: assessmentResult.overrideApplied,
                })
              }
            } catch (err) {
              // Mark as timedOut to prevent onMessageComplete from re-awaiting the same
              // already-rejected promise, which would cause triple error logging:
              // 1. eager .catch() in onMessageStart logs assessment.parallel_mode.eager_cache_rejection
              // 2. this catch logs websocket.before_complete.assessment_await_failed
              // 3. onMessageComplete would see timedOut=false and re-await, logging assessment.parallel_mode.error
              parallelState.timedOut = true
              logger.error('websocket.before_complete.assessment_await_failed', {
                socketId,
                appId: siteId,
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
                billingFallback: 'usedFreeGrants will be false (customer pays)',
              })
            }
          }
        } else {
          // Blocking mode: outcome was stored directly in onMessageStart
          assessmentOutcome = blockingAssessmentOutcomes.get(socketId)
        }

        const socket = getSocket(socketId)
        const enableAssessmentOverride = socket?.handshake?.auth?.agentContext?.enableAssessmentOverride ?? false
        const usedFreeGrants = deriveUsedFreeGrants(budgetServiceEnabled, assessmentOutcome, enableAssessmentOverride)

        if (!siteId) {
          logger.debug('websocket.before_complete.no_app_id', { socketId })
          return {
            commitHash: null,
            usedFreeGrants: !!(assessmentOutcome?.overrideApplied && enableAssessmentOverride),
          }
        }

        return runMessageEndHooks(lifecycleDeps, {
          appId: siteId,
          conversationId: typedContext?.conversation?.conversationId,
          sessionKey: socketId,
          reason: 'complete',
          assessmentOutcome,
          enableAssessmentOverride,
        })
      },

      onMessageComplete: async (socketId: string, result: any, context?: Record<string, unknown>) => {
        const duration = result.duration || 'unknown';
        const steps = result.steps || 0;
        const agentId = result.agentId || 'unknown';
        const typedContext = context as AgentsAppContext;
        const appId = typedContext?.metadata?.appId;
        const budgetServiceEnabled = typedContext?.metadata?.budgetServiceEnabled === true

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

        // Collect assessment outcome based on mode
        // - Grants mode (flag OFF): outcome stored directly in onMessageStart
        // - Budget service mode (flag ON): outcome in parallelAssessmentStates (eager cached or await here)
        // Note: In rare socket migration scenarios, this lookup may fail. The fallback is safe.
        // onBudgetReport receives originalSocketId from ai-transport and handles billing correctly.
        let assessmentOutcome: AssessmentOutcome | undefined

        if (budgetServiceEnabled) {
          // Budget service mode: check unified state for outcome
          const parallelState = parallelAssessmentStates.get(socketId)
          if (parallelState) {
            // Check eager cache first, then await if needed (skip if already timed out in beforeMessageComplete)
            const { shouldAwait, reason } = shouldAwaitParallelAssessment(parallelState)
            if (reason === AWAIT_ASSESSMENT_REASON.HAS_OUTCOME) {
              assessmentOutcome = parallelState.outcome
            } else if (shouldAwait) {
              // Only await if not already timed out (prevents double-await from beforeMessageComplete)
              try {
                let timedOut = false
                const assessmentResult = await withTimeout(
                  parallelState.promise,
                  PARALLEL_ASSESSMENT_TIMEOUT_MS,
                  () => {
                    timedOut = true
                    parallelState.timedOut = true
                  },
                  (err) => {
                    // Log at error for consistency with eager cache rejection handler -
                    // same failure class (LLM network/quota/provider error) should have same severity
                    logger.error('assessment.parallel_mode.late_rejection', {
                      appId,
                      socketId,
                      error: err instanceof Error ? err.message : String(err),
                      detail: 'Assessment promise rejected after timeout, rejection suppressed',
                    })
                  }
                )

                if (assessmentResult) {
                  parallelState.outcome = assessmentResult
                  assessmentOutcome = assessmentResult
                  if (assessmentResult.result?.taskType) {
                    lastAssessmentTaskTypeCache.set(socketId, assessmentResult.result.taskType)
                  }
                  logger.info('assessment.parallel_mode.resolved', {
                    appId,
                    socketId,
                    taskType: assessmentResult.result?.taskType,
                    confidence: assessmentResult.result?.confidence,
                    durationMs: assessmentResult.durationMs,
                  })
                } else if (timedOut) {
                  logger.warn('assessment.parallel_mode.timeout', {
                    appId,
                    socketId,
                    timeoutMs: PARALLEL_ASSESSMENT_TIMEOUT_MS,
                    detail: 'Assessment did not complete in time, cost attribution will proceed without intent',
                    cacheStale: 'lastAssessmentTaskTypeCache not updated, next turn will use stale task type',
                  })
                } else {
                  // Invariant violation: withTimeout only returns null via the timeout path,
                  // which always sets timedOut=true before resolving. If we reach here,
                  // there's a bug in withTimeout's internal state machine.
                  logger.error('assessment.parallel_mode.unexpected_null', {
                    appId,
                    socketId,
                    detail: 'Invariant violation: withTimeout returned null but timedOut callback was not invoked',
                  })
                }
              } catch (err) {
                logger.error('assessment.parallel_mode.error', {
                  appId,
                  socketId,
                  error: err instanceof Error ? err.message : String(err),
                  stack: err instanceof Error ? err.stack : undefined,
                  billingFallback: 'onBudgetReport will proceed without intent classification',
                })
              }
            }
          }
          // Note: parallelAssessmentStates cleanup is deferred to onBudgetReport
        } else {
          // Blocking mode: outcome was stored directly in onMessageStart
          assessmentOutcome = blockingAssessmentOutcomes.get(socketId)
        }

        const socket = getSocket(socketId)
        const enableAssessmentOverride = socket?.handshake?.auth?.agentContext?.enableAssessmentOverride ?? false

        // Log free grants usage (grants mode only - budget service mode doesn't use budget override)
        if (!budgetServiceEnabled && assessmentOutcome?.overrideApplied && enableAssessmentOverride && appId) {
          logger.info('grants.assessment.free_task_completed', {
            appId,
            customerId: promptMeta?.customerId,
            taskType: assessmentOutcome?.result?.taskType,
            appliedBudget: assessmentOutcome?.appliedBudget,
            durationMs: assessmentOutcome?.durationMs,
          })
        }

        // Clean up per-message socket state
        // - Blocking mode: clean up blockingAssessmentOutcomes immediately
        // - Parallel mode: defer parallelAssessmentStates cleanup to onBudgetReport
        if (!budgetServiceEnabled) {
          blockingAssessmentOutcomes.delete(socketId)
        }
        pendingBudgetOverrides.delete(socketId)
        cachedAgentContexts.delete(socketId)
        wsResetPostStreamRetries(socketId)

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

      onBudgetExhaustedMidStream: async (socketId: string, _error: Error, executedToolNames: string[]) => {
        // Mid-stream grant advancement is grants-mode only. BMS sessions use a different
        // budget enforcement path and don't have grants to advance.
        const budgetSocket = getSocket(socketId)
        if (budgetSocket?.handshake?.auth?.agentContext?.budgetServiceEnabled === true) {
          logger.info('grants.mid_stream.skipped_bms_session', { socketId })
          return { retry: false, hasNonIdempotentTools: hasNonIdempotentTools(executedToolNames) }
        }

        const hasNonIdempotent = hasNonIdempotentTools(executedToolNames)

        try {
          const advanced = grantSessionManager.advanceToNextGrant(socketId)
          if (advanced) {
            const newUserId = grantSessionManager.getCurrentUserId(socketId)
            if (newUserId) {
              logger.info('grants.mid_stream.advanced', {
                socketId,
                newUserId,
                hasNonIdempotentTools: hasNonIdempotent,
                executedToolNames,
              })
              return { retry: true, newUserId, hasNonIdempotentTools: hasNonIdempotent }
            }
            logger.warn('grants.mid_stream.advanced_but_no_userid', {
              socketId,
              reason: 'advanceToNextGrant returned true but getCurrentUserId returned null',
            })
          }

          // Local advance failed, request refresh from frontend
          const gotNewGrants = await grantSessionManager.requestGrantRefreshAndWait(socketId, 5000)
          if (gotNewGrants) {
            const newUserId = grantSessionManager.getCurrentUserId(socketId)
            if (newUserId) {
              logger.info('grants.mid_stream.refresh_advanced', {
                socketId,
                newUserId,
                hasNonIdempotentTools: hasNonIdempotent,
                executedToolNames,
              })
              return { retry: true, newUserId, hasNonIdempotentTools: hasNonIdempotent }
            }
            logger.warn('grants.mid_stream.refresh_but_no_userid', {
              socketId,
              reason: 'requestGrantRefreshAndWait returned true but getCurrentUserId returned null',
            })
          }

          logger.warn('grants.mid_stream.all_exhausted', {
            socketId,
            executedToolNames,
          })
          return { retry: false, hasNonIdempotentTools: hasNonIdempotent }
        } catch (err) {
          logger.error('grants.mid_stream.callback_internal_error', {
            socketId,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          })
          return { retry: false, hasNonIdempotentTools: hasNonIdempotent }
        }
      },

      onBudgetReport: async (budgetId: string, sessionId: string, socketId: string, originalSocketId: string, steps?: ExecutionStep[], wasUserAborted?: boolean) => {
        // Turn complete — agentContext cache no longer needed for this socket
        cachedAgentContexts.delete(originalSocketId)

        const client = getBudgetServiceClient()
        if (!client) {
          budgetReportConversationCache.delete(originalSocketId)
          parallelAssessmentStates.delete(originalSocketId)
          effectiveSubscriptionIds.delete(originalSocketId)
          throw new Error('Budget service client unavailable')
        }

        // Get session cost (GoCode reports cost async, may be 0 due to race)
        // Retry on transient errors since getSession is on the critical path for report filing
        const maxGetSessionRetries = 2
        let session: Awaited<ReturnType<typeof client.getSession>> | undefined
        for (let attempt = 0; attempt <= maxGetSessionRetries; attempt++) {
          try {
            session = await client.getSession(sessionId)
            break
          } catch (err) {
            const isTransient = err instanceof BudgetServiceTimeoutError || err instanceof BudgetServiceUnavailableError
            if (!isTransient || attempt === maxGetSessionRetries) {
              logger.error('budget.report.getSessionFailed', {
                budgetId, sessionId, attempt, maxRetries: maxGetSessionRetries,
                error: err instanceof Error ? err.message : String(err),
              })
              budgetReportConversationCache.delete(originalSocketId)
              parallelAssessmentStates.delete(originalSocketId)
              effectiveSubscriptionIds.delete(originalSocketId)
              throw err
            }
            // Full jitter backoff: random delay in [0, min(cap, base * 2^attempt)]
            const baseDelay = 100
            const maxDelay = 2000
            const delay = Math.random() * Math.min(maxDelay, baseDelay * Math.pow(2, attempt))
            await new Promise((r) => setTimeout(r, delay))
          }
        }
        // TypeScript doesn't know that the loop either assigns session or throws
        if (!session) {
          budgetReportConversationCache.delete(originalSocketId)
          parallelAssessmentStates.delete(originalSocketId)
          effectiveSubscriptionIds.delete(originalSocketId)
          throw new Error('getSession failed without throwing')
        }

        // Get assessment outcome for intent-based attribution
        // In parallel mode, state.outcome is eagerly populated via .then() in onMessageStart
        // when the classification promise resolves (before onBudgetReport fires).
        // Use originalSocketId since that's the socketId used when storing the state.
        // Note: Cleanup is deferred until after createReport succeeds to allow retry attempts
        const parallelState = parallelAssessmentStates.get(originalSocketId)
        const assessmentOutcome = parallelState?.outcome

        // Log when assessment outcome is missing - helps diagnose attribution degradation
        // Causes: (a) timed out in beforeMessageComplete/onMessageComplete, (b) promise rejected,
        // (c) state never created (socket migration). Diagnostic fields help distinguish these.
        if (!assessmentOutcome) {
          logger.warn('budget.report.assessment_outcome_missing', {
            budgetId,
            sessionId,
            originalSocketId,
            socketId,
            timedOut: parallelState?.timedOut ?? false,
            stateExists: !!parallelState,
            message: 'Attribution will proceed without intent data',
          })
        }

        // Get effective subscriptionId for override detection (care agent, test accounts)
        // Prefer stashed value from onMessageStart since socket may have disconnected
        const stashedSubscriptionId = effectiveSubscriptionIds.get(originalSocketId)
        let reportSubscriptionId: string | undefined

        if (stashedSubscriptionId) {
          reportSubscriptionId = stashedSubscriptionId
        } else {
          // Fallback to live socket if stashed value missing (shouldn't happen normally)
          const reportSocket = getSocket(originalSocketId)
          if (reportSocket) {
            const reportAgentContext = reportSocket.handshake?.auth?.agentContext
            reportSubscriptionId = resolveBmsSubscriptionId(
              isEmployeeAuthType(reportAgentContext?.authType),
              reportAgentContext?.useTestBudget === true,
              reportAgentContext?.subscriptionId as string | undefined,
            )
          } else {
            // Socket disconnected and no stashed value - log for audit
            logger.warn('budget.report.subscription_id_unavailable', {
              budgetId,
              sessionId,
              originalSocketId,
              socketId,
              message: 'Socket disconnected and no stashed subscriptionId - override detection unavailable',
            })
          }
        }

        // Process cost attribution using rule-based detection
        // safeProcessBudgetReport handles errors gracefully so createReport still executes
        const { result: budgetReport } = safeProcessBudgetReport(
          {
            budgetId,
            sessionId,
            totalCost: session.costTotal,
            sessionItems: session.sessionItems,
            steps,
            assessmentOutcome,
            wasUserAborted,
            subscriptionId: reportSubscriptionId,
          },
          { budgetId, sessionId },
        )
        const { reportItems, executionData, sessionWasFree, attributionResult, attributionPath, labels } = budgetReport

        // createReport is the critical path (credits deducted). Must not be blocked
        // by getBudget failure. Returns full ReportResponse (BMS parity, PR #2577).
        let report
        try {
          report = await client.createReport(sessionId, { reportItems, allowOverage: true })
        } catch (err) {
          // 409 Conflict = report already exists for this session (idempotency).
          // Credits were already deducted by the prior POST. Tell client to refresh
          // to get accurate balance - we don't have the original report to return.
          // Preserve sessionWasFree since 409 fires when first attempt succeeded (credits already at $0)
          if (err instanceof BudgetServiceConflictError) {
            logger.info('budget.report.conflict_idempotent', {
              budgetId,
              sessionId,
              sessionWasFree,
              message: 'Report already exists - telling client to refresh',
            })
            parallelAssessmentStates.delete(originalSocketId)
            effectiveSubscriptionIds.delete(originalSocketId)
            budgetReportConversationCache.delete(originalSocketId)
            return { refreshRequired: true, sessionWasFree }
          }

          const budgetError = err instanceof BudgetServiceError ? err : null
          logger.error('budget.report.createReportFailed', {
            budgetId,
            sessionId,
            error: err instanceof Error ? err.message : String(err),
            statusCode: budgetError?.statusCode,
            responseBody: budgetError?.responseBody,
          })
          parallelAssessmentStates.delete(originalSocketId)
          effectiveSubscriptionIds.delete(originalSocketId)
          budgetReportConversationCache.delete(originalSocketId)
          throw err
        }

        // Log report creation with attribution summary
        if (attributionResult) {
          const attributionContext: AttributionContext = {
            budgetId,
            sessionId,
            conversationId: undefined,
            appId: undefined,
          }
          logReportCreated(attributionResult, report.reportId, attributionContext)
        } else {
          // Log for default/fallback paths that don't have attributionResult
          logger.info('budget.report.created', {
            budgetId,
            sessionId,
            reportId: report.reportId,
            totalCost: session.costTotal,
            sessionWasFree,
            attributionPath,
          })
        }

        // Credits already deducted; observability must not break the critical path.
        // Catches payload-build, conversationId lookup, and serializer throws (all code
        // defects). OTel SDK emit failures are fire-and-forget inside emitCustomEvent.
        try {
          // TODO(jvogt): replace with a unified app-wide agentId once instrumentation is consolidated.
          const agentId = 'airo-app-builder-cost-attribution'
          const conversationId = budgetReportConversationCache.get(originalSocketId)?.conversationId
          if (!conversationId) {
            // Without conversationId the OTel SDK silently drops the event. Logging here
            // makes the gap queryable when a class of sessions is missing from telemetry.
            logger.warn('budget.report.attribution_emit_missing_conversation_id', {
              budgetId,
              sessionId,
              reportId: report.reportId,
              originalSocketId,
              socketId,
            })
          }

          const attribution = buildAttributionPayload({
            attributionResult,
            totalCost: session.costTotal,
            sessionWasFree,
            fallbackLabels: labels,
          })

          const assessment: AttributionAssessment | undefined = assessmentOutcome?.result?.taskType
            ? { intent: assessmentOutcome.result.taskType }
            : undefined

          otelContext.with(
            createAgentContext({ conversationId, agentId }),
            () => {
              emitCostAttributionResult({
                budgetId,
                budgetSessionId: sessionId,
                reportId: report.reportId,
                executionData,
                assessment,
                totalCost: session.costTotal,
                sessionWasFree,
                attributionPath,
                attribution,
              })
            },
          )
        } catch (err) {
          logger.error('budget.report.attribution_emit_failed', {
            budgetId,
            sessionId,
            reportId: report.reportId,
            attributionPath,
            totalCost: session.costTotal,
            sessionWasFree,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          })
        } finally {
          // Clean up all per-message state on the success path
          parallelAssessmentStates.delete(originalSocketId)
          effectiveSubscriptionIds.delete(originalSocketId)
          budgetReportConversationCache.delete(originalSocketId)
        }

        // getBudget for per-item breakdown (post-deduction state). Graceful degradation.
        // Note: createReport succeeded at this point, so sessionWasFree is valid even if getBudget fails
        try {
          const budget = await client.getBudget(budgetId)
          const payload = toBudgetUpdatePayload(report, budget, sessionWasFree)

          // Log the payload sent to client with reportItems summary
          const clientReportItems = payload.assignment.reportItems
          logger.info('budget.update.payload_sent', {
            budgetId,
            sessionId,
            reportId: report.reportId,
            sessionWasFree,
            reportItemCount: clientReportItems.length,
            totalBudgetCost: report.budgetCostTotal,
            totalProductCost: report.productCostTotal,
            categories: clientReportItems.map(item => item.category),
            budgetItemCount: payload.budgetItems.length,
          })

          return { refreshRequired: false, payload, sessionWasFree, reportId: report.reportId }
        } catch (err) {
          logger.error('budget.report.payload_failed', {
            budgetId,
            sessionId,
            reportId: report.reportId,
            error: err instanceof Error ? err.message : String(err),
          })
          // Return sessionWasFree so "completed for free" UI signal isn't lost
          // Client will need to refresh for accurate balance, but free task status is preserved
          return { refreshRequired: true, sessionWasFree }
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
        // Note: parallelAssessmentStates is NOT deleted here because:
        // - onBudgetReport handles cleanup using originalSocketId after createReport succeeds
        // Deleting here would race with onBudgetReport and cause attribution to fail silently.
        // Small memory leak risk for sockets that disconnect mid-message before budget report,
        // but this is acceptable vs incorrect billing.
        // Only populated in grants mode; no-op in BMS mode. Prevents leak on mid-message disconnect.
        blockingAssessmentOutcomes.delete(socketId)
        const parallelState = parallelAssessmentStates.get(socketId)
        if (parallelState && !parallelState.outcome) {
          logger.info('assessment.parallel_mode.abandoned_on_disconnect', {
            socketId,
            detail: 'Parallel assessment not yet resolved at disconnect time',
          })
        }

        // Clear on disconnect; late onBudgetReport can miss conversationId.
        budgetReportConversationCache.delete(socketId)
        pendingBudgetOverrides.delete(socketId)
        cachedAgentContexts.delete(socketId)
        lifecycleSessionStore.clearSession(socketId)
        wsResetPostStreamRetries(socketId)

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

          // Track the git operation so shutdown can await it (shared end-hook).
          const gitOp = runMessageEndHooks(lifecycleDeps, {
            appId,
            conversationId,
            sessionKey: socketId,
            reason: 'disconnection',
            enableAssessmentOverride: false,
          })
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
          await lifecycleStore.updateAgentId(conversationId, newAgentName)
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

        // Clean up retry tracking
        // Assessment state cleanup: In BMS mode, preserved for onBudgetReport.
        // In grants/blocking mode, clean up since no budget report follows.
        pendingBudgetOverrides.delete(socketId)
        cachedAgentContexts.delete(socketId)
        wsResetPostStreamRetries(socketId)
        const budgetServiceEnabled = typedContext?.metadata?.budgetServiceEnabled === true
        const { preserved } = cleanupAssessmentStateOnError(
          budgetServiceEnabled,
          parallelAssessmentStates,
          blockingAssessmentOutcomes,
          socketId
        )
        // BMS mode: parallelAssessmentStates preserved for onBudgetReport cleanup.
        // If onBudgetReport never fires (error before budget session created), entry may leak.
        // Leaked entries are pruned via TTL in onConnection when map exceeds threshold.
        void preserved

        // Git hook: Squash merge to main on error (shared with SSE).
        if (appId) {
          await runMessageEndHooks(lifecycleDeps, {
            appId,
            conversationId: typedContext?.conversation?.conversationId,
            sessionKey: socketId,
            reason: 'error',
            enableAssessmentOverride: false,
          })
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
      } else if (sessionId.startsWith('sse:')) {
        // SSE sessions are keyed as sse:${conversationId} but subscribers listen on conversationId
        const conversationId = sessionId.slice(4)
        const eventChannel = getSSEEventChannel()
        if (eventChannel) {
          eventChannel.publish(conversationId, {
            conversationId,
            type: 'request_grant_refresh',
            content: '',
            data: {},
            agentName: 'system',
          })
          logger.info('sse.grant_context.refresh_emitted', {
            conversationId,
            subscriptionId,
          })
        } else {
          logger.warn('websocket.grant_context.refresh_no_sockets', {
            socketId: sessionId,
            subscriptionId,
            message: 'No connected sockets for subscription - refresh will timeout',
          })
        }
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
        // Register early so existing grants (reconnection) are available for first LLM call
        const agentCtx = socket.handshake.auth.agentContext;
        if (agentCtx?.subscriptionId && !agentCtx?.budgetServiceEnabled) {
          grantSessionManager.registerSession(socket.id, agentCtx.subscriptionId);
        }

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
          socket.data = { ...socket.data, authenticated: true };

          logger.info('websocket.auth.connection_approved', {
            message: 'Connection approved: JWT validation passed (authenticate event)',
            siteId: authResult.agentContext!.siteId,
            tokenTTL: authResult.agentContext!.exp - authResult.agentContext!.iat,
            socketId: socket.id,
            authPhaseMs: Date.now() - (socket.data?.connectTime || Date.now()),
          }, { tags: ['security'] });

          registerTokenRefreshHandler(socket);

          // Register early so existing grants (reconnection) are available for first LLM call
          if (authResult.agentContext?.subscriptionId && !authResult.agentContext?.budgetServiceEnabled) {
            grantSessionManager.registerSession(socket.id, authResult.agentContext.subscriptionId);
          }

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
              agentProfileSelectorEnabled: true,
              exp: now + 3600,
              iat: now
            }
          };
          socket.data = { ...socket.data, authenticated: true };
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
        socket.data = { ...socket.data, authenticated: true };

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
 * Prefer `emitToApp` over `io.emit` for per-app events — global `io.emit`
 * broadcasts cross-tenant.
 */
export function getSocketIO() {
  return ioInstance
}

/**
 * Predicate: can this socket receive per-app events for `appId`?
 *
 * Both checks matter. `socket.data.authenticated` is a server-only flag set
 * after successful JWT validation — the client cannot forge it. `siteId`
 * lives on `handshake.auth`, which is a spread of client-sent input; a
 * connect-then-auth client can preserve a client-chosen `agentContext`
 * until auth completes, so it is only trustworthy once `authenticated` is
 * true.
 *
 * Exported so tests can exercise the exact predicate used by `emitToApp`.
 */
export function isAppEligibleForEmit(
  socket: { data?: { authenticated?: boolean }; handshake: { auth?: { agentContext?: { siteId?: string } } } },
  appId: string,
): boolean {
  if (socket.data?.authenticated !== true) return false
  const siteId: string | undefined = socket.handshake.auth?.agentContext?.siteId
  return !!siteId && siteId === appId
}

/**
 * Emit an event only to sockets authenticated for the given appId.
 *
 * Returns the number of sockets the event was delivered to.
 */
export function emitToApp(appId: string, event: string, payload: unknown): number {
  if (!ioInstance || !appId) return 0
  let delivered = 0
  for (const socket of ioInstance.sockets.sockets.values()) {
    if (!isAppEligibleForEmit(socket, appId)) continue
    socket.emit(event, payload)
    delivered++
  }
  return delivered
}

/**
 * Get the GitHookService instance for shutdown git operations
 */
export function getGitHookService() {
  return gitHookService;
}

