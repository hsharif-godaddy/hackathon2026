import type { ModelMessage } from 'ai'
import { APICallError, RetryError } from 'ai'
import { Server as SocketIOServer } from 'socket.io'
import { Server as HTTPServer } from 'http'
import type { AgentFactory, AgentWrapper, PipelineContextMessage } from '@airo/ai-lib'
import { createAgentFactory } from '@airo/ai-lib'
import { calculateCostEstimate, formatCostEstimate, getCacheHitRate, type TokenUsage } from '@airo/ai-lib'
import { classifyError, BudgetExceededError, isBudgetExceededAPIError, createLogger } from '@airo/ai-common'
import type { AgentsCollection } from '@airo/ai-lib'
import type { HandoffStateManager } from '@airo/ai-lib'
import type {
  MessageProvider,
  ContextProvider,
  HistoryProvider,
  ConversationPersistence,
  ConversationPersistenceWithCleanup,
  ConversationMessage,
  PersistenceStreamingEvent,
  ConversationContext,
  StreamingEventType
} from './interfaces.js'
import { ConversationEventChannel } from './conversation-event-channel.js'
import { WebSocketSubscriber } from './subscribers/websocket-subscriber.js'
import { PersistenceSubscriber } from './subscribers/persistence-subscriber.js'
import { ConnectionStateManager, type ConnectionStateData } from './connection-state-manager.js'
import { ConnectionRecoveryManager } from './connection-recovery-manager.js'
import { context as otelContext } from '@opentelemetry/api'
import { createError, createHandoff } from '@godaddy/agent-observability-events'
import {
  createAgentContext,
  createAgentInvocationSpan,
  emitError,
  emitHandoff
} from '@godaddy/agent-otel-sdk'
import { createTraceContext } from '@signals/otel-sdk'

/**
 * APM agent type for tool execution tracking
 * Using 'any' to avoid strict type dependency on elastic-apm-node
 */
type APMAgent = any
type APMSpan = any


/**
 * Agent execution result with usage tracking
 */
interface AgentExecutionResult {
  usage?: TokenUsage
  totalUsage?: TokenUsage
  finishReason?: string
  toolCalls?: any[]
  caching?: {
    cachedInputTokens?: number
    cacheWriteInputTokens?: number
  }
  /** Summary of reasoning (for models that support extended thinking) */
  reasoningSummary?: string
}

/**
 * Processed context that may include optional application metadata
 */
interface ProcessedContext extends Record<string, unknown> {
  appId?: string
  metadata?: Record<string, unknown>
}

type MetadataRecord = Record<string, unknown> & {
  appId?: string
  conversationId?: string
  subscriptionId?: string
}

/**
 * WebSocket Server Configuration for AgentFactory
 */
export interface WebSocketConfig {
  /** Agents object from agentFactory.defineAgents() (required) */
  agents: AgentsCollection

  /** Default agent name to use if none specified */
  defaultAgent?: string

  /** Optional state manager for agent handoffs */
  stateManager?: HandoffStateManager

  /** Context extractor function for processing custom context */
  contextExtractor?: (rawContext: Record<string, unknown>, socketId?: string) => Record<string, unknown>

  /** File path resolver for uploaded files */
  filePathResolver?: (appId: string, uploadId: string, filename: string) => string

  /** CORS configuration */
  cors?: {
    origin?: string | string[] | boolean
    methods?: string[]
  }

  /** Include detailed usage data in responses */
  includeUsageData?: boolean

  /** Message persistence implementation (required) */
  messagePersistence: ConversationPersistence

  /** Message provider for loading conversation history */
  messageProvider?: MessageProvider

  /** History provider for loading raw UI history (not LLM context) */
  historyProvider?: HistoryProvider

  /** Context provider for loading system context and other contextual messages */
  contextProvider?: ContextProvider

  /** Get latest conversation ID for an app (used for cookie-less recovery) */
  getLatestConversationForApp?: (appId: string) => Promise<string | null>

  /** Optional APM agent for tool execution tracking */
  apmAgent?: APMAgent

  /** Optional function to get active websocket transaction by socket ID */
  getActiveTransaction?: (socketId: string) => APMAgent | undefined

  /** Agent routing hook - determines which agent should handle a message */
  agentRouter?: (socketId: string, data: ChatMessage) => string | undefined

  /** Event handlers */
  onConnection?: (socketId: string) => void | Promise<void>
  onDisconnection?: (socketId: string) => void | Promise<void>
  onMessageStart?: (socketId: string, message: string, agentName?: string, context?: Record<string, unknown>) => void | Promise<void>
  /**
   * Called BEFORE message completion to allow for pre-completion operations
   * (e.g., git commits that need to complete before the complete message is sent)
   *
   * @returns Object with optional commitHash and other data to merge into context
   */
  beforeMessageComplete?: (
    socketId: string,
    context: Record<string, unknown>
  ) => Promise<{
    commitHash?: string | null
    [key: string]: unknown
  } | void>
  onMessageComplete?: (socketId: string, result: {
    agentName: string
    duration: string
    usage?: any
    toolCalls?: any[]
  }, context?: Record<string, unknown>) => void
  onError?: (socketId: string, error: Error, message?: string, context?: Record<string, unknown>) => void | Promise<void>
  onAgentChanged?: (conversationId: string, oldAgentName: string, newAgentName: string, appId?: string) => void | Promise<void>
  onTokenUsage?: (usage: {
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
  }) => void | Promise<void>

  /** LLM call observability hooks */
  onLlmStart?: (data: {
    socketId: string
    model: string
    provider: string
    conversationId?: string
    appId?: string
    context?: Record<string, unknown>
    /** Input messages sent to the LLM */
    input?: Array<{ role: string; content: string }>
    /** Available tools for this LLM call */
    tools?: string[]
    /** Tool choice mode */
    toolChoice?: 'auto' | 'required' | 'none'
  }) => Promise<{ spanId: string; startTime: number } | void> | { spanId: string; startTime: number } | void

  onLlmEnd?: (data: {
    socketId: string
    spanId?: string
    startTime?: number
    model: string
    provider: string
    conversationId?: string
    appId?: string
    usage?: {
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
      cachedTokens?: number
      reasoningTokens?: number
      totalCost?: number
    }
    finishReason?: string
    success: boolean
    context?: Record<string, unknown>
    /** Output messages from the LLM */
    output?: Array<{ role: string; content?: string }>
    /** Tool calls made by the LLM */
    toolCalls?: Array<{ id: string; name: string; arguments?: Record<string, unknown> }>
    /** Response ID from the provider */
    responseId?: string
    /** Summary of reasoning (for models that support extended thinking) */
    reasoningSummary?: string
  }) => void | Promise<void>

  /** Tool execution observability hooks */
  onToolStart?: (data: {
    socketId: string
    toolName: string
    toolCallId: string
    toolInput?: Record<string, unknown>
    conversationId?: string
    appId?: string
    context?: Record<string, unknown>
  }) => Promise<{ spanId: string; startTime: number } | void> | { spanId: string; startTime: number } | void

  onToolEnd?: (data: {
    socketId: string
    toolName: string
    toolCallId: string
    spanId?: string
    startTime?: number
    success: boolean
    toolResponse?: unknown
    conversationId?: string
    appId?: string
    context?: Record<string, unknown>
  }) => void | Promise<void>

  /** Socket.IO server options */
  socketOptions?: Partial<import('socket.io').ServerOptions>

  /** Event channel buffer size per conversation (default: 1000) */
  eventBufferSize?: number

  /** Event channel TTL in ms (default: STREAM_RECOVERY_WINDOW = 10 minutes) */
  eventBufferTTL?: number

  /** Stream recovery window in ms (default: 10 minutes) - time to allow reconnection before aborting stream */
  streamRecoveryWindow?: number

  /** ACK timeout in ms (default: 30 seconds) - time to wait for client acknowledgment after replay */
  ackTimeout?: number
}

/**
 * Chat message data from client
 */
export interface ChatMessage {
  message: string
  agentName?: string // For backward compatibility
  agentId?: string   // Following schema pattern
  context?: Record<string, unknown>
  conversationHistory?: ConversationMessage[]
}

/**
 * WebSocket message types following the normalized event schema
 */
export interface WebSocketMessage {
  type: 'step_start' | 'chunk' | 'tool_start' | 'tool_input_delta' | 'tool_call' | 'tool_result' | 'step_complete' | 'complete' | 'error' | 'agents_available' | 'recovery_status' | 'replay_complete' | 'catchup_status' | 'catchup_complete' | 'history_complete' | 'server_config' | 'conversation_info'
  content: string
  data: Record<string, unknown>
}

/**
 * Modern WebSocket Server for AgentFactory
 *
 * Simplified architecture that always uses an agent factory and supports
 * both single and multi-agent scenarios.
 */
export class WebSocketServer {
  private io: SocketIOServer
  private config: WebSocketConfig
  private logger = createLogger('websocket')

  /**
   * Track active APM spans for tool executions
   * Key format: "socketId:toolId"
   */
  private activeToolSpans: Map<string, APMSpan> = new Map()

  /**
   * Event channel for pub/sub event delivery
   * Enables decoupled event transport and connection recovery
   */
  private eventChannel: ConversationEventChannel

  /**
   * Recovery window for connection state recovery (default: 10 minutes)
   * During this time, streams continue and events are buffered
   * Configurable via WebSocketConfig.streamRecoveryWindow
   */
  private readonly STREAM_RECOVERY_WINDOW: number

  /**
   * Cleanup interval for event channel memory management
   * Runs every 60 seconds to remove expired conversations
   */
  private cleanupInterval: NodeJS.Timeout | null = null

  /**
   * ACK timeout for recovery acknowledgment (default: 30 seconds)
   * Time to wait for client acknowledgment after replay
   * Configurable via WebSocketConfig.ackTimeout
   */
  private readonly ACK_TIMEOUT_MS: number

  /**
   * Consolidated state manager for connection lifecycle
   * Single source of truth for all connection state including:
   * - Active streams (abortController)
   * - Active conversations (conversationId, context, streamingEvents, etc.)
   * - Disconnected streams in recovery window
   * - Socket ID migrations
   * - Pending setup tracking
   * - Cleanup in progress tracking
   */
  private stateManager: ConnectionStateManager

  /**
   * Recovery manager for connection recovery scenarios
   * Handles automatic, manual, and conversation-based recovery
   */
  private recoveryManager: ConnectionRecoveryManager

  constructor(httpServer: HTTPServer, config: WebSocketConfig) {
    this.config = config

    // Initialize configurable timeouts with defaults
    this.STREAM_RECOVERY_WINDOW = config.streamRecoveryWindow ?? 10 * 60 * 1000 // 10 minutes
    this.ACK_TIMEOUT_MS = config.ackTimeout ?? 30_000 // 30 seconds

    // Validate configuration
    if (!config.agents) {
      throw new Error('WebSocketServer requires an agents object in config')
    }

    // Determine event channel TTL (default to recovery window for consistency)
    // Clamp to minimum of recovery window to prevent event loss during reconnection
    const requestedTTL = config.eventBufferTTL ?? this.STREAM_RECOVERY_WINDOW
    const eventBufferTTL = Math.max(requestedTTL, this.STREAM_RECOVERY_WINDOW)

    // TTL guard: warn if configured TTL was clamped up to recovery window
    if (config.eventBufferTTL !== undefined && config.eventBufferTTL < this.STREAM_RECOVERY_WINDOW) {
      this.logger.warn('eventChannel.ttl_clamped_to_recovery_window', {
        configuredTTL: config.eventBufferTTL,
        effectiveTTL: eventBufferTTL,
        recoveryWindow: this.STREAM_RECOVERY_WINDOW,
        message: 'Event buffer TTL was increased to match recovery window to prevent event loss during reconnection.'
      })
    }

    // Initialize event channel for pub/sub event delivery
    this.eventChannel = new ConversationEventChannel({
      capacity: config.eventBufferSize ?? 10_000,
      ttl: eventBufferTTL
    }, this.logger)

    // Initialize connection state manager
    this.stateManager = new ConnectionStateManager({
      recoveryWindow: this.STREAM_RECOVERY_WINDOW,
      ackTimeout: this.ACK_TIMEOUT_MS
    }, this.logger)

    // Initialize connection recovery manager
    this.recoveryManager = new ConnectionRecoveryManager(
      {
        stateManager: this.stateManager,
        eventChannel: this.eventChannel,
        logger: this.logger,
        ...(config.historyProvider && { historyProvider: config.historyProvider }),
        ...(config.getLatestConversationForApp && { getLatestConversationForApp: config.getLatestConversationForApp })
      },
      {
        ackTimeout: this.ACK_TIMEOUT_MS,
        recoveryWindow: this.STREAM_RECOVERY_WINDOW,
        ...(config.apmAgent && { apmAgent: config.apmAgent })
      }
    )

    // Schedule periodic cleanup of expired conversations (every 60 seconds)
    this.cleanupInterval = setInterval(() => {
      const removed = this.eventChannel.cleanup()
      if (removed > 0) {
        this.logger.debug('eventChannel.cleanup', { removedConversations: removed })
      }
    }, 60_000)

    // Initialize Socket.IO server with merged configuration
    // Note: config.socketOptions will override any conflicting keys
    this.io = new SocketIOServer(httpServer, {
      cors: config.cors || {
        origin: "*",
        methods: ["GET", "POST"]
      },
      // Default buffer size for large payloads (e.g., screenshots)
      maxHttpBufferSize: 50 * 1024 * 1024, // 50MB default
      // NOTE: connectionStateRecovery is intentionally disabled.
      // Our custom recovery protocol (manual/conversation/initial modes) handles all
      // reconnection scenarios. The built-in CSR replays packets during socket construction
      // — before client-side deduplication is active — causing duplicates.
      ...config.socketOptions
    })

    this.setupEventHandlers()
  }

  /**
   * Setup Socket.IO event handlers
   */
  private setupEventHandlers(): void {
    this.io.on('connection', async (socket) => {
      const socketId = socket.id
      const auth = socket.handshake.auth || {}
      const previousSocketId = auth.previousSocketId

      // CRITICAL: Register event handlers IMMEDIATELY after connection
      // This ensures handlers are attached even for recovery paths that return early
      // Without this, messages sent after recovery are silently dropped
      socket.on('chat', async (data: ChatMessage) => {
        await this.handleChatMessage(socket, data)
      })

      socket.on('chat_message', async (data: ChatMessage) => {
        await this.handleChatMessage(socket, data)
      })

      socket.on('get_agents', () => {
        this.sendAvailableAgents(socket)
      })

      // Handle load more history request (pagination)
      // Registered early so it's available after recovery paths that return early
      socket.on('load_more_history', async (data: {
        cursor: string
        limit?: number
        conversationId: string
      }) => {
        this.logger.debug('load_more_history requested', {
          socketId,
          conversationId: data.conversationId,
          cursor: data.cursor,
          limit: data.limit
        })

        if (!this.config.historyProvider) {
          this.logger.warn('load_more_history failed: no historyProvider configured', { socketId })
          socket.emit('message', {
            type: 'history_complete',
            content: '',
            data: {
              messageCount: 0,
              hasMore: false,
              nextCursor: null,
              error: 'History provider not configured',
              isLoadMore: true
            }
          })
          return
        }

        // Get appId from state manager first, fall back to socket auth
        const stateData = this.stateManager.getStateData(socketId)
        let appId = stateData?.context?.appId
        if (!appId) {
          const authRecord = socket.handshake.auth as Record<string, unknown>
          appId = authRecord?.appId as string
            ?? (authRecord?.agentContext as Record<string, unknown>)?.appId as string
            ?? (authRecord?.decoded as Record<string, unknown>)?.appId as string
        }

        if (!appId) {
          this.logger.warn('load_more_history failed: no appId', { socketId })
          socket.emit('message', {
            type: 'history_complete',
            content: '',
            data: {
              messageCount: 0,
              hasMore: false,
              nextCursor: null,
              error: 'App context not found',
              isLoadMore: true
            }
          })
          return
        }

        try {
          const historyResult = await this.config.historyProvider.loadHistory(
            data.conversationId,
            appId,
            { before: data.cursor, limit: data.limit ?? 20 }
          )

          const messages = Array.isArray(historyResult)
            ? historyResult
            : historyResult.messages
          const paginationInfo = Array.isArray(historyResult)
            ? { hasMore: false, nextCursor: null }
            : { hasMore: historyResult.hasMore, nextCursor: historyResult.nextCursor }

          let historySequence = -2000
          for (const msg of messages) {
            socket.emit('message', {
              type: 'history_message',
              content: '',
              data: {
                ...msg,
                sequence: historySequence--,
                isLoadMore: true
              }
            })
          }

          socket.emit('message', {
            type: 'history_complete',
            content: '',
            data: {
              messageCount: messages.length,
              hasMore: paginationInfo.hasMore,
              nextCursor: paginationInfo.nextCursor,
              isLoadMore: true
            }
          })

          this.logger.debug('load_more_history completed', {
            socketId,
            conversationId: data.conversationId,
            messageCount: messages.length,
            hasMore: paginationInfo.hasMore
          })
        } catch (error) {
          this.logger.error('load_more_history failed', {
            socketId,
            conversationId: data.conversationId,
            error: error instanceof Error ? error.message : String(error)
          })

          socket.emit('message', {
            type: 'history_complete',
            content: '',
            data: {
              messageCount: 0,
              hasMore: false,
              nextCursor: null,
              error: error instanceof Error ? error.message : 'Failed to load history',
              isLoadMore: true
            }
          })
        }
      })

      socket.on('disconnect', async (reason) => {
        if (reason === 'ping timeout') {
          this.logger.warn('websocket.quality.ping_timeout_disconnect', {
            socketId,
            reason,
          })
        }
        this.logger.info('Socket disconnected', { socketId, reason })

        // Check if there's an active stream for this socket via state manager
        const stateData = this.stateManager.getStateData(socketId)
        const hasActiveStream = this.stateManager.hasActiveStream(socketId)

        if (hasActiveStream && stateData) {
          // Don't abort immediately - transition to disconnected state with timeout
          this.logger.info('Active stream detected, starting recovery window', {
            socketId,
            recoveryWindow: `${this.STREAM_RECOVERY_WINDOW}ms`,
            conversationId: stateData.conversationId
          })

          // Set timeout to abort if client doesn't reconnect
          const timeoutId = setTimeout(() => {
            this.logger.warn('Recovery window expired, aborting stream', { socketId })
            stateData.abortController?.abort()

            // Clean up conversation (handles persistence and state cleanup)
            this.cleanupConversation(socketId).catch((error) => {
              this.logger.error('Error cleaning up conversation after recovery timeout', error)
            })
          }, this.STREAM_RECOVERY_WINDOW)

          // Transition to disconnected state
          this.stateManager.transitionTo(socketId, 'disconnected', {
            recoveryTimeoutId: timeoutId
          })
        } else if (stateData && !hasActiveStream) {
          // Conversation exists but stream not yet registered - setup still in progress
          this.logger.info('websocket.disconnect.during_setup', {
            socketId,
            conversationId: stateData.conversationId
          })

          // Create a placeholder AbortController for the disconnected state
          const placeholderController = new AbortController()

          const timeoutId = setTimeout(() => {
            this.logger.warn('websocket.deferred_cleanup.expired', { socketId })
            placeholderController.abort()
            this.cleanupConversation(socketId).catch((error) => {
              this.logger.error('websocket.deferred_cleanup.error', error)
            })
          }, this.STREAM_RECOVERY_WINDOW)

          // Transition to disconnected state with placeholder controller
          this.stateManager.transitionTo(socketId, 'disconnected', {
            recoveryTimeoutId: timeoutId,
            abortController: placeholderController
          })
        } else {
          // No state - connection closed before chat started
          this.logger.info('Socket disconnected with no active conversation', { socketId })
        }

        // Clean up APM spans (these can't be recovered)
        this.cleanupToolSpans(socketId)

        try {
          await this.config.onDisconnection?.(socketId)
        } catch (error) {
          this.logger.error('Error in onDisconnection handler', error)
        }
      })

      // Debug logging for all connections
      this.logger.info('Socket connection established', {
        socketId,
        hasAuth: !!auth,
        authKeys: Object.keys(auth),
        previousSocketId: previousSocketId || 'none',
      })

      // Send server config immediately after connection (intentionally pre-auth).
      // Client needs timeout config and capability flags before authenticating,
      // so this is emitted before the authenticate event is received.
      socket.emit('message', {
        type: 'server_config',
        content: '',
        data: {
          // Timeout configuration (for synchronization)
          streamRecoveryWindow: this.STREAM_RECOVERY_WINDOW,
          ackTimeout: this.ACK_TIMEOUT_MS,

          // Capability flags (for backwards compatibility)
          supportsWebSocketHistory: !!this.config.historyProvider,
          supportsConnectThenAuth: true,
          serverVersion: '2.0' // Increment when breaking changes occur
        }
      })

      // Debug logging for recovery
      if (previousSocketId) {
        this.logger.info('Connection with previousSocketId detected', {
          socketId,
          previousSocketId,
          hasDisconnectedStream: this.stateManager.isDisconnected(previousSocketId),
          disconnectedStreamsCount: this.stateManager.getDisconnectedCount(),
          disconnectedStreamKeys: Array.from(this.stateManager.getDisconnectedSocketIds())
        })
      }

      // For sockets already authenticated via handshake (old clients, PaaS, reconnects),
      // complete connection setup immediately. For pendingAuth sockets, the authenticate
      // handler will call completeConnectionSetup after successful auth.
      if (!auth.pendingAuth) {
        await this.completeConnectionSetup(socket)
      }
    })
  }

  /**
   * Complete connection setup after authentication.
   * Called immediately for handshake-auth sockets, deferred for connect-then-auth sockets.
   *
   * Includes: recovery detection, onConnection callback, sendAvailableAgents, history_complete,
   * and cancel handler registration.
   */
  async completeConnectionSetup(socket: import('socket.io').Socket): Promise<void> {
    // Idempotency guard — prevent duplicate setup if called more than once
    if (socket.data?.connectionSetupComplete) {
      this.logger.debug('websocket.setup.already_complete', { socketId: socket.id })
      return
    }
    // Set flag eagerly BEFORE async work to prevent interleaving
    socket.data = { ...socket.data, connectionSetupComplete: true }

    const socketId = socket.id
    const auth = socket.handshake.auth || {}
    const previousSocketId = auth.previousSocketId

    // Use recovery manager to detect and handle recovery
    const detectedRecoveryMode = await this.recoveryManager.attemptRecovery(socket)

    // Check for manual recovery after page reload (client sends previousSocketId)
    if (detectedRecoveryMode === 'manual') {
      await this.recoveryManager.handleManualRecovery(socket, previousSocketId!, {
        onRecoveryComplete: (_completedSocketId, _events, _finalSequence) => {
          // State manager handles all state updates including socket ID migration
          // No local Map updates needed
        },
        onRecoveryFailed: (_failedSocketId, _reason) => {
          // State manager handles cleanup via recoveryManager.cleanupAfterRecoveryFailure
          // No additional cleanup needed
        },
        createWebSocketSubscriber: (sock) => new WebSocketSubscriber(
          sock,
          (id) => this.stateManager.isDisconnected(id)
        )
      })
      return // Recovery handled, skip fresh connection setup
    }

    // Check if client is trying to recover but stream already completed/cleaned up
    // This handles edge case where previousSocketId exists but no conversationId
    if (previousSocketId && !detectedRecoveryMode) {
      this.logger.info('Recovery attempted but no buffered events found', {
        newSocketId: socketId,
        previousSocketId,
        hasConversationId: !!auth.conversationId
      })

      // Extract appId from auth for history loading
      // Same logic as connection-recovery-manager.ts extractAppId()
      const extractAppId = (authData: unknown): string | undefined => {
        if (!authData || typeof authData !== 'object') return undefined
        const authRecord = authData as Record<string, unknown>

        // Try direct appId first (most common)
        if (typeof authRecord.appId === 'string') return authRecord.appId

        // Try agentContext.appId (JWT auth)
        const agentContext = authRecord.agentContext as Record<string, unknown> | undefined
        if (agentContext && typeof agentContext.appId === 'string') return agentContext.appId

        // Try decoded.appId (JWT auth fallback)
        const decoded = authRecord.decoded as Record<string, unknown> | undefined
        if (decoded && typeof decoded.appId === 'string') return decoded.appId

        return undefined
      }

      // Use sendStreamCompletedStatus for consistent history handling
      // This will load and stream persisted history if conversationId exists
      await this.recoveryManager.sendStreamCompletedStatus(
        socket,
        auth.conversationId,
        extractAppId(auth)
      )
    }
    // Conversation-based recovery fallback (for tab-closure recovery when socket ID is lost)
    // This allows recovery using a durable conversationId cookie instead of ephemeral sessionStorage
    if (detectedRecoveryMode === 'conversation') {
      // Find the connection state for validation
      const entry = this.stateManager.findDisconnectedByConversationId(auth.conversationId)
      const stateData = entry?.[1]

      // Validation function for security check
      // Checks siteId from all possible auth sources:
      // - agentContext.siteId (JWT auth)
      // - decoded.siteId (JWT auth fallback)
      // - siteId (NONE/MOCK auth modes)
      interface AuthDataWithSiteId {
        agentContext?: { siteId?: string }
        decoded?: { siteId?: string }
        siteId?: string
      }
      const validateAppId = (conversationId: string, authData: Record<string, unknown>): boolean => {
        const typedAuth = authData as AuthDataWithSiteId
        const authenticatedSiteId =
          typedAuth.agentContext?.siteId ||
          typedAuth.decoded?.siteId ||
          typedAuth.siteId

        // Block recovery if we can't determine the authenticated site
        if (!authenticatedSiteId) {
          this.logger.warn('recovery.conversation.no_site_id', {
            socketId,
            conversationId,
            authKeys: Object.keys(authData)
          })
          return false
        }

        // Block recovery if site doesn't match the conversation's app
        if (stateData && stateData.context?.appId !== authenticatedSiteId) {
          this.logger.warn('recovery.conversation.site_mismatch', {
            socketId,
            conversationId,
            authenticatedSiteId,
            conversationAppId: stateData.context?.appId
          })
          return false
        }

        return true
      }

      await this.recoveryManager.handleConversationRecovery(socket, auth.conversationId, validateAppId, {
        onRecoveryComplete: (_completedSocketId, _events, _finalSequence) => {
          // State manager handles all state updates including socket ID migration
          // No local Map updates needed
        },
        onRecoveryFailed: (_failedSocketId, _reason) => {
          // State manager handles cleanup via recoveryManager.cleanupAfterRecoveryFailure
          // No additional cleanup needed
        },
        createWebSocketSubscriber: (sock) => new WebSocketSubscriber(
          sock,
          (id) => this.stateManager.isDisconnected(id)
        )
      })
      return // Recovery handled, skip fresh connection setup
    }

    // Initial recovery (conversationId exists but no disconnected state)
    // Triggered on: initial load with existing conversation OR page reload after recovery window
    if (detectedRecoveryMode === 'initial') {
      // Validation function for security check (same logic as conversation recovery)
      interface AuthDataWithSiteId {
        agentContext?: { siteId?: string }
        decoded?: { siteId?: string }
        siteId?: string
      }
      const validateAppId = (conversationId: string, authData: Record<string, unknown>): boolean => {
        const typedAuth = authData as AuthDataWithSiteId
        const authenticatedSiteId =
          typedAuth.agentContext?.siteId ||
          typedAuth.decoded?.siteId ||
          typedAuth.siteId

        // Block recovery if we can't determine the authenticated site
        if (!authenticatedSiteId) {
          this.logger.warn('recovery.initial.no_site_id', {
            socketId,
            conversationId,
            authKeys: Object.keys(authData)
          })
          return false
        }

        // For initial recovery, we can't validate against stateData (it doesn't exist)
        // The authentication middleware has already validated the user's access to the appId
        // We return true if we have a valid authenticated site ID, as the conversationId
        // cookie is already scoped to the authenticated domain
        this.logger.debug('recovery.initial.validation', {
          socketId,
          conversationId,
          authenticatedSiteId
        })
        return true
      }

      await this.recoveryManager.handleInitialRecovery(socket, auth.conversationId, validateAppId, {
        onRecoveryComplete: (_completedSocketId, _events, _finalSequence) => {
          // State manager handles all state updates
          // No local Map updates needed
        },
        onRecoveryFailed: (_failedSocketId, _reason) => {
          // State manager handles cleanup via recoveryManager.cleanupAfterRecoveryFailure
          // No additional cleanup needed
        },
        createWebSocketSubscriber: (sock) => new WebSocketSubscriber(
          sock,
          (id) => this.stateManager.isDisconnected(id)
        )
      })
      return // Recovery handled, skip fresh connection setup
    }

    // Call connection handler (await to ensure async initialization completes before subsequent handlers)
    await this.config.onConnection?.(socketId)

    // Send available agents on connection
    this.sendAvailableAgents(socket)

    // Send history_complete for fresh connections (no history to load)
    // This ensures client initialization completes immediately for new users
    socket.emit('message', {
      type: 'history_complete',
      content: '',
      data: {
        messageCount: 0
      }
    } as WebSocketMessage)

    // Handle explicit stream cancellation (user clicked cancel button)
    socket.on('cancel', () => {
      this.logger.info('Stream explicitly cancelled by user', { socketId })

      // Cancel any active or disconnected stream via state manager
      const controller = this.stateManager.getAbortController(socketId)
      const cancelStateData = this.stateManager.getStateData(socketId)

      if (controller) {
        controller.abort()

        // Clear any pending recovery timeout
        if (cancelStateData?.recoveryTimeoutId) {
          clearTimeout(cancelStateData.recoveryTimeoutId)
        }

        // Clean up conversation (handles persistence and state cleanup)
        this.cleanupConversation(socketId).catch(err => {
          this.logger.error('websocket.cancel.cleanup_failed', {
            socketId,
            error: err instanceof Error ? err.message : String(err)
          })
        })
      }
    })
  }

  /**
   * Publish event through event channel
   *
   * Events are published to the event channel which buffers them for recovery.
   * When the socket is connected, we track the sequence number as "delivered".
   * When disconnected, events are still published but not marked as delivered
   * (they'll be replayed on reconnection).
   *
   * Also tracks event locally for:
   * - streamingEvents array (for completeConversation)
   * - accumulatedContent (for llm_end hook)
   * - pendingSegments/pendingToolCalls (for updateAgentTurn)
   *
   * @returns Promise that resolves to the sequence number, or undefined on failure
   */
  private async publishToEventChannel(
    socketId: string,
    type: StreamingEventType,
    content: string,
    data: Record<string, unknown>,
    agentName: string
  ): Promise<number | undefined> {
    // Get effective socket ID after following migration chain (handles A→B→C)
    // handleChatMessage may still be using old socketId after migration(s)
    const effectiveSocketId = this.stateManager.getEffectiveSocketId(socketId)
    const stateData = this.stateManager.getStateData(effectiveSocketId)
    if (!stateData) {
      return undefined // No conversation to publish to
    }

    try {
      const event = await this.eventChannel.publish(stateData.conversationId, {
        conversationId: stateData.conversationId,
        type,
        content,
        data,
        agentName
      })

      // Only track as "delivered" if socket is connected
      // When disconnected, events are buffered but not delivered
      // Use effectiveSocketId to check the actual current socket
      if (!this.stateManager.isDisconnected(effectiveSocketId)) {
        this.stateManager.updateConnection(effectiveSocketId, {
          lastDeliveredSequence: event.sequence
        })
      }

      // Track event locally for conversation state management
      // This handles: streamingEvents array, content accumulation, segment/tool tracking
      await this.trackEventForConversation(stateData, type, content, data)

      return event.sequence
    } catch (err) {
      // Log as warning - event channel failed but we continue
      this.logger.warn('eventChannel.publish.failed', {
        conversationId: stateData.conversationId,
        type,
        error: err instanceof Error ? err.message : String(err)
      })
      return undefined
    }
  }

  /**
   * Get the conversation state for a socket ID, following migration chain if necessary
   * Delegates to stateManager for consistent state access
   *
   * @param socketId - The socket ID (may be original or migrated)
   * @returns The connection state data, or undefined if not found
   */
  private getConversation(socketId: string): ConnectionStateData | undefined {
    const effectiveId = this.stateManager.getEffectiveSocketId(socketId)
    return this.stateManager.getStateData(effectiveId)
  }

  /**
   * Clean up conversation state and persistence
   * Delegates to stateManager for state cleanup, handles persistence separately
   */
  private async cleanupConversation(socketId: string): Promise<void> {
    const effectiveId = this.stateManager.getEffectiveSocketId(socketId)

    // Idempotency guard via state manager
    if (this.stateManager.isCleanupInProgress(effectiveId)) {
      this.logger.debug('websocket.cleanup.already_in_progress', { socketId: effectiveId })
      return
    }

    // Get state data before cleanup for persistence handling
    const stateData = this.stateManager.getStateData(effectiveId)

    // Handle persistence cleanup if needed
    if (stateData && 'handleDisconnection' in this.config.messagePersistence) {
      await (this.config.messagePersistence as ConversationPersistenceWithCleanup).handleDisconnection(
        effectiveId,
        [stateData.conversationId]
      )
    }

    // Delegate state cleanup to state manager (handles timeouts, abort controller, migrations, etc.)
    await this.stateManager.cleanup(socketId)
  }

  /**
   * Clean up APM tool spans for a socket
   */
  private cleanupToolSpans(socketId: string): void {
    for (const [spanKey, span] of this.activeToolSpans.entries()) {
      if (spanKey.startsWith(`${socketId}:`)) {
        try {
          span.setOutcome('unknown')
          span.addLabels({ disconnect_cleanup: true })
          span.end()
        } catch {
          // Silently fail - APM cleanup should not disrupt disconnect handling
        }
        this.activeToolSpans.delete(spanKey)
      }
    }
  }

  /**
   * Send available agents to client
   * Note: This uses socket.emit directly (not event channel) because it's a
   * one-off message sent on connection, not part of a conversation stream.
   */
  private sendAvailableAgents(socket: any): void {
    const agentList = this.config.agents.list()

    socket.emit('message', {
      type: 'agents_available',
      content: '',
      data: {
        agents: agentList.map((agentName: string | number) => {
          const agentNameStr = String(agentName)
          return {
            id: agentNameStr,
            name: this.config.agents.get(agentNameStr)?.getName() || agentNameStr,
            description: `${agentNameStr} agent`
          }
        }),
        defaultAgent: this.config.defaultAgent || String(agentList[0]) || null
      }
    } as WebSocketMessage)
  }

  /**
   * Initialize conversation buffers for incremental persistence
   * Ensures all required properties are defined
   */
  private initializeConversationBuffers(conversation: {
    pendingSegments?: any[]
    pendingToolCalls?: Map<string, any>
    accumulatedContent?: string
  }): asserts conversation is {
    pendingSegments: any[]
    pendingToolCalls: Map<string, any>
    accumulatedContent: string
  } {
    if (!conversation.pendingSegments) {
      conversation.pendingSegments = []
    }
    if (!conversation.pendingToolCalls) {
      conversation.pendingToolCalls = new Map()
    }
    if (!conversation.accumulatedContent) {
      conversation.accumulatedContent = ''
    }
  }

  /**
   * Track streaming event for local conversation state
   *
   * This handles:
   * - Adding events to streamingEvents array for completeConversation()
   * - Accumulating content for llm_end hook
   * - Managing pending segments and tool calls for updateAgentTurn
   *
   * Note: Database persistence is handled by PersistenceSubscriber
   */
  private async trackEventForConversation(
    conversation: {
      conversationId: string
      context: ConversationContext
      streamingEvents: PersistenceStreamingEvent[]
      pendingSegments?: any[]
      pendingToolCalls?: Map<string, any>
      accumulatedContent?: string
    },
    type: string,
    content: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const timestamp = new Date()
    const event: PersistenceStreamingEvent = {
      type,
      content: content || undefined,
      data,
      timestamp
    }

    // Add to local tracking for completeConversation()
    conversation.streamingEvents.push(event)

    this.initializeConversationBuffers(conversation)

    // Always accumulate content for observability - regardless of persistence settings
    // This ensures llm_end events capture the full streamed text
    if (type === 'chunk' || type === 'text_chunk') {
      if (content) {
        // Insert a newline when text resumes after non-text events (tool_start,
        // tool_result, etc.) so the accumulated string has readable separation
        // between the agent's text segments instead of smashing them together.
        // Uses length - 2 because the current event was already pushed above.
        const lastEvent = conversation.streamingEvents[conversation.streamingEvents.length - 2]
        if (conversation.accumulatedContent && lastEvent && lastEvent.type !== 'chunk' && lastEvent.type !== 'text_chunk') {
          conversation.accumulatedContent += '\n'
        }
        conversation.accumulatedContent += content
      }
    }

    // Handle incremental updates via updateAgentTurn if configured
    const agentMessageId = conversation.context.agentMessageId

    if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
      this.logger.debug('Event tracked for conversation', {
        type,
        hasAgentMessageId: !!agentMessageId,
        hasUpdateMethod: !!this.config.messagePersistence.updateAgentTurn,
        willTriggerUpdate: !!(agentMessageId && this.config.messagePersistence.updateAgentTurn && type === 'tool_result'),
        contentLength: content?.length || 0,
        accumulatedContentLength: conversation.accumulatedContent.length
      })
    }

    if (agentMessageId && this.config.messagePersistence.updateAgentTurn) {
      if (type === 'chunk' || type === 'text_chunk') {
        if (content) {
          conversation.pendingSegments.push({
            id: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
            type: 'content',
            content,
            timestamp,
            metadata: undefined
          })
        }
      } else if (type === 'tool_start' && data?.tool) {
        const tool = data.tool as { id?: string; name: string; input: unknown }
        const toolId = tool.id || `tool_${Date.now()}`
        const toolData = {
          id: toolId,
          name: tool.name,
          input: tool.input,
          status: 'running',
          startTime: timestamp
        }
        conversation.pendingToolCalls.set(toolId, toolData)

        conversation.pendingSegments.push({
          id: `seg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'tool_call',
          timestamp,
          toolCall: toolData
        })
      } else if (type === 'tool_result' && data?.tool) {
        const tool = data.tool as { id: string; input?: unknown; output?: string; result?: string; error?: string; is_error?: boolean }
        const toolId = tool.id
        const existingTool = conversation.pendingToolCalls.get(toolId)

        if (existingTool) {
          existingTool.input = tool.input || existingTool.input
          existingTool.result = tool.output ?? content ?? tool.result
          existingTool.error = tool.error
          existingTool.status = (tool.error || tool.is_error) ? 'error' : 'completed'
          existingTool.endTime = timestamp

          if (existingTool.startTime && timestamp) {
            const startTime = new Date(existingTool.startTime).getTime()
            const endTime = new Date(timestamp).getTime()
            existingTool.duration = endTime - startTime
          }

          const segmentIndex = conversation.pendingSegments.findIndex(s =>
            s.type === 'tool_call' && s.toolCall?.id === toolId
          )
          if (segmentIndex >= 0) {
            conversation.pendingSegments[segmentIndex].toolCall = existingTool
          }

          try {
            if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
              this.logger.debug('Updating agent turn with tool result', {
                messageId: agentMessageId,
                toolId,
                toolName: existingTool.name,
                contentLength: conversation.accumulatedContent.length,
                segmentsCount: conversation.pendingSegments.length,
                toolCallsCount: conversation.pendingToolCalls.size
              })
            }
            await this.config.messagePersistence.updateAgentTurn(
              conversation.conversationId,
              agentMessageId,
              {
                content: conversation.accumulatedContent,
                segments: [...conversation.pendingSegments],
                toolCalls: Array.from(conversation.pendingToolCalls.values())
              },
              conversation.context
            )
          } catch (error) {
            this.logger.warn('Failed to update agent turn with tool result', error)
          }
        }
      }
    }
  }

  /**
   * Map to track active observability tool spans
   * Key: socketId:toolId, Value: { spanId, startTime }
   */
  private activeObservabilityToolSpans = new Map<string, { spanId: string; startTime: number }>()

  /**
   * Start APM span for tool execution
   *
   * NOTE: Manual APM tool spans are disabled because AI SDK experimental_telemetry
   * creates ai.toolCall spans automatically via OpenTelemetry bridge.
   * This avoids duplicate spans in Elastic APM.
   */
  private async startToolSpan(socketId: string, toolId: string, toolName: string, toolInput?: Record<string, unknown>): Promise<void> {
    // Manual APM tool spans disabled - AI SDK experimental_telemetry creates ai.toolCall spans

    // Start observability tool tracking
    if (this.config.onToolStart) {
      try {
        const activeConversation = this.getConversation(socketId)
        const context = activeConversation?.context
        const appId = context?.appId || (context?.metadata as MetadataRecord)?.appId
        const conversationId = activeConversation?.conversationId

        // Build params object, only including defined values to avoid exactOptionalPropertyTypes issues
        const params: Parameters<NonNullable<typeof this.config.onToolStart>>[0] = {
          socketId,
          toolName,
          toolCallId: toolId
        }
        if (toolInput !== undefined) params.toolInput = toolInput
        if (conversationId !== undefined) params.conversationId = conversationId
        if (appId !== undefined) params.appId = appId
        if (context !== undefined) params.context = context

        const result = await this.config.onToolStart(params)

        if (result && typeof result === 'object' && 'spanId' in result) {
          const spanKey = `${socketId}:${toolId}`
          this.activeObservabilityToolSpans.set(spanKey, result)
        }
      } catch (hookError) {
        this.logger.warn('Tool start hook failed', hookError)
      }
    }
  }

  /**
   * End APM span for tool execution
   */
  private async endToolSpan(socketId: string, toolId: string, toolName: string, success: boolean, toolResponse?: unknown, errorMessage?: string): Promise<void> {
    const spanKey = `${socketId}:${toolId}`

    // End APM span
    const span = this.activeToolSpans.get(spanKey)
    if (span) {
      try {
        span.setOutcome(success ? 'success' : 'failure')

        if (!success && errorMessage) {
          span.addLabels({
            error_message: errorMessage
          })
        }

        span.end()
        this.activeToolSpans.delete(spanKey)
      } catch {
        // Silently fail - APM tracking should not break the application
      }
    }

    // End observability tool tracking
    const observabilitySpan = this.activeObservabilityToolSpans.get(spanKey)

    if (this.config.onToolEnd) {
      try {
        const activeConversation = this.getConversation(socketId)
        const context = activeConversation?.context
        const appId = context?.appId || (context?.metadata as MetadataRecord)?.appId
        const conversationId = activeConversation?.conversationId

        // Build params object, only including defined values to avoid exactOptionalPropertyTypes issues
        const params: Parameters<NonNullable<typeof this.config.onToolEnd>>[0] = {
          socketId,
          toolName,
          toolCallId: toolId,
          success
        }
        if (observabilitySpan?.spanId !== undefined) params.spanId = observabilitySpan.spanId
        if (observabilitySpan?.startTime !== undefined) params.startTime = observabilitySpan.startTime
        if (toolResponse !== undefined) params.toolResponse = toolResponse
        if (conversationId !== undefined) params.conversationId = conversationId
        if (appId !== undefined) params.appId = appId
        if (context !== undefined) params.context = context

        await this.config.onToolEnd(params)
      } catch (hookError) {
        this.logger.warn('Tool end hook failed', hookError)
      }
    }

    // Always clean up observability span to prevent memory leaks
    if (observabilitySpan) {
      this.activeObservabilityToolSpans.delete(spanKey)
    }
  }

  /**
   * Process stream with real-time tool events from baseStream
   */
  private async processStreamWithToolEvents(socket: any, streamResult: any, currentStep: number, agentName: string): Promise<void> {
    const baseStream = streamResult.baseStream
    if (!baseStream) {
      // Fallback to text-only streaming if baseStream is not available
      await this.processTextOnlyStream(socket, streamResult, currentStep, agentName)
      return
    }

    let reader: ReadableStreamDefaultReader | null = null
    const socketId = socket.id
    const abortController = this.stateManager.getAbortController(socketId)

    // Get agent message ID for event tracking
    const activeConversation = this.getConversation(socketId)
    const agentMessageId = activeConversation?.context?.agentMessageId

    try {
      reader = baseStream.getReader()
      const accumulatedToolInput = new Map<string, string>() // Track tool input deltas

      // eslint-disable-next-line no-constant-condition
      while (true) { // Intentional infinite loop until stream is done
        // Check if the stream was cancelled
        if (abortController?.signal.aborted) {
          this.logger.warn('Stream processing cancelled by client')
          break
        }

        let readResult
        try {
          readResult = await reader!.read()
        } catch (readError: unknown) {
          // Handle specific stream read errors
          if (this.isNetworkError(readError)) {
            const errorMessage = readError instanceof Error ? readError.message : String(readError)
            this.logger.warn('Network error during stream read, attempting graceful fallback', { error: errorMessage })
            throw readError // Re-throw to trigger fallback
          }
          throw readError
        }

        const { done, value } = readResult

        if (done) {
          break
        }

        if (value?.part) {
          const part = value.part

          switch (part.type) {
            case 'error': {
              // AI SDK surfaced an error part - check if it's a budget error
              const error = part.error

              // Check if it's AI SDK's native APICallError with budget pattern
              if (isBudgetExceededAPIError(error)) {
                this.logger.error('Budget exceeded error detected', {
                  message: error.message,
                  statusCode: error.statusCode
                })

                // Convert to BudgetExceededError for UI
                throw new BudgetExceededError(
                  'Your AI usage budget has been reached.',
                  error.statusCode ?? 400,
                  error.responseBody
                )
              }

              // Log and re-throw other errors unchanged
              this.logger.error('Stream error part received', {
                message: error instanceof Error ? error.message : String(error),
                statusCode: APICallError.isInstance(error) ? error.statusCode : undefined
              })

              throw error instanceof Error ? error : new Error(String(error))
            }

            case 'text-delta': {
              // Handle text chunks
              const textData = {
                step: currentStep,
                source: 'ai_response',
                agentId: agentName,
                messageId: agentMessageId  // NEW: Include message ID for pending message tracking
              }

              // Publish to event channel - WebSocketSubscriber delivers to client,
              // PersistenceSubscriber handles database persistence
              await this.publishToEventChannel(socketId, 'chunk', part.text, textData, agentName)
              break
            }

            case 'tool-input-start': {
              // Tool call is starting
              accumulatedToolInput.set(part.id, '')

              const toolStartData = {
                step: currentStep,
                tool: {
                  id: part.id,
                  name: part.toolName,
                  input: {} // Will be populated as deltas arrive
                },
                agentId: agentName,
                messageId: agentMessageId  // NEW: Include message ID for pending message tracking
              }

              // Start APM span and observability tracking for tool execution
              // Fire-and-forget to avoid blocking the main execution flow
              this.startToolSpan(socket.id, part.id, part.toolName).catch(err =>
                this.logger.warn('tool.span.start_failed', { toolId: part.id, error: err instanceof Error ? err.message : String(err) })
              )

              // Publish to event channel - subscribers handle delivery and persistence
              await this.publishToEventChannel(socketId, 'tool_start', `Using ${part.toolName}...`, toolStartData, agentName)
              break
            }

            case 'tool-input-delta': {
              // Accumulate tool input - emit delta for future status updates
              const currentInput = accumulatedToolInput.get(part.id) || ''
              accumulatedToolInput.set(part.id, currentInput + part.delta)

              const toolInputDeltaData = {
                toolId: part.id,
                toolName: part.toolName,
                delta: part.delta,
                agentId: agentName,
                messageId: agentMessageId  // NEW: Include message ID for pending message tracking
              }

              // Publish to event channel - subscribers handle delivery
              await this.publishToEventChannel(socketId, 'tool_input_delta', '', toolInputDeltaData, agentName)
              break
            }

            case 'tool-call': {
              // Tool call is complete with full input - emit with accumulated input
              const toolId = part.id || part.toolCallId
              const fullInput = accumulatedToolInput.get(toolId) || '{}'
              let parsedInput: Record<string, unknown> = {}

              try {
                parsedInput = JSON.parse(fullInput)
              } catch (error) {
                this.logger.error('Failed to parse tool input', { fullInput })
              }

              const toolCallData = {
                step: currentStep,
                tool: {
                  id: toolId,
                  name: part.toolName,
                  input: parsedInput
                },
                agentId: agentName
              }

              // Publish to event channel - subscribers handle delivery and persistence
              await this.publishToEventChannel(socketId, 'tool_call', `${part.toolName} input ready`, toolCallData, agentName)

              // Update APM span with input data now that we have it
              const spanKey = `${socket.id}:${toolId}`
              const span = this.activeToolSpans.get(spanKey)
              if (span && parsedInput && Object.keys(parsedInput).length > 0) {
                span.addLabels({
                  tool_input_keys: Object.keys(parsedInput).join(',')
                })
              }
              break
            }

            case 'tool-result': {
              // Tool execution completed with result
              const toolId = part.id || part.toolCallId

              const toolResultData = {
                step: currentStep,
                tool: {
                  id: toolId,
                  name: part.toolName,
                  input: part.input,
                  output: part.output
                },
                agentId: agentName
              }

              // End APM span and observability tracking for successful tool execution
              // Fire-and-forget to avoid blocking the main execution flow
              this.endToolSpan(socket.id, toolId, part.toolName, true, part.output).catch(err =>
                this.logger.warn('tool.span.end_failed', { toolId, error: err instanceof Error ? err.message : String(err) })
              )

              // Publish to event channel - subscribers handle delivery and persistence
              await this.publishToEventChannel(socketId, 'tool_result', `${part.toolName} completed`, toolResultData, agentName)
              break
            }

            case 'tool-error': {
              // Tool execution failed with error - communicate this clearly to frontend and LLM
              const toolId = part.id || part.toolCallId || part.toolId

              const errorMessage = part.error?.message || (typeof part.error === 'string' ? part.error : String(part.error)) || 'Tool execution error'

              const toolErrorData = {
                step: currentStep,
                tool: {
                  id: toolId,
                  name: part.toolName,
                  input: part.input || {},
                  output: {},
                  error: errorMessage,
                  is_error: true
                },
                agentId: agentName
              }

              // End APM span and observability tracking for failed tool execution
              // Fire-and-forget to avoid blocking the main execution flow
              this.endToolSpan(socket.id, toolId, part.toolName, false, undefined, errorMessage).catch(err =>
                this.logger.warn('tool.span.end_failed', { toolId, error: err instanceof Error ? err.message : String(err) })
              )

              // Publish to event channel - subscribers handle delivery and persistence
              await this.publishToEventChannel(socketId, 'tool_result', `${part.toolName} failed: ${errorMessage}`, toolErrorData, agentName)
              break
            }

            default:
              // Unhandled tool event
              break
          }
        }
      }
    } catch (error: unknown) {
      // Non-retryable errors (budget exceeded, auth, etc.) should propagate immediately
      const classification = classifyError(error);
      if (!classification.retryable) {
        // Check if it's a budget error from APICallError
        if (isBudgetExceededAPIError(error)) {
          this.logger.error('Non-retryable budget error - propagating', {
            category: classification.category,
            message: error.message,
            statusCode: error.statusCode
          });

          throw new BudgetExceededError(
            'Your AI usage budget has been reached.',
            error.statusCode ?? 400,
            error.responseBody
          );
        }

        this.logger.error('Non-retryable error in stream processing - propagating', {
          category: classification.category,
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }

      // Enhanced error logging with structured information
      const errorInfo = this.analyzeStreamError(error);

      this.logger.error('Error processing baseStream, falling back to text-only', {
        errorType: errorInfo.type,
        errorMessage: errorInfo.message,
        isNetworkError: errorInfo.isNetworkError,
        isAbortError: errorInfo.isAbortError,
        originalError: error
      })

      // Fallback to text-only streaming with better error handling
      try {
        await this.processTextOnlyStream(socket, streamResult, currentStep, agentName)
      } catch (fallbackError: unknown) {
        // Non-retryable errors should propagate
        const fallbackClassification = classifyError(fallbackError);
        if (!fallbackClassification.retryable) {
          throw fallbackError;
        }

        this.logger.error('Fallback to text-only streaming also failed', fallbackError)
        // Emit error to client as last resort via event channel
        await this.publishToEventChannel(socketId, 'error', `Stream processing failed: ${errorInfo.message}`, {
          timestamp: new Date().toISOString(),
          errorType: errorInfo.type,
          step: currentStep,
          agentId: agentName
        }, agentName)
      }
    } finally {
      // Ensure reader is always cleaned up
      await this.safeCleanupReader(reader)
    }
  }

  /**
   * Helper method to safely process text-only streaming
   */
  private async processTextOnlyStream(socket: any, streamResult: any, currentStep: number, agentName: string): Promise<void> {
    const socketId = socket.id
    const abortController = this.stateManager.getAbortController(socketId)

    // Get agent message ID for event tracking
    const activeConversation = this.getConversation(socketId)
    const agentMessageId = activeConversation?.context?.agentMessageId

    try {
      for await (const chunk of streamResult.textStream) {
        // Check if the stream was cancelled
        if (abortController?.signal.aborted) {
          this.logger.warn('Text stream processing cancelled by client')
          break
        }

        const chunkData = {
          step: currentStep,
          source: 'ai_response',
          agentId: agentName,
          messageId: agentMessageId  // NEW: Include message ID for pending message tracking
        }

        // Publish to event channel - subscribers handle delivery and persistence
        await this.publishToEventChannel(socketId, 'chunk', chunk, chunkData, agentName)
      }
    } catch (error: unknown) {
      const errorInfo = this.analyzeStreamError(error)

      if (!errorInfo.isAbortError) {
        this.logger.error('Error in text-only stream processing', errorInfo)
        throw error
      }
    }
  }

  /**
   * Analyze stream errors to provide better error handling
   */
  private analyzeStreamError(error: unknown): {
    type: string
    message: string
    isNetworkError: boolean
    isAbortError: boolean
  } {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorName = error instanceof Error ? error.name : 'UnknownError'

    // Check for abort/cancellation errors (both UK and US spellings)
    const isAbortError = errorName === 'AbortError' ||
                        errorMessage.includes('aborted') ||
                        errorMessage.includes('cancelled') ||
                        errorMessage.includes('canceled')

    // Check for network-related errors
    const isNetworkError = this.isNetworkError(error)

    let errorType = 'UnknownError'
    if (isAbortError) {
      errorType = 'AbortError'
    } else if (isNetworkError) {
      errorType = 'NetworkError'
    } else if (errorName) {
      errorType = errorName
    }

    return {
      type: errorType,
      message: errorMessage,
      isNetworkError,
      isAbortError
    }
  }

  /**
   * Check if an error is network-related
   */
  private isNetworkError(error: unknown): boolean {
    if (!error) return false

    const errorMessage = error instanceof Error ? error.message : ''
    const errorName = error instanceof Error ? error.name : ''
    const errorCode = (error as any)?.code || ''
    const errorCause = (error as any)?.cause

    // Known undici/fetch network error codes (explicit whitelist)
    const knownNetworkCodes = new Set([
      'UND_ERR_SOCKET',
      'UND_ERR_RES_CONTENT_LENGTH_MISMATCH',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
      'UND_ERR_REQUEST_TIMEOUT'
    ])

    // Check explicit error codes first
    if (knownNetworkCodes.has(errorCode) || (errorCause && knownNetworkCodes.has(errorCause.code))) {
      return true
    }

    // Check for specific well-defined network error messages
    const networkErrorMessages = [
      'terminated',
      'other side closed',
      'content-length'
    ]

    // Only check exact error names for fetch/network errors
    const isNetworkErrorName = errorName === 'TypeError' && errorMessage.includes('terminated') ||
                              errorName === 'FetchError' ||
                              errorName === 'SocketError'

    const hasNetworkMessage = networkErrorMessages.some(msg => errorMessage.includes(msg))

    return isNetworkErrorName || hasNetworkMessage
  }

  /**
   * Safely cleanup a stream reader
   */
  private async safeCleanupReader(reader: ReadableStreamDefaultReader | null): Promise<void> {
    if (!reader) return

    try {
      // Cancel the reader if it's still active
      await reader.cancel()
    } catch (cancelError: unknown) {
      // Ignore cancel errors - reader might already be closed
      const errorMessage = cancelError instanceof Error ? cancelError.message : String(cancelError)
      this.logger.debug('Reader cancel error (expected if already closed)', { error: errorMessage })
    }

    try {
      // Release the lock
      reader.releaseLock()
    } catch (releaseError: unknown) {
      // Ignore release errors - lock might already be released
      const errorMessage = releaseError instanceof Error ? releaseError.message : String(releaseError)
      this.logger.debug('Reader release error (expected if already released)', { error: errorMessage })
    }
  }

  /**
   * Handle incoming chat messages with handoff support
   * Serializes message processing per socket to prevent concurrent race conditions
   */
  private async handleChatMessage(socket: any, data: ChatMessage): Promise<void> {
    const socketId = socket.id

    // Diagnostic: Log that message was received
    this.logger.info('websocket.chat_message.received', {
      socketId,
      messageLength: data.message?.length ?? 0,
      hasContext: !!data.context,
      conversationId: (data.context as any)?.conversation?.conversationId
    })

    // Create trace context early so all events (including conversation_start) share the same trace ID.
    // Handshake headers are passed for extracting common Event Bus metadata like visitor ID, customer ID, etc.
    const traceCtx = createTraceContext({
      headers: socket.handshake?.headers,
    })

    return otelContext.with(traceCtx, () =>
      // Queue this message to prevent concurrent handleChatMessage races
      // StateManager handles the queue chain, cleanup, and error isolation
      this.stateManager.queueMessage(socketId, () => this.handleChatMessageInternal(socket, data))
    )
  }

  /**
   * Internal message handler - executes serially per socket via queue
   * Runs within the trace context established by handleChatMessage
   */
  private async handleChatMessageInternal(socket: any, data: ChatMessage): Promise<void> {
    const socketId = socket.id
    const startTime = Date.now()
    let agentName: string | undefined
    let processedContext: Record<string, unknown> | undefined
    // Capture conversationId early for cleanup in finally block
    // This ensures we can unsubscribe even if the conversation is deleted in catch
    let conversationIdForCleanup: string | undefined

    try {
      // Validate message
      if (!data.message || typeof data.message !== 'string') {
        throw new Error('Invalid message: message field is required and must be a string')
      }

      // 1. Determine initial agent (check state manager first for handoffs)
      agentName = this.getActiveAgent(socketId, data)
      if (!agentName) {
        throw new Error('No agent specified and no default agent configured')
      }

      // 1.5. Strip /agent marker from message if present
      if (data.message && typeof data.message === 'string') {
        const firstLine = data.message.split('\n')[0]?.trim()
        if (firstLine && firstLine.match(/^\/agent\s+\w+$/i)) {
          // Remove first line and any leading newline
          const lines = data.message.split('\n')
          data.message = lines.slice(1).join('\n').trimStart()
        }
      }

      // 2. Process context (add socketId for tools)
      processedContext = await this.processContext(data, socketId)

      // 3. Setup persistence (conversation ID, tracking)
      await this.setupPersistence(socketId, agentName, data, processedContext)

      // Inject conversationId into metadata for tools to access
      this.attachConversationId(processedContext, socketId)

      // 4. Register event channel subscribers for this conversation
      // WebSocketSubscriber: delivers events to client socket (blocking - fail-fast on errors)
      // PersistenceSubscriber: persists events to database (non-blocking - errors logged)
      // APMSubscriber: tracks events for observability (non-blocking - errors logged)
      const conversation = this.getConversation(socketId)
      if (conversation) {
        const conversationId = conversation.conversationId
        // Capture for cleanup in finally block (survives even if catch deletes the conversation)
        conversationIdForCleanup = conversationId

        // WebSocket delivery (blocking)
        // Explicitly evict any existing websocket subscriber before adding fresh instance
        // Use effective socket ID to handle migrations (A→B) where recovery already registered websocket-B
        // This mirrors the cleanup logic at line 1996 and ensures exactly one subscriber exists
        const effectiveSocketId = this.stateManager.getEffectiveSocketId(socketId)
        this.eventChannel.unsubscribe(conversationId, `websocket-${effectiveSocketId}`)
        this.eventChannel.subscribe(
          conversationId,
          new WebSocketSubscriber(socket, (id) => this.stateManager.isDisconnected(id))
        )

        // Persistence (non-blocking)
        this.eventChannel.subscribe(
          conversationId,
          new PersistenceSubscriber(
            this.config.messagePersistence,
            conversation.context,
            this.logger
          )
        )

        // APM tool tracking disabled - AI SDK experimental_telemetry creates ai.toolCall spans via OpenTelemetry

        // Emit conversationId via dedicated control-plane event with ACK callback
        // This separates control-plane (cookie seeding) from semantic events (step_start)
        // ACK callback ensures client has persisted the cookie before we continue
        socket.emit('message', {
          type: 'conversation_info',
          content: '',
          data: {
            conversationId,
            agentId: agentName
          }
        } as WebSocketMessage, (ackError?: string) => {
          if (ackError) {
            this.logger.warn('websocket.conversation_info.ack_failed', {
              socketId,
              conversationId,
              error: ackError
            })
          }
        })
      }

      // 5. Load conversation history
      await this.loadConversationHistory(socketId, data, processedContext)

      // 5. Call message start handler (await to ensure invocation tracking is set up before LLM calls)
      await this.config.onMessageStart?.(socketId, data.message, agentName, processedContext)

      // 6. Create abort controller and register with state manager
      const controller = new AbortController()
      this.stateManager.updateConnection(socketId, { abortController: controller })

      // Clear pending setup if socket disconnected during setup but stream is now starting
      // This happens when the agent starts streaming after the client disconnected
      const stateData = this.stateManager.getStateData(socketId)
      if (stateData?.setupTimeoutId) {
        clearTimeout(stateData.setupTimeoutId)
        this.stateManager.updateConnection(socketId, { setupTimeoutId: null })

        // Socket is still disconnected - update state with the real controller
        if (this.stateManager.isDisconnected(socketId)) {
          // Replace placeholder controller with the real stream controller
          // Reset timeout for the full recovery window
          const newTimeoutId = setTimeout(() => {
            this.logger.warn('Recovery window expired after early disconnect', { socketId })
            controller.abort()
            this.cleanupConversation(socketId).catch((error) => {
              this.logger.error('Error cleaning up conversation after recovery timeout', error)
            })
          }, this.STREAM_RECOVERY_WINDOW)

          this.stateManager.updateConnection(socketId, {
            abortController: controller,
            recoveryTimeoutId: newTimeoutId
          })

          this.logger.info('websocket.pending_setup.converted_to_disconnected', {
            socketId,
            conversationId: stateData.conversationId
          })
        } else {
          this.logger.info('websocket.pending_setup.cleared', { socketId })
        }
      }

      // 7. Execute agent(s) - loop handles handoffs
      let currentMessage = data.message
      let iterationCount = 0
      const maxHandoffs = 10 // Prevent infinite loops

      while (iterationCount < maxHandoffs) {
        iterationCount++

        // Get current agent
        const agent = this.config.agents.get(agentName)
        if (!agent) {
          throw new Error(`Agent '${agentName}' not found`)
        }

        // Refresh context before each iteration (important for handoffs)
        // This ensures todo list context and other dynamic state is current
        if (iterationCount > 1) {
          processedContext = await this.processContext(data, socketId)

          // Reload conversation history for the new agent
          // This is critical - the new agent needs the full conversation history
          const { conversationHistory: _conversationHistory, ...dataWithoutHistory } = data
          const iterationData: ChatMessage = {
            ...dataWithoutHistory,
            message: currentMessage
          }

          await this.loadConversationHistory(socketId, iterationData, processedContext)

          // Use the iteration data with fresh history
          data = iterationData
        }

        // Create message data for this iteration
        const iterationData: ChatMessage = {
          ...data,
          message: currentMessage
        }

        // Stream agent response (tools execute here, including handoff)
        // Never emit completion during the loop - we'll handle it after
        await this.streamAgentResponse(socket, agent, iterationData, processedContext, agentName, startTime, false)

        // Check for auto-continuation FIRST (takes precedence - allows skill tools to load before handoff)
        // Get updated context from conversation state (includes flags set by afterToolExecution hook)
        const conversationAfterStream = this.getConversation(socketId)
        const updatedContext = conversationAfterStream?.context

        if (updatedContext?.metadata?.__autoContinue === true) {
          const continuationPrompt = (updatedContext.metadata.__continuationPrompt as string) || 'Continue processing'

          // Clear the flags so they're not reused in subsequent iterations
          delete (updatedContext.metadata as any).__autoContinue
          delete (updatedContext.metadata as any).__continuationPrompt

          this.logger.info('websocket.auto_continuation.detected', {
            socketId,
            agentName,
            conversationId: conversationAfterStream?.conversationId,
            continuationPromptPreview: continuationPrompt.substring(0, 100)
          })

          // Update message for next iteration (agent stays the same)
          currentMessage = continuationPrompt

          // Update processedContext with the updated context from conversation
          processedContext = updatedContext

          // Re-inject conversationId since updatedContext comes from state manager snapshot
          this.attachConversationId(processedContext, socketId)

          // Continue the loop without checking for handoff
          continue
        }

        // Check if handoff occurred
        const handoffDetails = this.getHandoffDetails(socketId, agentName)
        if (!handoffDetails) {
          // No handoff and no auto-continuation - we're done, exit loop
          break
        }

        // Handoff occurred - update session metadata with appId
        const currentAppId = extractAppIdFromMessageContext(data.context)
        if (
          currentAppId &&
          this.config.stateManager &&
          'setSessionMetadata' in this.config.stateManager &&
          typeof this.config.stateManager.setSessionMetadata === 'function'
        ) {
          this.config.stateManager.setSessionMetadata(socketId, { appId: currentAppId })
        }

        // Prepare for next iteration
        this.logger.info(`Handoff detected: ${agentName} -> ${handoffDetails.newAgentName}`)

        emitHandoff({
          conversationId: conversationIdForCleanup,
          agentId: this.getAgentId(agentName),
          eventData: createHandoff({
            fromAgentId: this.getAgentId(agentName),
            fromAgentName: agentName,
            toAgentId: this.getAgentId(handoffDetails.newAgentName),
            toAgentName: handoffDetails.newAgentName,
            reason: 'Agent handoff',
            routingMethod: 'llm'
          })
        })

        // Notify about agent change (for updating conversation.agent_id)
        const conversation = this.getConversation(socketId)
        if (conversation && this.config.onAgentChanged) {
          await this.config.onAgentChanged(
            conversation.conversationId,
            agentName,
            handoffDetails.newAgentName,
            currentAppId
          )
        }

        agentName = handoffDetails.newAgentName
        currentMessage = handoffDetails.handoffPrompt
      }

      if (iterationCount >= maxHandoffs) {
        this.logger.warn(`Maximum handoff limit (${maxHandoffs}) reached`)
      }

      // 8. Complete the conversation (after all handoffs complete)
      await this.completeConversation(socketId, agentName, startTime, processedContext)

    } catch (error: unknown) {
      // Extract error details for UI
      let errorMessage = error instanceof Error ? error.message : String(error);
      let errorType: string | undefined;
      let statusCode: number | undefined;
      let retryAttempts: number | undefined;
      let retryReason: string | undefined;

      // Check if it's an AppNotFoundError (duck-typed from agents service)
      if (error instanceof Error && 'errorType' in error && (error as any).errorType === 'APP_NOT_FOUND') {
        errorMessage = error.message;
        errorType = 'APP_NOT_FOUND';
        statusCode = 404;
      }
      // Check if it's a BudgetExceededError (already converted in stream handler)
      else if (BudgetExceededError.isInstance(error)) {
        errorMessage = error.message;
        errorType = 'BUDGET_EXCEEDED';
        statusCode = error.statusCode;
      }
      // Check if it's AI SDK's RetryError
      else if (RetryError.isInstance(error)) {
        errorMessage = error.message;
        errorType = 'RETRY_ERROR';
        statusCode = 500;
        // Extract retry metadata
        retryAttempts = error.errors.length;
        retryReason = error.reason;
      }
      // Check if it's AI SDK's APICallError (but not a budget error)
      else if (APICallError.isInstance(error)) {
        errorMessage = error.message;
        statusCode = error.statusCode;
      }

      this.logger.warn(`agent error detected`, {
        message: errorMessage,
        errorType,
        statusCode,
        socketId,
        agentName
      });

      // Construct error metadata object explicitly
      const errorMetadata: Record<string, unknown> = {
        errorType,
        statusCode,
        timestamp: new Date().toISOString(),
        agentId: agentName || this.config.defaultAgent
      };

      // Add optional retry metadata only if present
      if (retryAttempts !== undefined) {
        errorMetadata.retryAttempts = retryAttempts;
      }
      if (retryReason !== undefined) {
        errorMetadata.retryReason = retryReason;
      }

      // Publish error to event channel - subscribers handle delivery and persistence
      const published = await this.publishToEventChannel(socketId, 'error', errorMessage, errorMetadata, agentName || this.config.defaultAgent || 'unknown')

      // Fallback: If no conversation was registered (early failures like validation,
      // auth issues, AppNotFound), emit directly to the socket so the client gets feedback
      if (published === undefined && socket.connected) {
        socket.emit('message', {
          type: 'error',
          content: errorMessage,
          data: errorMetadata
        } as WebSocketMessage)
      }

      emitError({
        conversationId: conversationIdForCleanup,
        agentId: this.getAgentId(agentName),
        eventData: createError({
          errorType: errorType || error?.constructor?.name || 'Error',
          errorMessage,
          errorPhase: 'execution',
          isRetryable: errorType === 'RETRY_ERROR' || statusCode === 503 || statusCode === 429,
          ...(error instanceof Error ? { errorStack: error.stack } : {})
        })
      })

      await this.config.onError?.(socketId, error instanceof Error ? error : new Error(String(error)), data.message, processedContext)

      // Handle persistence error
      const effectiveSocketId = this.stateManager.getEffectiveSocketId(socketId)
      const errorStateData = this.stateManager.getStateData(effectiveSocketId)
      if (errorStateData) {
        await this.config.messagePersistence.handleConversationError(
          errorStateData.conversationId,
          error instanceof Error ? error : new Error(String(error)),
          data.message,
          errorStateData.context
        )
        // Transition to cleaned state (or cleanup will handle it)
        this.stateManager.transitionTo(effectiveSocketId, 'cleaned')
      }
    } finally {
      // Clean up stream tracking via state manager
      // State manager handles socket ID migration cleanup internally
      const effectiveSocketIdForCleanup = this.stateManager.getEffectiveSocketId(socketId)

      // Clear abort controller since stream is complete
      this.stateManager.updateConnection(effectiveSocketIdForCleanup, { abortController: null })

      // Clean up socket ID migration if this was the old socket that got migrated
      // Now that the old handler is finishing, the migration entry is no longer needed
      this.stateManager.clearMigrationChain(socketId)

      // Unsubscribe all subscribers for this conversation
      // Use conversationIdForCleanup captured earlier - activeConversations may have been
      // deleted in the catch block, but we still need to unsubscribe
      if (conversationIdForCleanup) {
        // WebSocket subscriber: always unsubscribe using EFFECTIVE socket ID
        // - If migrated (A→B): subscriber was re-registered under new socket ID (B) during recovery
        // - If not migrated: subscriber was registered under original socket ID
        // Either way, when the stream completes we must clean up to prevent duplicate delivery
        this.eventChannel.unsubscribe(conversationIdForCleanup, `websocket-${effectiveSocketIdForCleanup}`)

        // Persistence and APM subscribers: always use ORIGINAL socketId
        // These are never re-subscribed during recovery, so their IDs remain tied to the original
        this.eventChannel.unsubscribe(conversationIdForCleanup, `persistence-${socketId}`)
        if (this.config.apmAgent) {
          this.eventChannel.unsubscribe(conversationIdForCleanup, `apm-${socketId}`)
        }
      }

      // Note: activeConversations is NOT deleted here for successful messages.
      // It is intentionally kept to allow multiple turns in the same WebSocket session
      // to share the same conversation state (conversation history, context, etc).
      // This is critical for multi-turn conversations within a single session.
      //
      // Cleanup for completed conversations happens elsewhere in the lifecycle:
      // - On error: The catch block above deletes the activeConversations entry
      // - On disconnect: cleanupConversation() removes entries when client disconnects
      // This keeps state available between turns while ensuring eventual cleanup.
    }
  }

  private getAgentId(name?: string): string {
    return `airo-app-builder-${name || this.config.defaultAgent || 'unknown'}`
  }

  /**
   * Get the active agent for this session
   */
  private getActiveAgent(socketId: string, data: ChatMessage): string | undefined {
    // Always evaluate router first so brand new apps can start with the Initial agent
    const routedAgent = this.config.agentRouter ? this.config.agentRouter(socketId, data) : undefined

    if (this.config.stateManager && this.config.stateManager.getCurrentAgent) {
      const currentAgent = this.config.stateManager.getCurrentAgent(socketId)
      if (currentAgent) {
        const currentAppId = extractAppIdFromMessageContext(data.context)
        const sessionAppId = this.config.stateManager.getSessionMetadata?.(socketId)?.appId

        if (sessionAppId && currentAppId && sessionAppId !== currentAppId) {
          this.logger.debug('App ID changed, clearing state manager session', {
            socketId,
            oldAppId: sessionAppId,
            newAppId: currentAppId,
            oldAgent: currentAgent
          })
          this.config.stateManager.clearSession?.(socketId)
          if (routedAgent) {
            return routedAgent
          }
          // No router result - fall through so explicit agent/default logic can run
        } else {
          // Same app or no metadata tracking – honor the session-controlled agent
          return currentAgent
        }
      }
    }

    if (routedAgent) {
      return routedAgent
    }

    // Check for explicit agent selection in message (after router hook)
    if (data.agentId || data.agentName) {
      return data.agentId || data.agentName
    }

    // Fall back to default agent
    return this.config.defaultAgent
  }

  /**
   * Inject conversationId from state manager into context metadata
   * This ensures tools have access to conversationId via executionContext.metadata.conversationId
   */
  private attachConversationId(
    context: Record<string, unknown>,
    socketId: string
  ): void {
    const effectiveSocketId = this.stateManager.getEffectiveSocketId(socketId)
    const conversation = this.getConversation(effectiveSocketId)

    if (conversation?.conversationId) {
      if (!context.metadata) {
        context.metadata = {}
      }
      (context.metadata as MetadataRecord).conversationId = conversation.conversationId
    }
  }

  /**
   * Process context and add socketId
   */
  private async processContext(data: ChatMessage, socketId: string): Promise<Record<string, unknown>> {
    let context: Record<string, unknown>

    if (data.context && this.config.contextExtractor) {
      // contextExtractor may be async, so await it
      // Pass socketId to contextExtractor so it can access socket-specific data
      context = await Promise.resolve(this.config.contextExtractor(data.context, socketId))
    } else {
      context = data.context || {}
    }

    // Get current agent from state manager (for handoffs)
    // This is REQUIRED - every context must have an agentId
    const currentAgent = this.getActiveAgent(socketId, data)
    if (!currentAgent) {
      throw new Error('No active agent found - agentId is required in context.metadata')
    }

    // Ensure metadata exists and set agentId and user message
    const metadata = ((context as { metadata?: MetadataRecord }).metadata) || {}
    context = {
      ...context,
      metadata: {
        ...metadata,
        agentId: currentAgent,
        _userMessage: data.message // Add user's message for context provider to use (for KnowB search)
      }
    }

    const appId = extractAppIdFromMetadata(metadata)
    if (
      appId &&
      this.config.stateManager &&
      'setSessionMetadata' in this.config.stateManager &&
      typeof this.config.stateManager.setSessionMetadata === 'function'
    ) {
      this.config.stateManager.setSessionMetadata(socketId, { appId })
    }

    // Add socketId so it's available to tools via executionContext
    const enrichedContext = {
      ...context,
      socketId
    }

    // Inject conversationId if state manager already has it (recovery/handoff cases)
    this.attachConversationId(enrichedContext, socketId)

    return enrichedContext
  }

  /**
   * Setup conversation tracking and persistence
   *
   * This method creates an activeConversations entry via the state manager,
   * which is required for event publishing to work via publishToEventChannel.
   * Conversation IDs are generated by the messagePersistence implementation.
   */
  private async setupPersistence(
    socketId: string,
    agentName: string,
    data: ChatMessage,
    processedContext: Record<string, unknown>
  ): Promise<void> {
    const metadata = (processedContext?.metadata as any) || {}

    const persistenceContext: ConversationContext = {
      socketId,
      agentName,
      appId: metadata.appId,
      userId: metadata.userId,
      sessionId: metadata.sessionId,
      ...processedContext
    }

    // Check if we already have an active conversation for this socket via state manager
    const existingState = this.stateManager.getStateData(socketId)

    if (existingState && this.stateManager.hasConversation(socketId)) {
      // Reuse existing conversation, even if agent changed (handoff scenario)
      if (this.config.messagePersistence.continueConversation) {
        await this.config.messagePersistence.continueConversation(
          existingState.conversationId,
          data.message,
          persistenceContext
        )
      }

      // Update agent name, context, and reset tracking state for the new turn
      // Reset lastDeliveredSequence for the new turn
      // The event channel creates a new buffer starting at sequence 0
      // Without reset, recovery would ask for events after the old high watermark
      this.stateManager.updateConnection(socketId, {
        agentName,
        context: persistenceContext,
        streamingEvents: [],
        lastDeliveredSequence: -1,
        pendingSegments: [],
        pendingToolCalls: new Map(),
        accumulatedContent: ''
      })
    } else {
      // Create new conversation
      const conversationId = await this.config.messagePersistence.startConversation(
        data.message,
        persistenceContext
      )

      // Create connection state via state manager
      this.stateManager.createConnection(socketId, {
        conversationId,
        agentName,
        context: persistenceContext
      })
    }
  }

  /**
   * Load conversation history if available
   */
  private async loadConversationHistory(
    socketId: string,
    data: ChatMessage,
    processedContext: Record<string, unknown>
  ): Promise<void> {
    if (!this.config.messageProvider || data.conversationHistory) return

    const conversation = this.getConversation(socketId)
    if (!conversation) return

    try {
      const conversationHistory = await this.config.messageProvider.loadMessages(
        conversation.conversationId,
        processedContext
      )

      data.conversationHistory = conversationHistory
    } catch (error) {
      this.logger.warn('Failed to load conversation history', error)
    }
  }

  /**
   * Check if handoff occurred and get details
   */
  private getHandoffDetails(
    socketId: string,
    currentAgentName: string
  ): { newAgentName: string; handoffPrompt: string } | null {
    if (!this.config.stateManager || !this.config.stateManager.getCurrentAgent) {
      return null
    }

    const newAgentName = this.config.stateManager.getCurrentAgent(socketId)
    if (!newAgentName || newAgentName === currentAgentName) {
      return null
    }

    // Handoff occurred - get the prompt
    const handoffPrompt = this.config.stateManager.getLastHandoffPrompt?.(socketId)
    if (!handoffPrompt) {
      this.logger.warn(`Handoff to ${newAgentName} detected but no prompt available`)
      return null
    }

    // Clear the prompt so it's not reused
    this.config.stateManager.clearLastHandoffPrompt?.(socketId)

    return { newAgentName, handoffPrompt }
  }

  /**
   * Complete the conversation after all handoffs
   */
  private async completeConversation(
    socketId: string,
    agentName: string,
    startTime: number,
    processedContext: Record<string, unknown>
  ): Promise<void> {
    const duration = `${Date.now() - startTime}ms`

    // Execute pre-completion operations (git commits, etc.)
    if (this.config.beforeMessageComplete) {
      try {
        const preCompletionResult = await this.config.beforeMessageComplete(
          socketId,
          processedContext || {}
        )

        if (preCompletionResult && processedContext) {
          // Merge pre-completion data into context
          Object.assign(processedContext, preCompletionResult)

          this.logger.debug('message.pre_completion.success', {
            socketId,
            hasCommitHash: !!preCompletionResult.commitHash
          })
        }
      } catch (error) {
        this.logger.error('message.pre_completion.error', {
          socketId,
          error: error instanceof Error ? error.message : String(error)
        })
        // Continue with completion even if pre-completion fails
      }
    }

    // Complete persistence FIRST (includes git commits) before sending complete event
    // Store commit hash if persistence layer provides it via context
    let commitHash: string | null = null
    const conversation = this.getConversation(socketId)
    if (conversation) {
      await this.config.messagePersistence.completeConversation(
        conversation.conversationId,
        conversation.streamingEvents,
        { agentName, duration },
        conversation.context
      )

      // Get commit hash from context (set by beforeMessageComplete or persistence layer)
      commitHash = (conversation.context as any).commitHash ?? null

      // Don't delete conversation - keep it active for next user message
      // Only cleanup happens on disconnect or error
    }

    // Publish final completion event - subscribers handle delivery and persistence
    // Always include commit hash (null if no commit was created)
    const handoffConversation = this.getConversation(socketId)
    await this.publishToEventChannel(socketId, 'complete', '', {
      totalSteps: 1, // We don't track steps across handoffs
      usage: undefined,
      toolCalls: [],
      agentId: agentName,
      duration,
      commitHash, // null if no commit, hash string if commit was created
      messageId: handoffConversation?.context?.agentMessageId  // NEW: Include message ID for pending message tracking
    }, agentName)

    // Call completion handler
    this.config.onMessageComplete?.(socketId, {
      agentName,
      duration,
      usage: undefined,
      toolCalls: []
    }, processedContext)
  }

  /**
   * Assemble messages from various providers with proper ordering and cache points
   */
  private async assembleMessages(
    data: ChatMessage,
    context: Record<string, unknown> | undefined
  ): Promise<{
    messages: ModelMessage[]
    contextMessages: PipelineContextMessage[]
  }> {
    const messages: ModelMessage[] = []
    const contextMessages: PipelineContextMessage[] = []
    const beforeHistoryMessages: PipelineContextMessage[] = []
    const afterHistoryMessages: PipelineContextMessage[] = []

    // Load context messages if provider is configured
    if (this.config.contextProvider) {
      try {
        const contextToLoad = context || {}
        const loadedContextMessages = await this.config.contextProvider.loadContextMessages(contextToLoad)

        // Separate messages by insertion order and convert to proper format
        for (const msg of loadedContextMessages) {
          const { insertionOrder, ...messageWithoutOrder } = msg
          const convertedMessage = {
            role: messageWithoutOrder.role,
            content: messageWithoutOrder.content,
            ...(messageWithoutOrder.cachePoint && { cachePoint: messageWithoutOrder.cachePoint })
          }

          if (insertionOrder === 'before_history') {
            beforeHistoryMessages.push(convertedMessage)
          } else {
            afterHistoryMessages.push(convertedMessage)
          }
        }

        this.logger.info(`Loaded ${loadedContextMessages.length} context messages (${beforeHistoryMessages.length} before history, ${afterHistoryMessages.length} after history)`)
        this.logger.info(`Cache points: ${loadedContextMessages.filter(m => m.cachePoint).length} messages with caching enabled`)
      } catch (error) {
        this.logger.error('Error loading context messages', error)
        // Continue without context if loading fails
      }
    }

    // Assemble final message order:
    // 1. Context messages marked "before_history" go to contextMessages
    contextMessages.push(...beforeHistoryMessages)

    // 2. Conversation history (if provided) - preserve full message structure including tool calls
    // NOTE: We do NOT auto-add cache points here. Cache points are managed centrally by
    // addCacheControlToMessages() in prompt-caching.ts which handles the last message caching.
    // Adding cache points here caused exceeding Anthropic's 4 breakpoint limit (5 total).
    if (data.conversationHistory && data.conversationHistory.length > 0) {
      this.logger.info(`Adding ${data.conversationHistory.length} conversation history messages`)
      const convertedHistoryMessages = data.conversationHistory.map((msg) => {
        const converted: any = {
          role: msg.role,
          content: msg.content,
          // Preserve existing cache points from history (e.g., from summarization)
          ...(msg.cachePoint && { cachePoint: msg.cachePoint })
        }

        // Preserve tool calls for assistant messages
        if (msg.role === 'assistant' && msg.tool_calls) {
          converted.tool_calls = msg.tool_calls
        }

        // Tool messages already have content in the correct format (array of tool-result parts)

        return converted
      })
      messages.push(...convertedHistoryMessages)
    }

    // 3. Context messages marked "after_history" go to messages (after conversation history, before user message)
    messages.push(...afterHistoryMessages)

    // 4. Strip leading tool messages that appear before any assistant message
    // This prevents orphaned tool results from being placed at the start of conversation
    // which can happen when context messages are prepended to history
    while (messages.length > 0 && messages[0] && messages[0].role === 'tool') {
      const removedMessage = messages.shift()
      if (removedMessage) {
        this.logger.warn('Stripped leading tool message without preceding assistant message', {
          toolCallId: (removedMessage as any).tool_call_id,
          reason: 'Tool results must follow assistant tool calls, cannot be first message'
        })
      }
    }

    this.logger.info('Message assembly complete', {
      contextMessages: contextMessages.length,
      messages: messages.length,
      cachePoints: contextMessages.filter(m => m.cachePoint).length + messages.filter(m => (m as any).cachePoint).length
    })

    return { messages, contextMessages }
  }

  /**
   * Stream agent response to client using normalized event schema
   * @param shouldComplete - Whether to complete the conversation (false during handoffs)
   */
  private async streamAgentResponse(
    socket: any,
    agent: AgentWrapper,
    data: ChatMessage,
    context: Record<string, unknown> | undefined,
    agentName: string,
    startTime: number,
    shouldComplete: boolean = true
  ): Promise<void> {
    let currentStep = 1

    // Keep the original user prompt intact - no modification!
    const originalPrompt = data.message

    // if the last message in messages == originalPrompt, remove it
    if (data.conversationHistory && data.conversationHistory.length > 0) {
      const lastMessage = data.conversationHistory[data.conversationHistory.length - 1]
      if (lastMessage && lastMessage.content === originalPrompt) {
        data.conversationHistory.pop()
      }
    }

    // Assemble messages using clean interface-based approach
    const { messages, contextMessages } = await this.assembleMessages(data, context)

    // Use getConversation to handle socket ID migration during reconnection
    const activeConversation = this.getConversation(socket.id)
    if (activeConversation && this.config.messagePersistence.startAgentTurn) {
      try {
        const messageId = await this.config.messagePersistence.startAgentTurn(
          activeConversation.conversationId,
          activeConversation.context
        )
        activeConversation.context.agentMessageId = messageId

        // Reset streaming events for the new agent turn so that
        // completeConversation only writes THIS agent's events to its
        // message. Without this, handoff scenarios accumulate events from
        // all agents into a single array and the final message ends up
        // with duplicate tool calls from the previous agent.
        activeConversation.streamingEvents = []
        activeConversation.pendingSegments = []
        activeConversation.pendingToolCalls = new Map()
        activeConversation.accumulatedContent = ''
      } catch (error) {
        this.logger.warn('Failed to start agent turn', error)
      }
    }

    // Start streaming using streamGenerate with clean message assembly
    // Extract screenshots from context metadata if present
    let processedFiles: any[] | undefined
    if (context?.metadata && Array.isArray((context.metadata as any)._screenshots)) {
      const screenshots = (context.metadata as any)._screenshots as string[]
      processedFiles = []
      for (let i = 0; i < screenshots.length; i++) {
        try {
          // Convert data URL to ProcessedFile
          const dataUrl = screenshots[i]
          if (!dataUrl) continue

          const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
          if (matches && matches[1] && matches[2]) {
            const mimeType: string = matches[1]
            const base64Content: string = matches[2]
            const size = Math.ceil((base64Content.length * 3) / 4)
            const fileExtension = mimeType.split('/')[1] || 'png'

            processedFiles.push({
              input: {
                source: dataUrl,
                mimeType,
                filename: `screenshot-${i + 1}.${fileExtension}`
              },
              base64Content,
              metadata: {
                size,
                mimeType,
                filename: `screenshot-${i + 1}.${fileExtension}`,
                extractedAt: new Date(),
                processingTime: 0
              }
            })
          }
        } catch (error) {
          this.logger.error('Failed to process screenshot', error)
        }
      }
      if (processedFiles.length > 0) {
        this.logger.info(`Attached ${processedFiles.length} image(s) for vision processing (screenshots + asset images)`)
      }
    }

    let streamResult

    // Get model information for observability
    let modelName = 'unknown'
    let providerName = 'anthropic' // Default provider
    try {
      const agentConfig = agent.getConfig()
      modelName = agentConfig.modelName || agentName || 'unknown'
      // Extract provider from model name convention (e.g., 'claude-3-5-sonnet' -> anthropic)
      if (modelName.includes('claude') || modelName.includes('anthropic')) {
        providerName = 'anthropic'
      } else if (modelName.includes('gpt') || modelName.includes('openai')) {
        providerName = 'openai'
      } else if (modelName.includes('bedrock')) {
        providerName = 'bedrock'
      }
    } catch (error) {
      this.logger.warn(`Failed to get model info from agent config: ${error}`)
    }

    // Extract identifiers from context for observability
    const appId = context?.metadata && typeof (context.metadata as any).appId === 'string'
      ? (context.metadata as any).appId
      : undefined
    const conversationId = activeConversation?.conversationId

    // Call LLM start hook for observability
    let llmSpanInfo: { spanId: string; startTime: number } | undefined
    if (this.config.onLlmStart) {
      try {
        // Build params object, only including defined values
        const params: Parameters<NonNullable<typeof this.config.onLlmStart>>[0] = {
          socketId: socket.id,
          model: modelName,
          provider: providerName
        }
        if (conversationId !== undefined) params.conversationId = conversationId
        if (appId !== undefined) params.appId = appId
        if (context !== undefined) params.context = context

        // Build input messages array for observability tracking
        const inputMessages: Array<{ role: string; content: string }> = []

        // Add context messages (system prompts, etc.)
        for (const msg of contextMessages) {
          if (msg.content && typeof msg.content === 'string') {
            inputMessages.push({ role: msg.role, content: msg.content })
          }
        }

        // Add conversation history messages
        for (const msg of messages) {
          if (msg.content && typeof msg.content === 'string') {
            inputMessages.push({ role: msg.role, content: msg.content })
          }
        }

        // Add the current user prompt
        inputMessages.push({ role: 'user', content: originalPrompt })

        if (inputMessages.length > 0) {
          params.input = inputMessages
        }

        // Extract available tools from agent config
        try {
          const agentConfig = agent.getConfig()
          if (agentConfig.tools && Array.isArray(agentConfig.tools)) {
            params.tools = agentConfig.tools.map((t: any) => t.name || t.description || 'unknown')
          }
          // Default tool choice is 'auto' for most agents
          params.toolChoice = 'auto'
        } catch (toolError) {
          // Ignore tool extraction errors
        }

        const result = await this.config.onLlmStart(params)
        if (result && typeof result === 'object' && 'spanId' in result) {
          llmSpanInfo = result
        }
      } catch (hookError) {
        this.logger.warn('LLM start hook failed', hookError)
      }
    }

    const llmStartTime = Date.now()

    // Build OTel context with agent-specific data.
    // Signals context is already set by createTraceContext in handleChatMessage.
    const agentOtelContext = createAgentContext({
      conversationId,
      agentId: this.getAgentId(agentName),
    })

    // Create invocation span within the agent context.
    const invocation = otelContext.with(agentOtelContext, () =>
      createAgentInvocationSpan({
        prompt: originalPrompt,
        model: modelName,
        provider: providerName,
      })
    )

    try {
      // Run agent.streamGenerate within the invocation context
      streamResult = await otelContext.with(invocation.context, async () => {
        return await agent.streamGenerate(originalPrompt, {
          // Add context messages with cache points intact
          ...(contextMessages.length > 0 && { context: contextMessages }),
          // Add conversation history messages
          ...(messages.length > 0 && { messages }),
          // Pass execution context for tools
          ...(context && { executionContext: context }),
          // Pass screenshots as files for vision processing
          ...(processedFiles && processedFiles.length > 0 && { files: processedFiles })
        })
      })

      // Check if this is a tool validation error with mock stream
      if (streamResult && (streamResult as any).isToolValidationError) {
        // Publish error event - subscribers handle delivery and persistence
        await this.publishToEventChannel(socket.id, 'error', 'Tool call failed due to invalid input format. The agent is retrying with corrections.', {
          errorType: 'TOOL_VALIDATION_ERROR',
          statusCode: 400,
          timestamp: new Date().toISOString(),
          details: (streamResult as any).validationErrorMessage
        }, agentName)

        // Then continue to process the mock stream normally so LLM can retry
        // (the stream contains corrective feedback for the agent)
      }
    } catch (error: any) {
      // Handle API call errors (like tool input validation failures)
      if (isBudgetExceededAPIError(error)) {
        this.logger.error('Budget exceeded error before streaming started', {
          statusCode: error.statusCode,
          message: error.message
        })

        // End invocation span with error before throwing
        invocation.end({ error, success: false })
        throw new BudgetExceededError(
          'Your AI usage budget has been reached.',
          error.statusCode ?? 400,
          error.responseBody
        )
      }

      const isAPIError = APICallError.isInstance(error)

      this.logger.debug('Caught error in streamGenerate', {
        name: error?.name,
        message: error?.message,
        statusCode: isAPIError ? error.statusCode : error?.statusCode,
        responseBody: isAPIError ? error.responseBody?.slice(0, 200) : error?.responseBody?.slice?.(0, 200),
        isAPIError,
        hasToolUseInvalid: error?.message?.includes('toolUse.input is invalid'),
        hasJSONParsingFailed: error?.message?.includes('JSON parsing failed')
      })

      const isToolValidationError =
        error?.message?.includes('toolUse.input is invalid') ||
        error?.message?.includes('JSON parsing failed')

      if (isToolValidationError) {
        this.logger.error('Tool input validation error', { message: error.message })

        // Publish step start for the failed tool call - subscribers handle delivery and persistence
        const stepStartData = {
          step: currentStep,
          stepType: 'reasoning',
          agentId: agentName,
          agentName: String(this.config.agents.get(agentName)?.getName() || agentName),
          messageId: activeConversation?.context?.agentMessageId  // NEW: Include message ID for pending message tracking
        }
        await this.publishToEventChannel(socket.id, 'step_start', '', stepStartData, agentName)

        // Send tool failure result to show the user what went wrong
        const toolErrorData = {
          step: currentStep,
          tool: {
            id: 'failed-tool-call',
            name: 'tool_validation_failed',
            input: {},
            output: `Tool call failed due to invalid JSON format: ${error.message}. Please check your JSON syntax and try again.`
          },
          agentId: agentName
        }

        // Publish tool result - subscribers handle delivery and persistence
        await this.publishToEventChannel(socket.id, 'tool_result', 'Tool call failed - invalid JSON format', toolErrorData, agentName)

        // Publish step complete - subscribers handle delivery and persistence
        await this.publishToEventChannel(socket.id, 'step_complete', '', {
          step: currentStep,
          isFinal: false,
          toolCalls: [{
            id: 'failed-tool-call',
            name: 'tool_validation_failed',
            input: {},
            output: `Invalid JSON in tool call: ${error.message}`
          }],
          messageId: activeConversation?.context?.agentMessageId,  // NEW: Include message ID for pending message tracking
          usage: undefined,
          agentId: agentName
        }, agentName)

        // Create an error explanation that helps the LLM understand and retry
        const retryPrompt = `The previous tool call failed due to invalid JSON syntax. Error: ${error.message}

Please analyze what went wrong and retry the tool call with properly formatted JSON. Ensure:
1. All string values are properly quoted with double quotes
2. All object properties use valid JSON syntax
3. No trailing commas in objects or arrays
4. All brackets and braces are properly closed
5. No undefined or null values are passed as tool arguments

Please try again with corrected formatting.`

        // Continue the conversation by making a new streamGenerate call with the error feedback
        try {
          currentStep++

          // Add the original prompt to history; retryPrompt is passed as the
          // first arg to streamGenerate which appends it as the current turn.
          const retryMessages = [...messages,
            { role: 'user' as const, content: originalPrompt }
          ]

          streamResult = await otelContext.with(invocation.context, () =>
            agent.streamGenerate(retryPrompt, {
              ...(contextMessages.length > 0 && { context: contextMessages }),
              messages: retryMessages,
              ...(context && { executionContext: context }),
              // Include screenshots in retry as well
              ...(processedFiles && processedFiles.length > 0 && { files: processedFiles })
            })
          )
        } catch (retryError: any) {
          // If retry also fails, fall back to error handling
          this.logger.error('Retry also failed', { message: retryError.message })
          // End invocation span with error before throwing
          invocation.end({ error: retryError, success: false })
          throw retryError
        }
      } else {
        // Non-retryable errors (budget exceeded, etc.) should propagate immediately
        // Note: Transient 400 errors are now handled by the retry infrastructure in retry-with-backoff.ts
        // via the classify() function which uses isTransientBadRequest()
        const errorClassification = classifyError(error);

        // Enhanced logging for 400 errors to help diagnose issues
        if (isAPIError && error.statusCode === 400) {
          this.logger.warn('llm.api.bad_request', {
            socketId: socket.id,
            agentName,
            statusCode: error.statusCode,
            message: error.message,
            responseBodyLength: error.responseBody?.length,
            category: errorClassification.category,
            retryable: errorClassification.retryable
          });
        }

        if (!errorClassification.retryable) {
          this.logger.warn(`Non-retryable error in streamGenerate: ${errorClassification.category || 'unknown'}`, {
            category: errorClassification.category,
            statusCode: errorClassification.statusCode
          });
        }

        // End invocation span with error before throwing
        invocation.end({ error, success: false })
        // Re-throw to be handled by outer catch block or AI SDK retry mechanism
        throw error;
      }
    }

    try {
      // Publish step start - subscribers handle delivery and persistence
      const stepStartData = {
        step: currentStep,
        stepType: 'reasoning',
        agentId: agentName,
        agentName: String(this.config.agents.get(agentName)?.getName() || agentName),
        messageId: activeConversation?.context?.agentMessageId  // NEW: Include message ID for pending message tracking
      }
      await this.publishToEventChannel(socket.id, 'step_start', '', stepStartData, agentName)

      // Reset accumulated content and tool calls for this new LLM call
      // This ensures each LLM call captures only its own streamed output and tool calls, not from previous calls
      if (activeConversation) {
        activeConversation.accumulatedContent = ''
        activeConversation.pendingToolCalls?.clear()
      }

      // Process both text chunks and tool events from baseStream
      await this.processStreamWithToolEvents(socket, streamResult, currentStep, agentName)

      // Get accumulated content from the active conversation (streamed text before/between tool calls)
      // Refresh reference after streaming - the conversation object may have been updated during streaming
      // Use getConversation to handle socket ID migration during reconnection
      const conversationAfterStream = this.getConversation(socket.id)
      const fullContent = conversationAfterStream?.accumulatedContent || ''

      // Debug log for accumulated content and tool calls
      const toolCallCount = conversationAfterStream?.pendingToolCalls?.size || 0
      if (fullContent.length > 0 || toolCallCount > 0) {
        this.logger.debug('LLM response accumulated', {
          fullContentLength: fullContent.length,
          toolCallCount,
          toolNames: toolCallCount > 0 ? Array.from(conversationAfterStream!.pendingToolCalls!.values()).map((tc: any) => tc.name) : [],
          hasActiveConversation: !!conversationAfterStream,
          preview: fullContent.substring(0, 100) + (fullContent.length > 100 ? '...' : '')
        })
      }

      // Get final result with usage and tool calls
      const finalResult = await streamResult.getFinalResult() as AgentExecutionResult

      // Log token and cache usage information
      // Use totalUsage for accurate multi-step token tracking (sums all steps)
      const usageToTrack = finalResult.totalUsage || finalResult.usage
      let costEstimateTotalCost: number | undefined
      if (usageToTrack) {
        // Merge usage data with caching information
        const usage: TokenUsage = {
          ...usageToTrack,
          // Include cache metrics from the caching object if available
          ...(finalResult.caching && {
            cachedInputTokensRead: finalResult.caching.cachedInputTokens,
            cachedInputTokensWrite: finalResult.caching.cacheWriteInputTokens
          })
        }

        // Get model information from agent config
        // Get model name from agent configuration
        let modelName = 'unknown'
        try {
          const agentConfig = agent.getConfig()
          modelName = agentConfig.modelName || agentName || 'unknown'
        } catch (error) {
          this.logger.warn(`Failed to get model name from agent config: ${error}`)
          modelName = agentName || 'unknown'
        }

        this.logger.info('Token Usage Statistics', {
          inputTokens: usage.inputTokens || 0,
          outputTokens: usage.outputTokens || 0,
          totalTokens: usage.totalTokens || 0
        })

        // Log cache usage if available
        const totalCachedTokens = (usage.cachedInputTokensRead || 0) + (usage.cachedInputTokensWrite || 0)
        if (totalCachedTokens > 0) {
          const cacheHitRate = getCacheHitRate(usage)
          const cacheDetails: any = {
            totalCachedTokens,
            cacheHitRate: cacheHitRate.toFixed(1) + '%'
          }
          if (usage.cachedInputTokensRead && usage.cachedInputTokensWrite) {
            cacheDetails.read = usage.cachedInputTokensRead
            cacheDetails.write = usage.cachedInputTokensWrite
          } else if (usage.cachedInputTokensRead) {
            cacheDetails.read = usage.cachedInputTokensRead
          } else if (usage.cachedInputTokensWrite) {
            cacheDetails.write = usage.cachedInputTokensWrite
          }
          this.logger.info('Cache usage', cacheDetails)
        } else {
          this.logger.info('No cache usage detected')
        }

        // Calculate and log cost estimate using accurate model pricing
        const costEstimate = calculateCostEstimate(usage, modelName)
        costEstimateTotalCost = costEstimate.totalCost
        const costLines = formatCostEstimate(costEstimate, usage)
        this.logger.info(costLines.join('\n'))

        // Call onTokenUsage callback with accurate multi-step usage
        if (this.config.onTokenUsage) {
          try {
            const processedContext = context as ProcessedContext
            const contextAppId = processedContext?.appId || (processedContext?.metadata as MetadataRecord)?.appId
            const contextSubscriptionId = (processedContext?.metadata as MetadataRecord)?.subscriptionId
            await this.config.onTokenUsage(
              {
                inputTokens: usage.inputTokens || 0,
                outputTokens: usage.outputTokens || 0,
                totalTokens: usage.totalTokens || 0,
                ...(usage.cachedInputTokensRead !== undefined && { cachedInputTokens: usage.cachedInputTokensRead }),
                ...(usage.cachedInputTokensWrite !== undefined && { cacheWriteInputTokens: usage.cachedInputTokensWrite })
              },
              {
                agentName,
                modelName,
                ...(conversationAfterStream?.conversationId && { conversationId: conversationAfterStream.conversationId }),
                ...(contextAppId && { appId: contextAppId }),
                ...(contextSubscriptionId ? { subscriptionId: contextSubscriptionId } : {})
              }
            )
          } catch (error) {
            this.logger.error('Error in onTokenUsage callback', { error })
          }
        }
      }

      // Call LLM end hook for observability
      if (this.config.onLlmEnd) {
        try {
          // Build params object, only including defined values
          const llmEndParams: Parameters<NonNullable<typeof this.config.onLlmEnd>>[0] = {
            socketId: socket.id,
            startTime: llmSpanInfo?.startTime || llmStartTime,
            model: modelName,
            provider: providerName,
            success: true
          }
          if (llmSpanInfo?.spanId !== undefined) llmEndParams.spanId = llmSpanInfo.spanId
          if (conversationId !== undefined) llmEndParams.conversationId = conversationId
          if (appId !== undefined) llmEndParams.appId = appId
          if (context !== undefined) llmEndParams.context = context
          if (finalResult.finishReason !== undefined) llmEndParams.finishReason = finalResult.finishReason
          if (usageToTrack) {
            const usageObj: NonNullable<typeof llmEndParams.usage> = {}
            if (usageToTrack.inputTokens !== undefined) usageObj.inputTokens = usageToTrack.inputTokens
            if (usageToTrack.outputTokens !== undefined) usageObj.outputTokens = usageToTrack.outputTokens
            if (usageToTrack.totalTokens !== undefined) usageObj.totalTokens = usageToTrack.totalTokens
            if (usageToTrack.cachedInputTokensRead !== undefined) usageObj.cachedTokens = usageToTrack.cachedInputTokensRead
            llmEndParams.usage = usageObj
          }

          // Add output message (assistant's response)
          // Always provide at least an empty assistant message - required for llm_end events
          // When finishReason is 'tool-calls', fullContent may be empty but we still need output
          llmEndParams.output = [{ role: 'assistant', content: fullContent || '' }]

          // Add tool calls if any - use accumulated tool calls from conversation for complete list
          // pendingToolCalls captures ALL tool calls made during streaming, not just the final batch
          const allToolCalls = conversationAfterStream?.pendingToolCalls
          if (allToolCalls && allToolCalls.size > 0) {
            llmEndParams.toolCalls = Array.from(allToolCalls.values()).map((tc: any) => ({
              id: tc.id || 'unknown',
              name: tc.name || 'unknown',
              ...(tc.input && { arguments: tc.input })
            }))
          } else if (finalResult.toolCalls && Array.isArray(finalResult.toolCalls) && finalResult.toolCalls.length > 0) {
            // Fallback to finalResult.toolCalls if pendingToolCalls is not available
            llmEndParams.toolCalls = finalResult.toolCalls.map((tc: any) => ({
              id: tc.toolCallId || tc.id || 'unknown',
              name: tc.toolName || tc.name || 'unknown',
              ...(tc.args && { arguments: tc.args }),
              ...(tc.arguments && { arguments: tc.arguments }),
              ...(tc.input && { arguments: tc.input })
            }))
          }

          // Add reasoning summary if available (for models that support extended thinking)
          if (finalResult.reasoningSummary) {
            llmEndParams.reasoningSummary = finalResult.reasoningSummary
          }

          await this.config.onLlmEnd(llmEndParams)
        } catch (hookError) {
          this.logger.warn('LLM end hook failed', hookError)
        }
      }

      // Calculate duration
      const duration = `${Date.now() - startTime}ms`

      // Publish step complete - subscribers handle delivery and persistence
      await this.publishToEventChannel(socket.id, 'step_complete', fullContent, {
        step: currentStep,
        isFinal: true,
        toolCalls: finalResult.toolCalls || [],
        usage: this.config.includeUsageData ? usageToTrack : undefined,
        agentId: agentName,
        messageId: activeConversation?.context?.agentMessageId  // NEW: Include message ID for pending message tracking
      }, agentName)

      // Only emit completion events if this is the final agent (no handoff pending)
      if (shouldComplete) {
        // Publish final completion event - subscribers handle delivery and persistence
        await this.publishToEventChannel(socket.id, 'complete', fullContent, {
          totalSteps: currentStep,
          usage: this.config.includeUsageData ? usageToTrack : undefined,
          toolCalls: finalResult.toolCalls || [],
          agentId: agentName,
          duration,
          finishReason: finalResult.finishReason,
          messageId: activeConversation?.context?.agentMessageId  // NEW: Include message ID for pending message tracking
        }, agentName)
      }

      // End the invocation span with the final output and aggregated usage
      const toolResults = conversationAfterStream?.pendingToolCalls
      const hasToolResults = toolResults && toolResults.size > 0

      invocation.end({
        outputText: fullContent,
        responseType: fullContent ? 'llm_reply' : 'tool_call',
        ...(hasToolResults && {
          responseData: Array.from(toolResults.values()).map(t => ({
            name: t.name,
            status: t.status,
            output: t.result,
          }))
        }),
        usage: usageToTrack,
        totalCost: costEstimateTotalCost,
        finishReason: finalResult.finishReason,
        success: true,
      })
    } catch (postStreamError: unknown) {
      invocation.end({ error: postStreamError instanceof Error ? postStreamError : String(postStreamError), success: false })
      throw postStreamError
    }

    // Note: Conversation completion is now handled by completeConversation()
    // This allows multiple agents to contribute to the same conversation during handoffs
  }

  /**
   * Get the Socket.IO server instance
   */
  getIO(): SocketIOServer {
    return this.io
  }

  /**
   * Close the WebSocket server
   */
  close(): void {
    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    // Cancel all active streams via state manager
    this.stateManager.abortAll()

    // Close Socket.IO server
    this.io.close()
  }
}

/**
 * Helper factory for creating a simple single-agent factory
 */
export function createSingleAgentFactory(
  agentName: string,
  agentConfig: Parameters<AgentFactory['defineAgents']>[0][string]
): AgentFactory {
  const factory = createAgentFactory()
  factory.defineAgents({
    [agentName]: agentConfig
  })

  return factory
}

/**
 * Create an WebSocketServer instance
 */
export function createWebSocketServer(
  httpServer: HTTPServer,
  config: WebSocketConfig
): WebSocketServer {
  return new WebSocketServer(httpServer, config)
}

function extractAppIdFromMetadata(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined
  }
  const appIdValue = (metadata as MetadataRecord).appId
  return typeof appIdValue === 'string' ? appIdValue : undefined
}

function extractAppIdFromMessageContext(context: unknown): string | undefined {
  if (!context || typeof context !== 'object') {
    return undefined
  }
  const metadata = (context as { metadata?: MetadataRecord }).metadata
  return extractAppIdFromMetadata(metadata)
}

// Re-export interfaces for convenience
export type {
  MessageProvider,
  ContextProvider,
  ConversationPersistence,
  ConversationPersistenceWithCleanup,
  ConversationMessage,
  PersistenceStreamingEvent,
  ConversationContext
} from './interfaces.js'

/**
 * Helper function for single agent use case
 */
export function createSingleAgentWebSocketServer(
  httpServer: HTTPServer,
  agentName: string,
  agentConfig: Parameters<AgentFactory['defineAgents']>[0][string],
  options: Omit<WebSocketConfig, 'agents' | 'defaultAgent'>
): WebSocketServer {
  const factory = createSingleAgentFactory(agentName, agentConfig)
  const agents = factory.defineAgents({ [agentName]: agentConfig })

  return new WebSocketServer(httpServer, {
    agents,
    defaultAgent: agentName,
    ...options
  })
}
