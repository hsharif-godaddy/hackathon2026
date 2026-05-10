import type { LanguageModelUsage, ModelMessage } from 'ai'
import { APICallError, RetryError } from 'ai'
import { Server as SocketIOServer } from 'socket.io'
import type { Socket, ServerOptions } from 'socket.io'
import { Server as HTTPServer } from 'http'
import type { AgentFactory, AgentWrapper, PipelineContextMessage } from '@airo/ai-lib'
import { createAgentFactory } from '@airo/ai-lib'
import {
  buildTokenUsage,
  calculateCostEstimate,
  formatCostEstimate,
  getCacheHitRate,
  dataUrlsToProcessedFiles,
  TOKEN_USAGE_SUMMARY_EVENT,
  type TokenUsageSummaryEvent,
} from '@airo/ai-lib'
import type { ExecutionStep } from '@airo/ai-lib/budget'
import { classifyError, BudgetExceededError, isBudgetExceededAPIError, containsBudgetExceededPattern, createLogger } from '@airo/ai-common'
import { isBudgetServiceError, mapBudgetErrorToResponse } from '@airo/shared/budget'
import { StreamPartProcessor } from './stream-part-processor.js'
import { captureResponseMetadata, awaitResponseMetadata } from './response-metadata-capture.js'
import { redactSkillOutput } from './redact-skill-output.js'
import type { AgentsCollection } from '@airo/ai-lib'
import type { HandoffStateManager } from '@airo/ai-lib'
import {
  TOOL_VALIDATION_ERROR_TYPE,
  type MessageProvider,
  type ContextProvider,
  type HistoryProvider,
  type ConversationPersistence,
  type ConversationPersistenceWithCleanup,
  type ConversationMessage,
  type PersistenceStreamingEvent,
  type ConversationContext,
  type StreamingEventType
} from './interfaces.js'
import { ConversationEventChannel } from './conversation-event-channel.js'
import { WebSocketSubscriber } from './subscribers/websocket-subscriber.js'
import { PersistenceSubscriber } from './subscribers/persistence-subscriber.js'
import { ConnectionStateManager, type ConnectionStateData } from './connection-state-manager.js'
import { ConnectionRecoveryManager } from './connection-recovery-manager.js'
import { executeAgentLoop, AgentNotFoundError } from './agent-execution-loop.js'
import { createError, createHandoff } from '@godaddy/agent-observability-events'
import {
  createAgentContext,
  createAgentInvocationSpan,
  emitError,
  emitHandoff
} from '@godaddy/agent-otel-sdk'
import { context as otelContext, trace } from '@opentelemetry/api'
import { buildChatSignalsTraceContext, type JwtAgentContextSubset } from './chat-signals-trace-context.js'
import { inferProviderFromModelName, type ChatLlmProvider } from './infer-llm-provider.js'
import {
  StreamTimingTracker,
  type StreamTimingData,
} from './stream-timing-tracker.js'
import { ChunkTimeoutGuard } from './chunk-timeout-guard.js'

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
  usage?: LanguageModelUsage
  totalUsage?: LanguageModelUsage
  finishReason?: string
  toolCalls?: any[]
  /** Summary of reasoning (for models that support extended thinking) */
  reasoningSummary?: string
  /** SDK execution steps for cost attribution analysis (when budget service flag ON) */
  steps?: ExecutionStep[]
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

/** Defense-in-depth cap for one user turn over chat WebSocket (message + context attachment strings). */
const MAX_INCOMING_WEBSOCKET_CHAT_CHARS = 100_000

/**
 * Recursive sum of string lengths in nested objects/arrays. Counts every string field on
 * attachments (type, persistence, renderStrategy, source, etc.), not only payload content.
 * Uses a WeakSet to skip circular references.
 */
function stringPayloadLength(value: unknown, seen?: WeakSet<object>): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'string') return value.length
  if (typeof value === 'number' || typeof value === 'boolean') return 0
  if (typeof value === 'object') {
    const visited = seen ?? new WeakSet()
    if (visited.has(value as object)) return 0
    visited.add(value as object)
    let n = 0
    if (Array.isArray(value)) {
      for (const item of value) n += stringPayloadLength(item, visited)
    } else {
      for (const v of Object.values(value as Record<string, unknown>)) n += stringPayloadLength(v, visited)
    }
    return n
  }
  return 0
}

function contextAttachmentsPayloadLength(context: Record<string, unknown> | undefined): number {
  if (!context) return 0
  const raw = context.contextAttachments
  if (!Array.isArray(raw)) return 0
  let n = 0
  for (const att of raw) n += stringPayloadLength(att)
  return n
}

/**
 * Restore budget metadata fields from conversation.context to processedContext.metadata
 * after an agent handoff (processContext() replaces processedContext, losing budget fields).
 * Both fields must be present; partial state is ignored.
 */
export function restoreBudgetMetadata(
  conversationContext: Record<string, unknown> | undefined,
  processedContext: Record<string, unknown>,
): void {
  const budgetId = conversationContext?.bmsBudgetId
  const sessionId = conversationContext?.budgetSessionId
  if (typeof budgetId !== 'string' || typeof sessionId !== 'string') return
  const typed = processedContext as { metadata?: Record<string, unknown> }
  if (!typed.metadata) typed.metadata = {}
  typed.metadata.bmsBudgetId = budgetId
  typed.metadata.budgetSessionId = sessionId
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
  agentRouter?: (socketId: string, data: ChatMessage) => string | undefined | Promise<string | undefined>

  /** Event handlers */
  onConnection?: (socketId: string, meta?: { recoveryMode?: string; previousSocketId?: string }) => void | Promise<void>
  onDisconnection?: (socketId: string, meta?: { reason?: string; transport?: string | undefined }) => void | Promise<void>
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
  /**
   * Optional post-stream validator. Runs after each completed stream iteration,
   * before auto-continuation/handoff checks, and before `beforeMessageComplete` /
   * `completeConversation`. Lets the caller run server-side validation on what
   * the agent just produced (e.g. a type check against the preview workspace)
   * and request an additional in-loop continuation turn using a synthetic user
   * prompt.
   *
   * Skipped when a tool has already set `__autoContinue` on context metadata
   * (tool-driven continuation wins). Failures must be non-fatal: the loop
   * continues to completion even if the validator throws.
   *
   * The hook is invoked once per completed `streamAgentResponse` iteration. If it
   * returns `{ continuationPrompt }`, the execution loop re-runs the current
   * agent with that prompt as the next "user" message. This happens before the
   * git squash-merge in `beforeMessageComplete`, so any files written by the
   * continuation land in the same squashed commit. The caller is responsible
   * for its own retry cap — the loop will only bail on the overall
   * `MAX_HANDOFFS` guard.
   *
   * `toolCalls` contains the tool calls that ran during the just-completed stream
   * (same shape as the data fed to `onLlmEnd`). `abortSignal` is the socket's
   * stream-abort signal; respect it to cancel slow validations when the user
   * stops the turn or disconnects. `emitChunk(text)` publishes a `chunk` event
   * appended to the just-completed assistant message; persistence relies on
   * the server's normal stream completion pipeline (not `updateAgentTurn`,
   * which only fires on `tool_result` events). Use this to tell the user
   * when validation couldn't be resolved without burning another LLM call.
   */
  postStreamValidator?: (params: {
    socketId: string
    context: Record<string, unknown>
    agentName: string
    toolCalls: Array<{ toolName: string; args?: unknown }>
    abortSignal: AbortSignal
    emitChunk: (text: string) => Promise<void>
    emitValidationStart?: () => Promise<void>
  }) => Promise<{ continuationPrompt: string; message?: string } | { skipped: true; reason: string; message?: string } | undefined>
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
    customerId?: string
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
    /** GoCode x-correlation-id from response headers */
    correlationId?: string
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
  socketOptions?: Partial<ServerOptions>

  /** Event channel buffer size per conversation (default: 1000) */
  eventBufferSize?: number

  /** Event channel TTL in ms (default: STREAM_RECOVERY_WINDOW = 2 minutes) */
  eventBufferTTL?: number

  /** Stream recovery window in ms (default: 2 minutes) - time to allow reconnection before aborting stream */
  streamRecoveryWindow?: number

  /** ACK timeout in ms (default: 30 seconds) - time to wait for client acknowledgment after replay */
  ackTimeout?: number

  /**
   * Budget report creation callback. Called after prompt execution to reconcile BMS session.
   * @param budgetId - BMS budget ID
   * @param sessionId - BMS session ID
   * @param socketId - Effective socket ID after migration (for emitting events to the connected socket)
   * @param originalSocketId - Original socket ID from message start (for looking up per-socket state like assessment outcome)
   * @param steps - SDK execution steps for cost attribution analysis (optional)
   * @param wasUserAborted - True if user clicked Stop - prevents misattributing aborted sessions as GoDaddy cost
   * @returns payload is BudgetUpdatePayload (from @airo/shared/budget) when refreshRequired is false
   */
  onBudgetReport?: (budgetId: string, sessionId: string, socketId: string, originalSocketId: string, steps?: ExecutionStep[], wasUserAborted?: boolean) => Promise<
    | { refreshRequired: false; payload: Record<string, unknown>; sessionWasFree: boolean; reportId?: string }
    | { refreshRequired: true; sessionWasFree?: boolean }
  >

  /**
   * Called when a mid-stream budget exceeded error is detected during stream processing.
   * The callback should attempt grant advancement and return whether to retry or continue.
   *
   * @param socketId - The socket ID for the session experiencing the error
   * @param error - The budget exceeded error
   * @param executedToolNames - Tool names that have completed execution in this stream
   * @returns retry: true + newUserId to retry/continue; retry: false to propagate the error
   */
  onBudgetExhaustedMidStream?: (
    socketId: string,
    error: Error,
    executedToolNames: string[],
  ) => Promise<{ retry: boolean; newUserId?: string; hasNonIdempotentTools: boolean }>

  /**
   * Wrap the entire message execution pipeline. Called once per chat_message,
   * surrounding agent execution, tool calls, summarization, and all post-processing.
   * Use to establish per-request context (e.g. AsyncLocalStorage for model overrides).
   */
  messageMiddleware?: (
    socketId: string,
    context: Record<string, unknown> | undefined,
    execute: () => Promise<void>
  ) => Promise<void>

  /**
   * Transport-layer chunk timeout in ms (default: -1, disabled).
   * Set to a positive ms value to enable. Aborts the per-socket
   * AbortController when no chunk arrives within this window.
   * Pauses during tool execution.
   */
  chunkTimeoutMs?: number
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
   * Store execution steps per socket for cost attribution.
   * Set in streamAgentResponse after getFinalResult(), consumed in completeConversation.
   * Cleaned up after passing to onMessageComplete callback.
   * Key: socketId, Value: ExecutionStep[]
   */
  private pendingExecutionSteps: Map<string, ExecutionStep[]> = new Map()

  /**
   * Event channel for pub/sub event delivery
   * Enables decoupled event transport and connection recovery
   */
  private eventChannel: ConversationEventChannel

  /**
   * Recovery window for connection state recovery (default: 2 minutes)
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
    this.STREAM_RECOVERY_WINDOW = config.streamRecoveryWindow ?? 2 * 60 * 1000 // 2 minutes
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
      this.logger.warn('event_channel.ttl_clamped', {
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
        this.logger.debug('event_channel.cleanup', { removedConversations: removed })
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
      // Increase ping timeout to tolerate brief network blips (mobile backgrounding,
      // WiFi switching) without triggering disconnect → grace period → abort.
      // With pingInterval=25s (default), total tolerance is ~70s before disconnect fires.
      pingTimeout: 45_000,
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
        if (this.config.messageMiddleware) {
          await this.config.messageMiddleware(
            socketId,
            data.context as Record<string, unknown> | undefined,
            () => this.handleChatMessage(socket, data)
          )
        } else {
          await this.handleChatMessage(socket, data)
        }
      })

      socket.on('stop_generation', (_data: Record<string, unknown>, ack?: (response: { success?: boolean; error?: string }) => void) => {
        const stateData = this.stateManager.getStateData(socketId)
        if (!stateData?.abortController) {
          ack?.({ error: 'No active stream' })
          return
        }
        this.stateManager.updateConnection(socketId, { userStopped: true })
        stateData.abortController.abort('user_stopped')
        this.logger.info('stop_generation', { socketId })
        ack?.({ success: true })
      })

      socket.on('get_agents', () => {
        this.sendAvailableAgents(socket)
      })

      // Unified history handler: initial load and pagination.
      // cursor absent → initial load:  history_message* → history_loaded
      // cursor present → pagination:   history_message* → history_complete
      //
      // Server timeout is intentionally shorter than the client retry timeout
      // (StreamingMessageList: 15_000ms) so the client always receives history_loaded
      // with an error before it fires its own retry. This keeps the retry cycle clean:
      // server times out → emits error → client retries → new request starts fresh.
      const LOAD_HISTORY_TIMEOUT_MS = 15_000 - 3_000 // 3s shorter than client retry

      socket.on('load_history', async (data: { conversationId: string; cursor?: string; limit?: number }) => {
        const isPagination = !!data.cursor
        const completionEvent = isPagination ? 'history_complete' : 'history_loaded'

        this.logger.debug('history.load.begin', {
          socketId,
          conversationId: data.conversationId,
          cursor: data.cursor,
          limit: data.limit,
          isPagination
        })

        if (!this.config.historyProvider) {
          this.logger.warn('history.load.no_provider', { socketId })
          socket.emit('message', {
            type: completionEvent,
            content: '',
            data: { messageCount: 0, hasMore: false, nextCursor: null, error: 'History provider not configured' }
          })
          return
        }

        // Capture after the guard so TypeScript narrows the type inside the async IIFE below
        const historyProvider = this.config.historyProvider

        const stateData = this.stateManager.getStateData(socketId)
        let appId = stateData?.context?.appId
        if (!appId) {
          const authRecord = socket.handshake.auth as Record<string, unknown>
          appId = authRecord?.appId as string
            ?? (authRecord?.agentContext as Record<string, unknown>)?.appId as string
            ?? (authRecord?.decoded as Record<string, unknown>)?.appId as string
        }

        if (!appId) {
          this.logger.warn('history.load.no_app_id', { socketId })
          socket.emit('message', {
            type: completionEvent,
            content: '',
            data: { messageCount: 0, hasMore: false, nextCursor: null, error: 'App context not found' }
          })
          return
        }

        let timeoutHandle: NodeJS.Timeout | undefined
        try {
          const historyResult = await Promise.race([
            historyProvider.loadHistory(
              data.conversationId,
              appId,
              data.cursor ? { before: data.cursor, limit: data.limit ?? 20 } : { limit: data.limit ?? 20 }
            ),
            new Promise<never>((_, reject) => {
              timeoutHandle = setTimeout(
                () => reject(new Error(`load_history timed out after ${LOAD_HISTORY_TIMEOUT_MS}ms`)),
                LOAD_HISTORY_TIMEOUT_MS
              )
            })
          ])

          const messages = Array.isArray(historyResult) ? historyResult : historyResult.messages
          const paginationInfo = Array.isArray(historyResult)
            ? { hasMore: false, nextCursor: null, total: messages.length }
            : { hasMore: historyResult.hasMore, nextCursor: historyResult.nextCursor, total: historyResult.total ?? messages.length }

          // Clear stale metadata.inProgress when no producer is attached, so the client
          // doesn't falsely detect an active stream from a crashed/stopped agent.
          // Skip the check for pagination — older history can't contain the current
          // in-progress stream.
          const streamCompleted = !isPagination &&
            !this.stateManager.hasActiveStreamForConversation(data.conversationId)

          let historySequence = -1000
          for (const msg of messages) {
            const outMsg = streamCompleted && msg.metadata?.['inProgress']
              ? { ...msg, metadata: { ...msg.metadata, inProgress: false } }
              : msg
            socket.emit('message', {
              type: 'history_message',
              content: '',
              data: { ...outMsg, sequence: historySequence--, ...(isPagination && { isPagination }) }
            })
          }

          socket.emit('message', {
            type: completionEvent,
            content: '',
            data: {
              messageCount: messages.length,
              hasMore: paginationInfo.hasMore,
              nextCursor: paginationInfo.nextCursor,
              total: paginationInfo.total
            }
          })

          this.logger.debug('history.load.success', {
            socketId,
            conversationId: data.conversationId,
            messageCount: messages.length,
            hasMore: paginationInfo.hasMore,
            isPagination
          })
        } catch (error) {
          this.logger.error('history.load.failure', {
            socketId,
            conversationId: data.conversationId,
            error: error instanceof Error ? error.message : String(error)
          })

          socket.emit('message', {
            type: completionEvent,
            content: '',
            data: {
              messageCount: 0,
              hasMore: false,
              nextCursor: null,
              error: error instanceof Error ? error.message : 'Failed to load history'
            }
          })
        } finally {
          if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
        }
      })

      socket.on('disconnecting', () => {
        // Flush coalesced events while socket can still write, then clean up timer.
        // During 'disconnect', socket.connected is already false so emitMessages
        // would be a no-op. The event channel has all events for recovery regardless.
        const wsSubscriber = (socket as any).data?.wsSubscriber as WebSocketSubscriber | undefined
        if (wsSubscriber) {
          wsSubscriber.dispose()
        }
      })

      socket.on('disconnect', async (reason) => {
        const transport = this.getTransportName(socket)
        if (reason === 'ping timeout') {
          const pingStateData = this.stateManager.getStateData(socketId)
          this.logger.warn('quality.ping_timeout_disconnect', {
            socketId,
            reason,
            transport,
            conversationId: pingStateData?.conversationId,
            agentName: pingStateData?.agentName,
          })
        }
        this.logger.info('socket.disconnect', { socketId, reason, transport })

        // Check if there's an active stream for this socket via state manager
        const stateData = this.stateManager.getStateData(socketId)
        const hasActiveStream = this.stateManager.hasActiveStream(socketId)

        if (hasActiveStream && stateData) {
          // Don't abort immediately - transition to disconnected state with timeout
          this.logger.info('socket.disconnect.recovery_start', {
            socketId,
            recoveryWindow: `${this.STREAM_RECOVERY_WINDOW}ms`,
            conversationId: stateData.conversationId,
            transport,
          })

          // Set timeout to abort if client doesn't reconnect
          const timeoutId = setTimeout(() => {
            this.logger.warn('socket.disconnect.recovery_expired', { socketId })
            stateData.abortController?.abort('user_cancel')
            // Don't call cleanupConversation here — it races with completeConversation
            // in handleChatMessageInternal. completeConversation persists the message
            // first, then handleChatMessageInternal cleans up state after.
          }, this.STREAM_RECOVERY_WINDOW)

          // Transition to disconnected state
          this.stateManager.transitionTo(socketId, 'disconnected', {
            recoveryTimeoutId: timeoutId
          })
        } else if (stateData && !hasActiveStream) {
          // Conversation exists but stream not yet registered - setup still in progress
          this.logger.info('disconnect.during_setup', {
            socketId,
            conversationId: stateData.conversationId,
            reason,
            transport,
            connectionState: stateData.state,
          })

          // Create a placeholder AbortController for the disconnected state
          const placeholderController = new AbortController()

          const timeoutId = setTimeout(() => {
            this.logger.warn('deferred_cleanup.expired', { socketId })
            placeholderController.abort('user_cancel')
            this.cleanupConversation(socketId).catch((error) => {
              this.logger.error('deferred_cleanup.error', error)
            })
          }, this.STREAM_RECOVERY_WINDOW)

          // Transition to disconnected state with placeholder controller
          this.stateManager.transitionTo(socketId, 'disconnected', {
            recoveryTimeoutId: timeoutId,
            abortController: placeholderController
          })
        } else {
          this.logger.debug('socket.disconnect.idle', { socketId })
        }

        // Clean up APM spans (these can't be recovered)
        this.cleanupToolSpans(socketId)

        try {
          await this.config.onDisconnection?.(socketId, { reason, transport })
        } catch (error) {
          this.logger.error('socket.disconnect.handler_error', error)
        }
      })

      this.logger.info('socket.connect', {
        socketId,
        previousSocketId: previousSocketId || undefined,
        transport: this.getTransportName(socket),
      })

      // Send server_config immediately — client needs timeout values (ackTimeout) and
      // capability flags (supportsConnectThenAuth) before it can authenticate.
      // These values are not sensitive; the real protection against unauthenticated
      // access to conversation data is completeConnectionSetup being deferred below.
      this.emitServerConfig(socket)

      // Debug logging for recovery
      if (previousSocketId) {
        this.logger.debug('socket.reconnect', {
          socketId,
          previousSocketId,
          hasDisconnectedStream: this.stateManager.isDisconnected(previousSocketId),
          disconnectedStreamsCount: this.stateManager.getDisconnectedCount(),
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

  private getTransportName(socket: Socket): string | undefined {
    // Best-effort access to Engine.IO internals; falls back to undefined if shape changes.
    const s = socket as Socket & { conn?: { transport?: { name?: string } } }
    return s.conn?.transport?.name
  }

  private async fireOnConnection(socketId: string, meta?: { recoveryMode?: string; previousSocketId?: string }): Promise<void> {
    try {
      await this.config.onConnection?.(socketId, meta)
    } catch (error) {
      this.logger.error('socket.connect.handler_error', error)
    }
  }

  // Emit a diagnostic event over socket, gated by
  // SOCKET_DIAGNOSTICS. Swallows emit failures and logs
  // them with full session context for correlation.
  private emitDiagnostic<T>(
    socket: Socket,
    event: string,
    payload: T,
    context: {
      socketId: string
      appId: string
      agentName: string
      modelName: string
    }
  ): void {
    if (process.env.SOCKET_DIAGNOSTICS !== 'true') return
    try {
      socket.emit(event, payload)
    } catch (err) {
      this.logger.warn('socket.diagnostic.emit.failed', {
        ...context,
        event,
        error: err instanceof Error
          ? err.message
          : String(err),
      })
    }
  }

  private emitServerConfig(socket: Socket): void {
    if (socket.data?.serverConfigSent) return
    socket.data = { ...socket.data, serverConfigSent: true }
    socket.emit('message', {
      type: 'server_config',
      content: '',
      data: {
        streamRecoveryWindow: this.STREAM_RECOVERY_WINDOW,
        ackTimeout: this.ACK_TIMEOUT_MS,
        supportsWebSocketHistory: !!this.config.historyProvider,
        supportsConnectThenAuth: true,
        serverVersion: '2.0'
      }
    })
  }

  /**
   * Complete connection setup after authentication.
   * Called immediately for handshake-auth sockets, deferred for connect-then-auth sockets.
   *
   * Includes: recovery detection, onConnection callback, sendAvailableAgents and history_complete
   */
  async completeConnectionSetup(socket: Socket, signal?: AbortSignal): Promise<void> {
    // Idempotency guard — prevent duplicate setup if called more than once
    if (socket.data?.connectionSetupComplete) {
      this.logger.debug('setup.already_complete', { socketId: socket.id })
      return
    }
    // Set flag eagerly BEFORE async work to prevent interleaving
    socket.data = { ...socket.data, connectionSetupComplete: true }

    const socketId = socket.id
    const auth = socket.handshake.auth || {}

    const detectedRecoveryMode = await this.recoveryManager.attemptRecovery(socket)
    signal?.throwIfAborted()

    if (detectedRecoveryMode === 'manual') {
      await this.runManualRecovery(socket, auth.previousSocketId!)
      await this.fireOnConnection(socket.id, { recoveryMode: 'manual', previousSocketId: auth.previousSocketId })
      return
    }

    if (auth.previousSocketId && !detectedRecoveryMode) {
      signal?.throwIfAborted()
      await this.runStaleReconnect(socket, socketId, auth)
    }

    if (detectedRecoveryMode === 'conversation') {
      signal?.throwIfAborted()
      await this.runConversationRecovery(socket, socketId, auth)
      await this.fireOnConnection(socket.id, { recoveryMode: 'conversation', previousSocketId: auth.previousSocketId })
      return
    }

    if (detectedRecoveryMode === 'initial') {
      signal?.throwIfAborted()
      await this.runInitialRecovery(socket, socketId, auth)
      await this.fireOnConnection(socket.id, { recoveryMode: 'initial', previousSocketId: auth.previousSocketId })
      return
    }

    signal?.throwIfAborted()

    await this.fireOnConnection(socketId)

    this.sendAvailableAgents(socket)
  }


  private async runManualRecovery(socket: Socket, previousSocketId: string): Promise<void> {
    await this.recoveryManager.handleManualRecovery(socket, previousSocketId, {
      onRecoveryComplete: (_completedSocketId, _events, _finalSequence) => {
        // State manager handles all state updates including socket ID migration
      },
      onRecoveryFailed: (_failedSocketId, _reason) => {
        // State manager handles cleanup via recoveryManager.cleanupAfterRecoveryFailure
      },
      createWebSocketSubscriber: (sock) => this.createCoalescingWebSocketSubscriber(sock)
    })
  }

  // Handles the edge case where previousSocketId was sent but the stream had already
  // completed/cleaned up before the client reconnected — no buffered events to replay.
  private async runStaleReconnect(
    socket: Socket,
    socketId: string,
    auth: Record<string, any>
  ): Promise<void> {
    this.logger.debug('recovery.no_events', {
      newSocketId: socketId,
      previousSocketId: auth.previousSocketId,
      hasConversationId: !!auth.conversationId
    })
    await this.recoveryManager.sendStreamCompletedStatus(socket, auth.conversationId)
  }

  // Tab-closure recovery: client lost the ephemeral socketId but has a durable conversationId cookie.
  private async runConversationRecovery(
    socket: Socket,
    socketId: string,
    auth: Record<string, any>
  ): Promise<void> {
    interface AuthDataWithSiteId {
      agentContext?: { siteId?: string }
      decoded?: { siteId?: string }
      siteId?: string
    }
    const entry = this.stateManager.findDisconnectedByConversationId(auth.conversationId)
    const stateData = entry?.[1]
    const validate = (conversationId: string, authData: Record<string, any>): boolean => {
      const typedAuth = authData as AuthDataWithSiteId
      const authenticatedSiteId =
        typedAuth.agentContext?.siteId ||
        typedAuth.decoded?.siteId ||
        typedAuth.siteId
      if (!authenticatedSiteId) {
        this.logger.warn('recovery.conversation.no_site_id', {
          socketId,
          conversationId,
          authKeys: Object.keys(authData)
        })
        return false
      }
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
    await this.recoveryManager.handleConversationRecovery(socket, auth.conversationId, validate, {
      onRecoveryComplete: (_completedSocketId, _events, _finalSequence) => {
        // State manager handles all state updates including socket ID migration
      },
      onRecoveryFailed: (_failedSocketId, _reason) => {
        // State manager handles cleanup via recoveryManager.cleanupAfterRecoveryFailure
      },
      createWebSocketSubscriber: (sock) => this.createCoalescingWebSocketSubscriber(sock)
    })
  }

  // Initial load with existing conversationId OR reconnect after the recovery window expired.
  private async runInitialRecovery(
    socket: Socket,
    socketId: string,
    auth: Record<string, any>
  ): Promise<void> {
    interface AuthDataWithSiteId {
      agentContext?: { siteId?: string }
      decoded?: { siteId?: string }
      siteId?: string
    }
    const validate = (conversationId: string, authData: Record<string, any>): boolean => {
      const typedAuth = authData as AuthDataWithSiteId
      const authenticatedSiteId =
        typedAuth.agentContext?.siteId ||
        typedAuth.decoded?.siteId ||
        typedAuth.siteId
      if (!authenticatedSiteId) {
        this.logger.warn('recovery.initial.no_site_id', {
          socketId,
          conversationId,
          authKeys: Object.keys(authData)
        })
        return false
      }
      // No stateData to compare against — auth middleware already validated access to appId.
      // The conversationId cookie is scoped to the authenticated domain.
      this.logger.debug('recovery.initial.validation', {
        socketId,
        conversationId,
        authenticatedSiteId
      })
      return true
    }
    await this.recoveryManager.handleInitialRecovery(socket, auth.conversationId, validate, {
      onRecoveryComplete: (_completedSocketId, _events, _finalSequence) => {
        // State manager handles all state updates
      },
      onRecoveryFailed: (_failedSocketId, _reason) => {
        // State manager handles cleanup via recoveryManager.cleanupAfterRecoveryFailure
      },
      createWebSocketSubscriber: (sock) => this.createCoalescingWebSocketSubscriber(sock)
    })
  }

  // Engine.IO internal API (socket.io ^4.8.3, engine.io 6.6.4).
  // writeBuffer is private — no public backpressure signal exists.
  // If this path breaks after a Socket.IO upgrade, returns 0 → base window (safe fallback).
  // Verify after upgrading: `socket.conn.writeBuffer` should be an array of pending packets.
  private createCoalescingWebSocketSubscriber(socket: Socket): WebSocketSubscriber {
    const subscriber = new WebSocketSubscriber(
      socket,
      (id: string) => this.stateManager.isDisconnected(id),
      {
        getBackpressure: () => (socket as any).conn?.writeBuffer?.length ?? 0
      }
    )
    if (!socket.data) socket.data = {}
    socket.data.wsSubscriber = subscriber
    return subscriber
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
      this.logger.warn('event_channel.publish.failure', {
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
      this.logger.debug('cleanup.already_in_progress', { socketId: effectiveId })
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

    // Clean up pending execution steps (cost attribution)
    this.pendingExecutionSteps.delete(socketId)
    this.pendingExecutionSteps.delete(effectiveId)

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

    for (const [spanKey] of this.activeObservabilityToolSpans.entries()) {
      if (spanKey.startsWith(`${socketId}:`)) {
        this.activeObservabilityToolSpans.delete(spanKey)
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
      this.logger.debug('event_channel.track', {
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
              this.logger.debug('turn.tool_result.update', {
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
            this.logger.warn('turn.tool_result.failure', error)
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
        if (toolInput !== undefined) {params.toolInput = toolInput}
        if (conversationId !== undefined) {params.conversationId = conversationId}
        if (appId !== undefined) {params.appId = appId}
        if (context !== undefined) {params.context = context}

        const result = await this.config.onToolStart(params)

        if (result && typeof result === 'object' && 'spanId' in result) {
          const spanKey = `${socketId}:${toolId}`
          this.activeObservabilityToolSpans.set(spanKey, result)
        }
      } catch (hookError) {
        this.logger.warn('tool.hook.start.failure', { error: hookError })
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
        if (observabilitySpan?.spanId !== undefined) {params.spanId = observabilitySpan.spanId}
        if (observabilitySpan?.startTime !== undefined) {params.startTime = observabilitySpan.startTime}
        if (toolResponse !== undefined) {params.toolResponse = toolResponse}
        if (conversationId !== undefined) {params.conversationId = conversationId}
        if (appId !== undefined) {params.appId = appId}
        if (context !== undefined) {params.context = context}

        await this.config.onToolEnd(params)
      } catch (hookError) {
        this.logger.warn('tool.hook.end.failure', { error: hookError })
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
  private async processStreamWithToolEvents(
    socket: any,
    streamResult: any,
    currentStep: number,
    agentName: string,
    modelName: string
  ): Promise<StreamTimingData> {
    const baseStream = streamResult.baseStream
    if (!baseStream) {
      // Fallback to text-only streaming if baseStream is not available
      return this.processTextOnlyStream(
        socket, streamResult, currentStep, agentName, modelName
      )
    }

    let reader: ReadableStreamDefaultReader | null = null
    const socketId = socket.id
    const abortController = this.stateManager.getAbortController(socketId)

    // Get agent message ID for event tracking
    const activeConversation = this.getConversation(socketId)
    const agentMessageId = activeConversation?.context?.agentMessageId

    // Stream diagnostics — track progress and inter-chunk timing
    const tracker = new StreamTimingTracker({
      socket, agentName, modelName,
      logger: this.logger,
      ...(abortController && { abortController }),
    })
    const guard = this.createChunkTimeoutGuard(
      abortController, socketId, agentName, modelName
    )
    let timingData: StreamTimingData = {
      timeToFirstTextChunkMs: null,
      maxChunkGapMs: 0,
      chunksRead: 0,
      streamDurationMs: 0,
    }

    try {
      reader = baseStream.getReader()

      guard?.arm()

      const pendingPublishes: Promise<unknown>[] = []

      const processor = new StreamPartProcessor({
        onTextDelta: (content) => {
          tracker.recordTextChunk()
          const textData = {
            step: currentStep,
            source: 'ai_response',
            agentId: agentName,
            messageId: agentMessageId
          }
          pendingPublishes.push(this.publishToEventChannel(socketId, 'chunk', content, textData, agentName))
        },

        onToolStart: (toolCallId, toolName) => {
          const toolStartData = {
            step: currentStep,
            tool: {
              id: toolCallId,
              name: toolName,
              input: {}
            },
            agentId: agentName,
            messageId: agentMessageId
          }
          this.startToolSpan(socket.id, toolCallId, toolName).catch(err =>
            this.logger.warn('tool.span.start_failed', { toolId: toolCallId, error: err instanceof Error ? err.message : String(err) })
          )
          pendingPublishes.push(this.publishToEventChannel(socketId, 'tool_start', `Using ${toolName}...`, toolStartData, agentName))
        },

        onToolInputDelta: (toolCallId, delta, _accumulated, toolName) => {
          const toolInputDeltaData = {
            toolId: toolCallId,
            toolName,
            delta,
            agentId: agentName,
            messageId: agentMessageId
          }
          pendingPublishes.push(this.publishToEventChannel(socketId, 'tool_input_delta', '', toolInputDeltaData, agentName))
        },

        onToolCall: (toolCallId, toolName, parsedInput) => {
          guard?.pause()
          tracker.pauseGapTracking(toolName)
          if (typeof parsedInput === 'string') {
            this.logger.error('tool.input.parse_failure', {
              toolCallId,
              toolName,
              // Preserve the pre-refactor field name so existing Grafana /
              // Loki queries keyed on `fullInput` keep matching. Truncated
              // to 200 chars to cap log-shipper payloads.
              fullInput: parsedInput.slice(0, 200),
            })
          }
          const toolCallData = {
            step: currentStep,
            tool: {
              id: toolCallId,
              name: toolName,
              input: typeof parsedInput === 'string' ? {} : parsedInput
            },
            agentId: agentName
          }
          pendingPublishes.push(this.publishToEventChannel(socketId, 'tool_call', `${toolName} input ready`, toolCallData, agentName))

          const spanKey = `${socket.id}:${toolCallId}`
          const span = this.activeToolSpans.get(spanKey)
          if (span && typeof parsedInput === 'object' && parsedInput && Object.keys(parsedInput as Record<string, unknown>).length > 0) {
            span.addLabels({
              tool_input_keys: Object.keys(parsedInput as Record<string, unknown>).join(',')
            })
          }
        },

        onToolResult: (toolCallId, result, sdkInput, sdkToolName) => {
          guard?.reset()
          tracker.resumeGapTracking()
          const toolRecord = processor.getToolCall(toolCallId)
          const toolName = sdkToolName ?? toolRecord?.name ?? 'unknown'
          const toolOutput = redactSkillOutput(toolName, result)
          // Prefer the AI SDK's `part.input` (post schema coercion / default
          // injection) when present; fall back to the tool-input-delta buffer,
          // normalizing a raw-string buffer (tool-call JSON parse failure) to {}.
          const input = sdkInput !== undefined
            ? sdkInput
            : (typeof toolRecord?.input === 'string' ? {} : toolRecord?.input)

          const toolResultData = {
            step: currentStep,
            tool: {
              id: toolCallId,
              name: toolName,
              input,
              output: toolOutput
            },
            agentId: agentName
          }
          this.endToolSpan(socket.id, toolCallId, toolName, true, result).catch(err =>
            this.logger.warn('tool.span.end_failed', { toolId: toolCallId, error: err instanceof Error ? err.message : String(err) })
          )
          pendingPublishes.push(this.publishToEventChannel(socketId, 'tool_result', `${toolName} completed`, toolResultData, agentName))
        },

        onToolError: (toolCallId, error, sdkInput, sdkToolName) => {
          guard?.reset()
          tracker.resumeGapTracking()
          const toolRecord = processor.getToolCall(toolCallId)
          const toolName = sdkToolName ?? toolRecord?.name ?? 'unknown'
          const input = sdkInput !== undefined
            ? sdkInput
            : (typeof toolRecord?.input === 'string' ? {} : toolRecord?.input)
          const errorMessage = error.message

          const toolErrorData = {
            step: currentStep,
            tool: {
              id: toolCallId,
              name: toolName,
              input,
              output: {},
              error: errorMessage,
              is_error: true
            },
            agentId: agentName
          }
          this.endToolSpan(socket.id, toolCallId, toolName, false, undefined, errorMessage).catch(err =>
            this.logger.warn('tool.span.end_failed', { toolId: toolCallId, error: err instanceof Error ? err.message : String(err) })
          )
          pendingPublishes.push(this.publishToEventChannel(socketId, 'tool_result', `${toolName} failed: ${errorMessage}`, toolErrorData, agentName))
        },

        // WS manages steps externally via the tool-calling loop (line ~3080).
        // The processor's internal step counter is only used by SSE.
        onStepStart: () => {},

        onError: (error) => {
          // Check for budget exceeded: APICallError with budget pattern in responseBody,
          // or plain Error with budget pattern in message (mid-stream GoCode errors)
          if (isBudgetExceededAPIError(error)) {
            this.logger.error('budget.exceeded', {
              message: error.message,
              statusCode: error.statusCode
            })
            throw new BudgetExceededError(
              'Your AI usage budget has been reached.',
              error.statusCode ?? 400,
              error.responseBody
            )
          }
          const errorMessage = error instanceof Error ? error.message : String(error)
          if (containsBudgetExceededPattern(errorMessage)) {
            this.logger.error('budget.exceeded.mid_stream', {
              message: errorMessage,
            })
            throw new BudgetExceededError(
              'Your AI usage budget has been reached.',
              400,
              errorMessage
            )
          }

          // Log and re-throw other errors unchanged
          this.logger.error('stream.error.part', {
            message: errorMessage,
            statusCode: APICallError.isInstance(error) ? error.statusCode : undefined
          })
          throw error instanceof Error ? error : new Error(String(error))
        }
      })

      while (true) { // Intentional infinite loop until stream is done
        // Check if the stream was cancelled
        if (abortController?.signal.aborted) {
          this.logger.warn('stream.cancelled')
          break
        }

        let readResult
        try {
          readResult = await reader!.read()
        } catch (readError: unknown) {
          const errorMessage = readError instanceof Error
            ? readError.message
            : String(readError)
          if (abortController?.signal.reason === 'chunk_timeout') {
            tracker.recordTimeout(errorMessage)
          }
          if (this.isNetworkError(readError)) {
            this.logger.warn('stream.read.network_error', {
              socketId,
              agentName,
              error: errorMessage,
              chunksRead: tracker.chunksRead,
              streamElapsedMs: tracker.streamElapsedMs,
              abortSignalAborted: abortController?.signal.aborted ?? false,
            })
            throw readError // Re-throw to trigger fallback
          }
          throw readError
        }

        const { done, value } = readResult

        if (done) {
          break
        }

        tracker.recordChunk()
        guard?.reset()

        if (value?.part) {
          // Drain publishes even if processPart throws (e.g. onError fires
          // for a budget error) so the socket doesn't miss the preceding
          // tool_call/chunk/tool_result events queued during this part.
          // publishToEventChannel absorbs all errors internally (see its
          // top-level catch), so Promise.all here cannot reject and will
          // never mask the processPart exception we want to propagate.
          try {
            processor.processPart(value.part)
          } finally {
            await Promise.all(pendingPublishes)
            pendingPublishes.length = 0
          }
        }
      }
      timingData = tracker.finalize()
    } catch (error: unknown) {
      // Non-retryable errors (budget exceeded, auth, etc.) should propagate immediately
      const classification = classifyError(error);
      if (!classification.retryable) {
        // Check for budget exceeded: APICallError with responseBody, or plain Error with pattern in message
        if (isBudgetExceededAPIError(error)) {
          this.logger.error('budget.exceeded.non_retryable', {
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
        const outerErrorMsg = error instanceof Error ? error.message : String(error)
        if (!BudgetExceededError.isInstance(error) && containsBudgetExceededPattern(outerErrorMsg)) {
          this.logger.error('budget.exceeded.non_retryable.mid_stream', {
            category: classification.category,
            message: outerErrorMsg,
          });

          throw new BudgetExceededError(
            'Your AI usage budget has been reached.',
            400,
            outerErrorMsg
          );
        }

        if (!abortController?.signal.aborted) {
          this.logger.error('stream.error.non_retryable', {
            category: classification.category,
            message: error instanceof Error ? error.message : String(error)
          });
        }
        throw error;
      }

      const errorInfo = this.analyzeStreamError(error);
      const activeConv = this.getConversation(socketId)
      const convAppId = activeConv?.context?.metadata && typeof (activeConv.context.metadata as any).appId === 'string'
        ? (activeConv.context.metadata as any).appId
        : undefined

      // Fire-and-forget: extract response metadata without blocking the fallback path.
      // Settled inline via .then() so the log is emitted after metadata is available,
      // but the fallback attempt is NOT delayed.
      this.extractResponseMetadata(streamResult).then(responseMeta => {
        this.logger.error('stream.base_stream.error', {
          socketId,
          appId: convAppId,
          agentName,
          errorType: errorInfo.type,
          errorMessage: errorInfo.message,
          errorCode: errorInfo.code,
          causeChain: errorInfo.causeChain,
          statusCode: errorInfo.statusCode,
          responseBody: errorInfo.responseBody,
          isNetworkError: errorInfo.isNetworkError,
          isAbortError: errorInfo.isAbortError,
          step: currentStep,
          classification: classification.category,
          chunksRead: tracker.chunksRead,
          streamElapsedMs: tracker.streamElapsedMs,
          abortSignalAborted: abortController?.signal.aborted ?? false,
          responseHeaders: responseMeta.headers,
          responseId: responseMeta.responseId,
          responseModelId: responseMeta.modelId,
        })
      })

      // Fallback to text-only streaming with better error handling
      try {
        timingData = await this.processTextOnlyStream(
          socket, streamResult, currentStep, agentName, modelName
        )
      } catch (fallbackError: unknown) {
        const fallbackInfo = this.analyzeStreamError(fallbackError);
        this.extractResponseMetadata(streamResult).then(responseMeta => {
          this.logger.error('stream.text_fallback.error', {
            socketId,
            appId: convAppId,
            agentName,
            errorType: fallbackInfo.type,
            errorMessage: fallbackInfo.message,
            errorCode: fallbackInfo.code,
            causeChain: fallbackInfo.causeChain,
            statusCode: fallbackInfo.statusCode,
            responseBody: fallbackInfo.responseBody,
            isNetworkError: fallbackInfo.isNetworkError,
            step: currentStep,
            responseHeaders: responseMeta.headers,
            responseId: responseMeta.responseId,
            responseModelId: responseMeta.modelId,
          })
        })
        // Always rethrow — both base stream and fallback failed, nothing left to retry.
        // The outer handleChatMessageInternal catch block notifies the client and cleans
        // up conversation state. Without rethrowing, the caller proceeds to getFinalResult()
        // on the dead stream which hangs forever and permanently blocks the message queue.
        throw fallbackError;
      }
    } finally {
      guard?.dispose()
      // Ensure reader is always cleaned up
      await this.safeCleanupReader(reader)
    }
    return timingData
  }

  /**
   * Helper method to safely process text-only streaming
   */
  private async processTextOnlyStream(
    socket: any,
    streamResult: any,
    currentStep: number,
    agentName: string,
    modelName: string
  ): Promise<StreamTimingData> {
    const socketId = socket.id
    const abortController = this.stateManager.getAbortController(socketId)

    // Get agent message ID for event tracking
    const activeConversation = this.getConversation(socketId)
    const agentMessageId = activeConversation?.context?.agentMessageId

    // Inter-chunk timing diagnostics
    const tracker = new StreamTimingTracker({
      socket, agentName, modelName,
      logger: this.logger,
      ...(abortController && { abortController }),
    })
    const guard = this.createChunkTimeoutGuard(
      abortController, socketId, agentName, modelName
    )

    try {
      guard?.arm()
      for await (const chunk of streamResult.textStream) {
        // Check if the stream was cancelled
        if (abortController?.signal.aborted) {
          this.logger.warn('stream.text.cancelled')
          break
        }

        // Record chunk arrival before publishing so timestamps
        // reflect when the chunk was received. Measured gaps
        // include publish overhead and for-await backpressure,
        // but these are small relative to the 90s slow-gap
        // threshold.
        tracker.recordChunk()
        guard?.reset()
        tracker.recordTextChunk()

        const chunkData = {
          step: currentStep,
          source: 'ai_response',
          agentId: agentName,
          messageId: agentMessageId,
        }

        await this.publishToEventChannel(
          socketId, 'chunk', chunk, chunkData, agentName
        )
      }
    } catch (error: unknown) {
      const errorInfo = this.analyzeStreamError(error)

      if (abortController?.signal.reason === 'chunk_timeout') {
        tracker.recordTimeout(errorInfo.message)
      }
      if (!errorInfo.isAbortError) {
        const activeConv = this.getConversation(socketId)
        const convAppId = activeConv?.context?.metadata && typeof (activeConv.context.metadata as any).appId === 'string'
          ? (activeConv.context.metadata as any).appId
          : undefined
        this.extractResponseMetadata(streamResult).then(responseMeta => {
          this.logger.error('stream.text_only.error', {
            socketId,
            appId: convAppId,
            agentName,
            errorType: errorInfo.type,
            errorMessage: errorInfo.message,
            errorCode: errorInfo.code,
            causeChain: errorInfo.causeChain,
            statusCode: errorInfo.statusCode,
            responseBody: errorInfo.responseBody,
            isNetworkError: errorInfo.isNetworkError,
            step: currentStep,
            responseHeaders: responseMeta.headers,
            responseId: responseMeta.responseId,
            responseModelId: responseMeta.modelId,
          })
        })
        throw error
      }
    } finally {
      guard?.dispose()
    }
    return tracker.finalize()
  }

  /**
   * Analyze stream errors to provide better error handling
   */
  private analyzeStreamError(error: unknown): {
    type: string
    message: string
    isNetworkError: boolean
    isAbortError: boolean
    code: string | undefined
    causeChain: string[]
    statusCode: number | undefined
    responseBody: string | undefined
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

    // Extract error code (e.g. UND_ERR_SOCKET from undici)
    const code = (error as any)?.code as string | undefined

    // Walk the cause chain to surface the root network/socket error
    const causeChain: string[] = []
    let current: unknown = (error as any)?.cause
    while (current && causeChain.length < 5) {
      if (current instanceof Error) {
        const causeCode = (current as any).code ? ` [${(current as any).code}]` : ''
        causeChain.push(`${current.name}: ${current.message}${causeCode}`)
        current = (current as any).cause
      } else if (typeof current === 'string') {
        causeChain.push(current)
        break
      } else if (typeof current === 'object' && current !== null) {
        // Duck-type plain objects with code/message (common in undici causes)
        const obj = current as Record<string, unknown>
        const causeCode = typeof obj.code === 'string' ? ` [${obj.code}]` : ''
        const msg = typeof obj.message === 'string' ? obj.message : JSON.stringify(current)
        const name = typeof obj.name === 'string' ? obj.name : 'Object'
        causeChain.push(`${name}: ${msg}${causeCode}`)
        current = obj.cause
      } else {
        causeChain.push(String(current))
        break
      }
    }

    // Extract any HTTP response info from AI SDK APICallError or similar
    const statusCode = (error as any)?.statusCode as number | undefined
    const rawBody = (error as any)?.responseBody
    const responseBody = typeof rawBody === 'string' ? rawBody.slice(0, 500) : undefined

    return {
      type: errorType,
      message: errorMessage,
      isNetworkError,
      isAbortError,
      code,
      causeChain,
      statusCode,
      responseBody,
    }
  }

  /**
   * Check if an error is network-related
   */
  private isNetworkError(error: unknown): boolean {
    if (!error) {return false}

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

  /** Delegates to the shared `awaitResponseMetadata` helper. Preserved as a
   * method for callers inside this class that expect `this.extractResponseMetadata`. */
  private extractResponseMetadata(streamResult: any) {
    return awaitResponseMetadata(streamResult?.response)
  }

  /**
   * Safely cleanup a stream reader
   */
  private async safeCleanupReader(reader: ReadableStreamDefaultReader | null): Promise<void> {
    if (!reader) {return}

    try {
      // Cancel the reader if it's still active
      await reader.cancel()
    } catch (cancelError: unknown) {
      // Ignore cancel errors - reader might already be closed
      const errorMessage = cancelError instanceof Error ? cancelError.message : String(cancelError)
      this.logger.debug('reader.cancel.error', { error: errorMessage })
    }

    try {
      // Release the lock
      reader.releaseLock()
    } catch (releaseError: unknown) {
      // Ignore release errors - lock might already be released
      const errorMessage = releaseError instanceof Error ? releaseError.message : String(releaseError)
      this.logger.debug('reader.release.error', { error: errorMessage })
    }
  }

  /**
   * Handle incoming chat messages with handoff support
   * Serializes message processing per socket to prevent concurrent race conditions
   */
  private async handleChatMessage(socket: any, data: ChatMessage): Promise<void> {
    const socketId = socket.id

    // Diagnostic: Log that message was received
    this.logger.info('chat_message.received', {
      socketId,
      messageLength: data.message?.length ?? 0,
      hasContext: !!data.context,
      conversationId: (data.context as any)?.conversation?.conversationId
    })

    // Build trace context early so all events (including conversation_start) share the same trace ID.
    const appId = extractAppIdFromMessageContext(data.context)
    const handshakeHeaders = socket.handshake?.headers as
      | Record<string, string | string[] | undefined>
      | undefined
    const jwtAgentCtx = socket.handshake?.auth?.agentContext as JwtAgentContextSubset | undefined
    const traceCtx = buildChatSignalsTraceContext({
      ...(handshakeHeaders !== undefined && { headers: handshakeHeaders }),
      ...(jwtAgentCtx != null && { jwtAgentContext: jwtAgentCtx }),
      ...(appId !== undefined && appId.length > 0 && { appId }),
      logPrefix: 'websocket',
      logFields: { socketId },
      logger: { warn: (event, fields) => this.logger.warn(event, fields) },
    })

    return otelContext.with(traceCtx, () =>
      this.stateManager.queueMessage(socketId, () => this.handleChatMessageInternal(socket, data))
    ).catch((err: unknown) => {
      this.logger.error('websocket.chat_message.queue_failed', {
        socketId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
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
    // Budget session lifecycle: captured for finally-block report creation (Unit 6)
    // Local vars survive even if catch block clears conversation.context
    let budgetSessionBudgetId: string | undefined
    let budgetSessionSessionId: string | undefined

    let budgetReportFiled = false
    let budgetSessionWasFree = false

    try {
      // Validate message
      if (!data.message || typeof data.message !== 'string') {
        throw new Error('Invalid message: message field is required and must be a string')
      }

      const contextPayload =
        data.context && typeof data.context === 'object' && !Array.isArray(data.context)
          ? (data.context as Record<string, unknown>)
          : undefined
      const incomingCharTotal = data.message.length + contextAttachmentsPayloadLength(contextPayload)
      if (incomingCharTotal > MAX_INCOMING_WEBSOCKET_CHAT_CHARS) {
        throw new Error('Message exceeds maximum length limit')
      }

      // 1. Determine initial agent (check state manager first for handoffs)
      agentName = await this.getActiveAgent(socketId, data)
      if (!agentName) {
        throw new Error('No agent specified and no default agent configured')
      }

      // 1.5. Strip /agent marker from message if present
      if (data.message && typeof data.message === 'string') {
        const firstLine = data.message.split('\n')[0]?.trim()
        if (firstLine?.match(/^\/agent\s+\w+$/i)) {
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
        // Dispose old subscriber's coalescer timer before unsubscribing
        const oldSubscriber = (socket as any).data?.wsSubscriber as WebSocketSubscriber | undefined
        if (oldSubscriber) oldSubscriber.dispose()
        this.eventChannel.unsubscribe(conversationId, `websocket-${effectiveSocketId}`)
        this.eventChannel.subscribe(
          conversationId,
          this.createCoalescingWebSocketSubscriber(socket)
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
            this.logger.warn('conversation_info.ack_failure', {
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

      // 5b. Thread budget state to conversation.context (persists across handoffs)
      // Budget state is set by onMessageStart on metadata when app-builder-budget-service flag is enabled.
      // processedContext is replaced on each handoff; conversation.context is not
      const budgetMeta = (processedContext as { metadata?: Record<string, unknown> })?.metadata
      if (budgetMeta?.bmsBudgetId && budgetMeta?.budgetSessionId) {
        budgetSessionBudgetId = budgetMeta.bmsBudgetId as string
        budgetSessionSessionId = budgetMeta.budgetSessionId as string
        const budgetConversation = this.getConversation(socketId)
        if (budgetConversation) {
          budgetConversation.context.bmsBudgetId = budgetSessionBudgetId
          budgetConversation.context.budgetSessionId = budgetSessionSessionId
        }
      }

      // 6. Create abort controller and register with state manager
      // Capture signal locally so abort checks remain valid even if
      // cleanupConversation removes the state manager entry before
      // the stream's async abort handlers finish executing.
      const controller = new AbortController()
      const abortSignal = controller.signal
      this.stateManager.updateConnection(socketId, { abortController: controller, userStopped: false })

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
            this.logger.warn('disconnect.recovery_expired_early', { socketId })
            controller.abort('user_cancel')
            // Don't call cleanupConversation here — same race as the primary timeout.
            // handleChatMessageInternal cleans up after completeConversation finishes.
          }, this.STREAM_RECOVERY_WINDOW)

          this.stateManager.updateConnection(socketId, {
            abortController: controller,
            recoveryTimeoutId: newTimeoutId
          })

          this.logger.info('pending_setup.converted_to_disconnected', {
            socketId,
            conversationId: stateData.conversationId
          })
        } else {
          this.logger.info('pending_setup.cleared', { socketId })
        }
      }

      // Accumulate execution steps across all agent iterations for cost attribution.
      // Each agent's steps are collected and combined, not overwritten.
      const allExecutionSteps: ExecutionStep[] = []

      // 7. Execute agent(s) - loop handles handoffs and auto-continuation
      // `currentLoopAgentName` tracks the agent actively executing inside the
      // loop so `getAutoContinuation` can include the active agent name in its
      // log lines without waiting for the outer `agentName` to be rewritten
      // after the loop returns. `postStreamValidate`/`onHandoff` get their
      // agent names directly from callback parameters.
      let currentLoopAgentName = agentName
      let currentLoopIteration = 0
      const loopResult = await executeAgentLoop<AgentWrapper>(agentName, data.message, {
        getAgent: (name) => this.config.agents.get(name) as AgentWrapper | undefined,
        streamAgentTurn: async (agent, name, message, iteration) => {
          currentLoopAgentName = name
          currentLoopIteration = iteration
          if (iteration > 0) {
            processedContext = await this.processContext(data, socketId)
            const handoffConv = this.getConversation(socketId)
            restoreBudgetMetadata(handoffConv?.context, processedContext)

            const { conversationHistory: _conversationHistory, ...dataWithoutHistory } = data
            // Reassign the enclosing `data` so the next iteration's message
            // payload (fed to other callbacks via closure) reflects history
            // already having been loaded on the server side.
            data = { ...dataWithoutHistory, message } as ChatMessage
            await this.loadConversationHistory(socketId, data, processedContext)
          }

          const iterationData: ChatMessage = { ...data, message }
          const streamResult = await this.streamAgentResponse(socket, agent, iterationData, processedContext, name, startTime, false)

          if (streamResult.steps.length > 0) {
            allExecutionSteps.push(...streamResult.steps)
            // Update Map for finally-block fallback (in case error/abort happens later)
            this.pendingExecutionSteps.set(socketId, allExecutionSteps)
          }
        },
        postStreamValidate: async (name) => {
          // `postStreamConv?.context` can be undefined when the conversation was
          // cleaned up between stream end and here (disconnect / abort race).
          // Fall back to processedContext so the validator and the subsequent
          // auto-continuation check read/write the SAME object.
          const postStreamConv = this.getConversation(socketId)
          const continuationContext = (postStreamConv?.context ?? processedContext) as Record<string, unknown>
          const continuationMetadata = (continuationContext.metadata as Record<string, unknown> | undefined) ?? {}
          const toolSetAutoContinue = continuationMetadata.__autoContinue === true
          if (!this.config.postStreamValidator || toolSetAutoContinue) return

          const validatorToolCalls = postStreamConv?.pendingToolCalls
            ? Array.from(postStreamConv.pendingToolCalls.values()).map((tc: any) => ({
              toolName: tc.name,
              ...(tc.input !== undefined && { args: tc.input })
            }))
            : []
          const validationId = `post_stream_validation_${currentLoopIteration}_${Date.now()}`
          let validationStarted = false
          try {
            const resolvedAgentName = name || this.config.defaultAgent || 'unknown'
            const validatorResult = await this.config.postStreamValidator({
              socketId,
              context: continuationContext,
              agentName: resolvedAgentName,
              toolCalls: validatorToolCalls,
              abortSignal,
              emitChunk: async (text: string) => {
                if (!text) return
                await this.publishToEventChannel(
                  socketId,
                  'chunk',
                  text,
                  { agentId: resolvedAgentName },
                  resolvedAgentName
                )
              },
              emitValidationStart: async () => {
                const sequence = await this.publishToEventChannel(
                  socketId,
                  'validation_message',
                  'Validating code...',
                  {
                    validationId,
                    metadata: {
                      source: 'post_stream_validator',
                      displayAs: 'validation',
                      validationStatus: 'running'
                    },
                    agentId: resolvedAgentName
                  },
                  resolvedAgentName
                )
                validationStarted = sequence !== undefined
              }
            })

            if (
              validatorResult &&
              typeof validatorResult === 'object' &&
              typeof (validatorResult as { continuationPrompt?: unknown }).continuationPrompt === 'string' &&
              !abortSignal.aborted
            ) {
              const continuationPrompt = (validatorResult as { continuationPrompt: string }).continuationPrompt
              const validationMessage = typeof (validatorResult as { message?: unknown }).message === 'string'
                ? (validatorResult as { message: string }).message
                : continuationPrompt
              const conversation = this.getConversation(socketId)
              let validationMessageId: string | undefined = undefined
              if (conversation && this.config.messagePersistence.continueConversation) {
                try {
                  validationMessageId = await this.config.messagePersistence.continueConversation(
                    conversation.conversationId,
                    continuationPrompt,
                    {
                      ...conversation.context,
                      messageMetadata: {
                        source: 'post_stream_validator',
                        displayAs: 'validation',
                        validationStatus: 'failed'
                      }
                    }
                  )
                } catch (persistenceError) {
                  this.logger.error('post_stream_validator.persistence_failure', {
                    socketId,
                    conversationId: conversation.conversationId,
                    agentName: resolvedAgentName,
                    error: persistenceError instanceof Error ? persistenceError.message : String(persistenceError)
                  })
                }
              }
              if (validationStarted) {
                await this.publishToEventChannel(
                  socketId,
                  'validation_message',
                  validationMessage,
                  {
                    validationId,
                    ...(validationMessageId !== undefined && { messageId: validationMessageId }),
                    role: 'user',
                    metadata: {
                      source: 'post_stream_validator',
                      displayAs: 'validation',
                      validationStatus: 'failed'
                    },
                    agentId: resolvedAgentName
                  },
                  resolvedAgentName
                )
              }
              continuationMetadata.__autoContinue = true
              continuationMetadata.__continuationPrompt = continuationPrompt
              continuationContext.metadata = continuationMetadata
            } else if (!abortSignal.aborted && validationStarted) {
              const skippedResult = validatorResult &&
                typeof validatorResult === 'object' &&
                (validatorResult as { skipped?: unknown }).skipped === true
                  ? validatorResult as { skipped: true; reason: string; message?: string }
                  : undefined
              if (skippedResult?.reason === 'exhausted') {
                await this.publishToEventChannel(
                  socketId,
                  'validation_message',
                  'Validation could not resolve all issues.',
                  {
                    validationId,
                    metadata: {
                      source: 'post_stream_validator',
                      displayAs: 'validation',
                      validationStatus: 'error'
                    },
                    agentId: resolvedAgentName
                  },
                  resolvedAgentName
                )
              } else if (!skippedResult) {
                await this.publishToEventChannel(
                  socketId,
                  'validation_message',
                  'No issues found.',
                  {
                    validationId,
                    metadata: {
                      source: 'post_stream_validator',
                      displayAs: 'validation',
                      validationStatus: 'completed'
                    },
                    agentId: resolvedAgentName
                  },
                  resolvedAgentName
                )
              } else {
                this.logger.warn('post_stream_validator.unhandled_skipped_result', {
                  socketId,
                  agentName: resolvedAgentName,
                  reason: skippedResult.reason
                })
                await this.publishToEventChannel(
                  socketId,
                  'validation_message',
                  'Validation stopped before completing.',
                  {
                    validationId,
                    metadata: {
                      source: 'post_stream_validator',
                      displayAs: 'validation',
                      validationStatus: 'error'
                    },
                    agentId: resolvedAgentName
                  },
                  resolvedAgentName
                )
              }
            }
          } catch (validatorError) {
            // Validator is additive; failures must never block message
            // completion. Record every throw — an abort-concurrent throw gets
            // an info-level event (expected) while a genuine validator bug
            // gets an error (investigate). Losing either to an unconditional
            // early-return would mean silent data loss on races.
            const errMsg = validatorError instanceof Error ? validatorError.message : String(validatorError)
            const errStack = validatorError instanceof Error ? validatorError.stack : undefined
            if (abortSignal.aborted) {
              this.logger.info('post_stream_validator.aborted', { socketId, agentName: name, error: errMsg })
              return
            }
            this.logger.error('post_stream_validator.failure', {
              socketId,
              agentName: name,
              error: errMsg,
              stack: errStack,
            })
            if (validationStarted) {
              // Use the callback `name` param, not the outer `agentName`
              // closure which is only updated after executeAgentLoop returns.
              // Post-handoff, the outer `agentName` would be 'a' while this
              // iteration is actually running under 'b'.
              const resolvedAgentName = name || this.config.defaultAgent || 'unknown'
              try {
                await this.publishToEventChannel(
                  socketId,
                  'validation_message',
                  errMsg,
                  {
                    validationId,
                    metadata: {
                      source: 'post_stream_validator',
                      displayAs: 'validation',
                      validationStatus: 'error'
                    },
                    agentId: resolvedAgentName
                  },
                  resolvedAgentName
                )
              } catch (publishError) {
                this.logger.warn('post_stream_validator.error_publish_failure', {
                  socketId,
                  agentName: resolvedAgentName,
                  error: publishError instanceof Error ? publishError.message : String(publishError)
                })
              }
            }
          }
        },
        getAutoContinuation: () => {
          const conv = this.getConversation(socketId)
          const continuationContext = (conv?.context ?? processedContext) as Record<string, unknown> | undefined
          const meta = continuationContext?.metadata as Record<string, unknown> | undefined
          if (continuationContext && meta?.__autoContinue === true) {
            const rawPrompt = meta.__continuationPrompt as string | undefined
            if (!rawPrompt) {
              this.logger.warn('auto_continuation.missing_prompt', { socketId, agentName: currentLoopAgentName })
            }
            const prompt = rawPrompt || 'Continue processing'
            delete meta.__autoContinue
            delete meta.__continuationPrompt
            // Flag deletion happens BEFORE `attachConversationId` runs. If
            // `attachConversationId` ever threw, the deletions would have
            // already taken effect and the continuation prompt would be lost
            // — but `attachConversationId` only writes to context metadata
            // (no I/O, no fallible state-manager calls), so this ordering is
            // deliberate: keep the mutation site together and rely on the
            // no-throw contract of the helper.
            processedContext = continuationContext
            this.attachConversationId(processedContext, socketId)
            const conversationId = this.getConversation(socketId)?.conversationId
            this.logger.info('auto_continuation.detected', {
              socketId,
              agentName: currentLoopAgentName,
              conversationId,
              continuationPromptPreview: prompt.slice(0, 120),
            })
            return { prompt }
          }
          return null
        },
        getHandoffDetails: (currentAgent) => this.getHandoffDetails(socketId, currentAgent),
        onHandoff: async (oldAgent, newAgent) => {
          this.logger.info('handoff.detect', { socketId, fromAgent: oldAgent, toAgent: newAgent })
          const currentAppId = extractAppIdFromMessageContext(data.context)
          if (
            currentAppId &&
            this.config.stateManager &&
            'setSessionMetadata' in this.config.stateManager &&
            typeof this.config.stateManager.setSessionMetadata === 'function'
          ) {
            this.config.stateManager.setSessionMetadata(socketId, { appId: currentAppId })
          }

          try {
            emitHandoff({
              conversationId: conversationIdForCleanup,
              agentId: this.getAgentId(oldAgent),
              eventData: createHandoff({
                fromAgentId: this.getAgentId(oldAgent),
                fromAgentName: oldAgent,
                toAgentId: this.getAgentId(newAgent),
                toAgentName: newAgent,
                reason: 'Agent handoff',
                routingMethod: 'llm'
              })
            })
          } catch (telemetryError) {
            // Telemetry must never abort a handoff; log and continue.
            this.logger.warn('handoff.telemetry_emit_failed', {
              socketId,
              fromAgent: oldAgent,
              toAgent: newAgent,
              error: telemetryError instanceof Error ? telemetryError.message : String(telemetryError)
            })
          }

          const conversation = this.getConversation(socketId)
          if (conversation && this.config.onAgentChanged) {
            // Intentionally NOT wrapped: this hook persists the agent switch
            // (DB update in the agents service). If this were swallowed by a
            // try/catch, the next iteration would run under the new agent
            // without a persisted record — tools attributing to the previous
            // agent and conversation history in an inconsistent state.
            // Surfacing the rejection propagates to the outer catch and
            // aborts the turn so the client retry starts with clean state
            // instead of a corrupt one. Contrast `emitHandoff` above
            // (observability-only, non-fatal).
            await this.config.onAgentChanged(
              conversation.conversationId,
              oldAgent,
              newAgent,
              currentAppId
            )
          }
        },
        isAborted: () => abortSignal.aborted,
      })
      agentName = loopResult.finalAgentName
      if (loopResult.termination === 'aborted') {
        this.logger.info('stream.aborted.skip_completion', { socketId, agentName })
      } else if (loopResult.termination === 'max_handoffs') {
        this.logger.warn('agent.loop.max_handoffs_reached', {
          socketId,
          agentName,
          iterations: loopResult.iterations,
        })
      }

      // 8. Budget reconciliation BEFORE completion so credits are updated
      // before the client sees the complete event. If reconciliation takes
      // >10s, emit a progress signal so the client knows we're still working.
      if (budgetSessionBudgetId && budgetSessionSessionId && !budgetReportFiled) {
        let progressTimer: ReturnType<typeof setTimeout> | undefined
        try {
          progressTimer = setTimeout(() => {
            const effectiveSid = this.stateManager.getEffectiveSocketId(socketId)
            const socket = this.io.sockets.sockets.get(effectiveSid)
            if (socket?.connected) {
              socket.emit('budget_status', { status: 'reconciling' })
            }
          }, 10_000)
          if (typeof progressTimer === 'object' && 'unref' in progressTimer) progressTimer.unref()

          // Use accumulated execution steps from the handoff loop (not Map lookup)
          // Check if user aborted - prevents misattributing user-aborted sessions as GoDaddy cost
          const preReportStateData = this.stateManager.getStateData(socketId)
          const wasUserAborted = abortSignal.aborted && preReportStateData?.userStopped
          const budgetResult = await this.fileBudgetReport(
            budgetSessionBudgetId, budgetSessionSessionId, socketId, allExecutionSteps, undefined, wasUserAborted,
          )
          // Only mark as filed AFTER we confirm the result - if fileBudgetReport throws
          // before its internal try block, budgetReportFiled stays false and the finally
          // block fallback can retry
          if (budgetResult.filed) {
            budgetReportFiled = true
            // Clean up steps only after successful budget report
            this.pendingExecutionSteps.delete(socketId)
            budgetSessionWasFree = budgetResult.sessionWasFree
          }
          // If !budgetResult.filed: budgetReportFiled stays false, steps preserved for
          // finally-block fallback retry. TODO: When budget flag is on and report filing
          // fails, the BMS session remains open with unreconciled costs. Need to implement
          // a reconciliation strategy (e.g., background retry queue, session cleanup job,
          // or manual intervention).
        } finally {
          if (progressTimer !== undefined) clearTimeout(progressTimer)
        }
      }

      // 9. Complete the conversation (after reconciliation)
      // Always runs — handles both normal and abort paths:
      //   - Persistence finalization (message saved with inProgress: false)
      //   - Pre-completion hooks (git commits)
      //   - Complete event publication (with finishReason if aborted)
      const completionStateData = this.stateManager.getStateData(socketId)
      const finishReason = abortSignal.aborted
        ? (completionStateData?.userStopped ? 'user_stopped' : 'aborted')
        : undefined
      const budgetServiceEnabled = (processedContext as { metadata?: { budgetServiceEnabled?: boolean } })?.metadata?.budgetServiceEnabled
      await this.completeConversation(socketId, agentName, startTime, processedContext, finishReason, budgetSessionWasFree, budgetServiceEnabled)

      // Clean up state after abort — the disconnect timeout handler defers cleanup
      // to here so it doesn't race with completeConversation above.
      if (abortSignal.aborted) {
        await this.cleanupConversation(socketId).catch((error) => {
          this.logger.error('abort.cleanup_failure', {
            socketId,
            error: error instanceof Error ? error.message : String(error)
          })
        })
      }

    } catch (error: unknown) {
      // Extract error details for UI
      let errorMessage = error instanceof Error ? error.message : String(error);
      let errorType: string | undefined;
      let statusCode: number | undefined;
      let retryAttempts: number | undefined;
      let retryReason: string | undefined;

      // AgentNotFoundError — hide the internal agent name from the wire;
      // the real name is already in error.agentName for server-side logging.
      if (error instanceof AgentNotFoundError) {
        this.logger.warn('agent.not_found', { socketId, requestedAgent: error.agentName });
        errorMessage = 'Agent unavailable';
        errorType = 'AGENT_NOT_FOUND';
        statusCode = 500;
      }
      // Check if it's an AppNotFoundError (duck-typed from agents service)
      else if (error instanceof Error && 'errorType' in error && (error as any).errorType === 'APP_NOT_FOUND') {
        errorMessage = error.message;
        errorType = 'APP_NOT_FOUND';
        statusCode = 404;
      }
      // Check if it's a BudgetExceededError (from LiteLLM stream or pre-execution budget check)
      else if (BudgetExceededError.isInstance(error)) {
        errorMessage = error.message;
        errorType = 'BUDGET_EXCEEDED';
        statusCode = error.statusCode;
      }
      // BudgetService errors — use shared utility to map to sanitized response
      else if (isBudgetServiceError(error)) {
        const response = mapBudgetErrorToResponse(error)
        errorMessage = response.message
        errorType = response.errorType
        statusCode = response.statusCode
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

      const topLevelErrorInfo = this.analyzeStreamError(error)
      this.logger.warn('agent.error', {
        message: errorMessage,
        errorType,
        statusCode,
        socketId,
        agentName,
        originalError: error instanceof Error ? error.message : undefined,
        originalErrorName: error instanceof Error ? error.name : undefined,
        errorCode: topLevelErrorInfo.code,
        causeChain: topLevelErrorInfo.causeChain,
        isNetworkError: topLevelErrorInfo.isNetworkError,
        responseBody: topLevelErrorInfo.responseBody,
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
          isRetryable: errorType === 'RETRY_ERROR' || statusCode === 503 || statusCode === 429 || (errorType === 'BUDGET_SERVICE_ERROR' && statusCode !== undefined && statusCode >= 500),
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
      // Budget report creation fallback: if normal path didn't file (error/abort), attempt here
      // TODO: If this fallback also fails, the BMS session remains open with unreconciled costs.
      // Need to implement reconciliation strategy (background retry, cleanup job, etc.).
      if (budgetSessionBudgetId && budgetSessionSessionId && !budgetReportFiled) {
        // Wrap in try-catch to prevent fileBudgetReport errors from replacing the original exception.
        // If fileBudgetReport throws (e.g., socket.emit fails in its own catch block), the exception
        // would replace the original error from the outer catch, silently discarding the root cause.
        try {
          // In error/abort path, steps may still be available
          const fallbackSteps = this.pendingExecutionSteps.get(socketId)
          // Check if user aborted - use state manager since abortSignal may not be initialized if error was thrown early
          const finallyStateData = this.stateManager.getStateData(socketId)
          const finallyAbortController = this.stateManager.getAbortController(socketId)
          const finallyWasUserAborted = finallyAbortController?.signal.aborted && finallyStateData?.userStopped
          const fallbackResult = await this.fileBudgetReport(
            budgetSessionBudgetId, budgetSessionSessionId, socketId, fallbackSteps, 'finally', finallyWasUserAborted,
          )
          if (fallbackResult.filed) {
            this.pendingExecutionSteps.delete(socketId)
          } else {
            // Both primary and fallback attempts failed - BMS session is unreconciled
            // Log for operational visibility; steps are preserved for potential future retry
            this.logger.error('budget.report.fallback_also_failed', {
              socketId: this.stateManager.getEffectiveSocketId(socketId),
              budgetId: budgetSessionBudgetId,
              sessionId: budgetSessionSessionId,
              stepCount: fallbackSteps?.length ?? 0,
            })
            // Still delete steps to prevent memory leak - reconciliation requires external mechanism
            this.pendingExecutionSteps.delete(socketId)
          }
        } catch (fallbackErr) {
          this.logger.error('budget.report.finally_fallback_threw', {
            socketId: this.stateManager.getEffectiveSocketId(socketId),
            budgetId: budgetSessionBudgetId,
            sessionId: budgetSessionSessionId,
            error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
          })
          this.pendingExecutionSteps.delete(socketId)
        }
      }

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
  private async getActiveAgent(socketId: string, data: ChatMessage): Promise<string | undefined> {
    // Always evaluate router first so brand new apps can start with the Initial agent
    const routedAgent = this.config.agentRouter ? await this.config.agentRouter(socketId, data) : undefined

    if (this.config.stateManager?.getCurrentAgent) {
      const currentAgent = this.config.stateManager.getCurrentAgent(socketId)
      if (currentAgent) {
        const currentAppId = extractAppIdFromMessageContext(data.context)
        const sessionAppId = this.config.stateManager.getSessionMetadata?.(socketId)?.appId

        if (sessionAppId && currentAppId && sessionAppId !== currentAppId) {
          this.logger.debug('session.app_id_changed', {
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
    const currentAgent = await this.getActiveAgent(socketId, data)
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
    if (!this.config.messageProvider || data.conversationHistory) {return}

    const conversation = this.getConversation(socketId)
    if (!conversation) {return}

    try {
      const conversationHistory = await this.config.messageProvider.loadMessages(
        conversation.conversationId,
        processedContext
      )

      data.conversationHistory = conversationHistory
    } catch (error) {
      this.logger.warn('history.load.failure', error)
    }
  }

  /**
   * Create a ChunkTimeoutGuard if configured with a
   * positive timeout, otherwise return null.
   */
  private createChunkTimeoutGuard(
    abortController: AbortController | null | undefined,
    socketId: string,
    agentName: string,
    modelName: string
  ): ChunkTimeoutGuard | null {
    if (
      !abortController
      || this.config.chunkTimeoutMs == null
      || this.config.chunkTimeoutMs <= 0
    ) {
      return null
    }
    return new ChunkTimeoutGuard(
      {
        abortController,
        logger: this.logger,
        socketId,
        agentName,
        modelName,
      },
      this.config.chunkTimeoutMs
    )
  }

  /**
   * Check if handoff occurred and get details
   */
  private getHandoffDetails(
    socketId: string,
    currentAgentName: string
  ): { newAgentName: string; handoffPrompt: string } | null {
    if (!this.config.stateManager?.getCurrentAgent) {
      return null
    }

    const newAgentName = this.config.stateManager.getCurrentAgent(socketId)
    if (!newAgentName || newAgentName === currentAgentName) {
      return null
    }

    // Handoff occurred - get the prompt
    const handoffPrompt = this.config.stateManager.getLastHandoffPrompt?.(socketId)
    if (!handoffPrompt) {
      this.logger.warn('handoff.no_prompt', { newAgentName })
      return null
    }

    // Clear the prompt so it's not reused
    this.config.stateManager.clearLastHandoffPrompt?.(socketId)

    return { newAgentName, handoffPrompt }
  }

  /**
   * File a budget report and emit budget_update to the client.
   * Returns { filed: true, sessionWasFree } if report was created, { filed: false } if skipped.
   */
  private async fileBudgetReport(
    budgetId: string,
    sessionId: string,
    socketId: string,
    steps?: ExecutionStep[],
    source?: 'finally',
    wasUserAborted?: boolean,
  ): Promise<{ filed: false } | { filed: true; sessionWasFree: boolean }> {
    if (!this.config.onBudgetReport) return { filed: false }
    try {
      const effectiveSid = this.stateManager.getEffectiveSocketId(socketId)
      const logData = { socketId: effectiveSid, originalSocketId: socketId, budgetId, sessionId, stepCount: steps?.length ?? 0, ...(source && { source }), ...(wasUserAborted && { wasUserAborted }) }
      const reportResult = await this.config.onBudgetReport(budgetId, sessionId, effectiveSid, socketId, steps, wasUserAborted)
      const socket = this.io.sockets.sockets.get(effectiveSid)
      if (socket?.connected) {
        socket.emit('budget_update', reportResult.refreshRequired ? { refreshRequired: true } : reportResult.payload)
      }
      // sessionWasFree can be true even with refreshRequired (getBudget failed but createReport succeeded)
      const sessionWasFree = reportResult.sessionWasFree ?? false
      const reportId = !reportResult.refreshRequired ? reportResult.reportId : undefined
      this.logger.info('budget.report.created', { ...logData, refreshRequired: reportResult.refreshRequired, sessionWasFree, ...(reportId && { reportId }) })
      return { filed: true, sessionWasFree }
    } catch (err) {
      // Reconstruct context for logging since effectiveSid/logData are inside try
      const effectiveSidForError = this.stateManager.getEffectiveSocketId(socketId)
      this.logger.error('budget.report.failed', {
        socketId: effectiveSidForError,
        budgetId,
        sessionId,
        stepCount: steps?.length ?? 0,
        ...(source && { source }),
        ...(wasUserAborted && { wasUserAborted }),
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
      const socket = this.io.sockets.sockets.get(effectiveSidForError)
      if (socket?.connected) {
        socket.emit('budget_update', { refreshRequired: true })
      }
      return { filed: false }
    }
  }

  /**
   * Complete the conversation after all handoffs
   */
  private async completeConversation(
    socketId: string,
    agentName: string,
    startTime: number,
    processedContext: Record<string, unknown>,
    finishReason?: string,
    budgetSessionWasFree?: boolean,
    budgetServiceEnabled?: boolean
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
          Object.assign(processedContext, preCompletionResult)
          const conv = this.getConversation(socketId)
          if (conv) {
            Object.assign(conv.context as Record<string, unknown>, preCompletionResult)
          }

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
    // Store commit hash and free grants flag if persistence layer provides it via context
    let commitHash: string | null = null
    let usedFreeGrants = false
    const conversation = this.getConversation(socketId)
    if (conversation) {
      await this.config.messagePersistence.completeConversation(
        conversation.conversationId,
        conversation.streamingEvents,
        { agentName, duration, ...(finishReason && { finishReason }) },
        conversation.context
      )

      commitHash =
        (conversation.context as { commitHash?: string | null }).commitHash ??
        (processedContext as { commitHash?: string | null }).commitHash ??
        null

      // Determine if this task was completed for free (publish/domain/fix tasks)
      if (budgetServiceEnabled) {
        // BMS mode: use budget report result (cost attribution determines if GoDaddy covered it)
        usedFreeGrants = budgetSessionWasFree ?? false
      } else {
        // Legacy mode: use assessment agent result from beforeMessageComplete
        usedFreeGrants = conversation.context.usedFreeGrants ?? false
      }

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
      usedFreeGrants, // true if task used free grants (publish/domain/fix task budget)
      messageId: handoffConversation?.context?.agentMessageId,
      ...(finishReason && { finishReason }),
    }, agentName)

    // Call completion handler
    this.config.onMessageComplete?.(socketId, {
      agentName,
      duration,
      usage: undefined,
      toolCalls: [],
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

        this.logger.info('context.load', {
          total: loadedContextMessages.length,
          beforeHistory: beforeHistoryMessages.length,
          afterHistory: afterHistoryMessages.length,
          cachePoints: loadedContextMessages.filter(m => m.cachePoint).length
        })
      } catch (error) {
        this.logger.error('context.load.failure', error)
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
      this.logger.info('history.add', { messageCount: data.conversationHistory.length })
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
    while (messages.length > 0 && messages[0]?.role === 'tool') {
      const removedMessage = messages.shift()
      if (removedMessage) {
        this.logger.warn('history.strip_orphan_tool', {
          toolCallId: (removedMessage as any).tool_call_id,
          reason: 'Tool results must follow assistant tool calls, cannot be first message'
        })
      }
    }

    this.logger.info('message.assembly.complete', {
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
    shouldComplete: boolean = true,
    midStreamRetryCount: number = 0,
    originalUserPrompt?: string
  ): Promise<{ steps: ExecutionStep[] }> {
    let currentStep = 1

    // Keep the original user prompt intact - no modification!
    // On retry/continuation, originalUserPrompt carries the true first-call prompt
    const originalPrompt = originalUserPrompt ?? data.message

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
    if (activeConversation && this.config.messagePersistence.startAgentTurn && midStreamRetryCount === 0) {
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
        this.logger.warn('turn.start.failure', error)
      }
    }

    // Convert screenshot data URLs from context metadata into ProcessedFile objects for vision
    let processedFiles: any[] | undefined
    if (context?.metadata && Array.isArray((context.metadata as any)._screenshots)) {
      processedFiles = dataUrlsToProcessedFiles((context.metadata as any)._screenshots)
      if (processedFiles.length > 0) {
        this.logger.info('vision.attach', { count: processedFiles.length })
      }
    }

    let streamResult

    // Execution steps captured after stream completes (returned for cost attribution)
    let executionSteps: ExecutionStep[] = []

    // Get model information for observability
    let modelName = 'unknown'
    let providerName: ChatLlmProvider = 'anthropic'
    try {
      const agentConfig = agent.getConfig()
      modelName = agentConfig.modelName || agentName || 'unknown'
      providerName = inferProviderFromModelName(modelName)
    } catch (error) {
      this.logger.warn('model.info.failure', { error: error instanceof Error ? error.message : String(error) })
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
        const params: {
          socketId: string; model: string; provider: string
          conversationId?: string; appId?: string; context?: Record<string, unknown>
          input?: Array<{ role: string; content: string }>; tools?: string[]; toolChoice?: 'auto' | 'required' | 'none'
        } = {
          socketId: socket.id,
          model: modelName,
          provider: providerName
        }
        if (conversationId !== undefined) {params.conversationId = conversationId}
        if (appId !== undefined) {params.appId = appId}
        if (context !== undefined) {params.context = context}

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
        this.logger.warn('llm.hook.start.failure', { error: hookError })
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

    // Get abort signal from state manager for stream cancellation.
    // Captured outside try so it's accessible in both try and catch blocks —
    // immune to cleanupConversation removing the state manager entry during async abort.
    const abortSignal = this.stateManager.getAbortController(socket.id)?.signal

    // Captured eagerly after streamGenerate returns so response headers from GoCode
    // are available in error handlers even when the stream body fails mid-flight.
    let capturedResponseHeaders: Record<string, string> | undefined
    let capturedResponseId: string | undefined
    let capturedModelId: string | undefined

    // Propagate OTel trace ID to GoCode via x-trace-id header for cross-service log correlation.
    // Per-call uniqueness is provided separately via x-correlation-id in the fetch wrapper.
    const invocationSpan = trace.getSpan(invocation.context)
    if (invocationSpan && context) {
      const traceId = invocationSpan.spanContext().traceId
      if (traceId) {
        const metadata = (context as ProcessedContext).metadata
        if (metadata) {
          metadata.traceId = traceId
        }
      }
    }

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
          ...(processedFiles && processedFiles.length > 0 && { files: processedFiles }),
          // Pass abort signal for stream cancellation
          ...(abortSignal && { abortSignal }),
        })
      })

      captureResponseMetadata(streamResult.response, (meta) => {
        capturedResponseHeaders = meta.headers
        capturedResponseId = meta.responseId
        capturedModelId = meta.modelId
      })

      // Check if this is a tool validation error with mock stream
      if (streamResult && (streamResult as any).isToolValidationError) {
        // Publish error event - subscribers handle delivery and persistence
        await this.publishToEventChannel(socket.id, 'error', 'Tool call failed due to invalid input format. The agent is retrying with corrections.', {
          errorType: TOOL_VALIDATION_ERROR_TYPE,
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
        this.logger.error('budget.exceeded.pre_stream', {
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
      const streamErrorInfo = this.analyzeStreamError(error)
      const streamErrorClassification = classifyError(error)

      const isToolValidationError =
        error?.message?.includes('toolUse.input is invalid') ||
        error?.message?.includes('JSON parsing failed')

      if (!isToolValidationError) {
        this.logger.warn('stream.generate.error', {
          socketId: socket.id,
          appId,
          agentName,
          model: modelName,
          provider: providerName,
          errorName: error?.name,
          errorMessage: error?.message,
          errorCode: streamErrorInfo.code,
          causeChain: streamErrorInfo.causeChain,
          statusCode: isAPIError ? error.statusCode : error?.statusCode,
          responseBody: isAPIError ? error.responseBody?.slice(0, 500) : error?.responseBody?.slice?.(0, 500),
          isAPIError,
          isNetworkError: streamErrorInfo.isNetworkError,
          isAbortError: streamErrorInfo.isAbortError,
          classification: streamErrorClassification.category,
        })
      }

      if (isToolValidationError) {
        this.logger.error('tool.validation.failure', { message: error.message })

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
          this.logger.error('stream.retry.failure', { message: retryError.message })
          // End invocation span with error before throwing
          invocation.end({ error: retryError, success: false })
          throw retryError
        }
      } else {
        // Enhanced logging for 400 errors to help diagnose issues
        if (isAPIError && error.statusCode === 400) {
          this.logger.warn('llm.api.bad_request', {
            socketId: socket.id,
            agentName,
            statusCode: error.statusCode,
            message: error.message,
            responseBodyLength: error.responseBody?.length,
            category: streamErrorClassification.category,
            retryable: streamErrorClassification.retryable
          });
        }

        if (!streamErrorClassification.retryable) {
          this.logger.warn('stream.error.non_retryable', {
            category: streamErrorClassification.category || 'unknown',
            statusCode: streamErrorClassification.statusCode
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
      const processStreamStartMs = Date.now()
      const streamTiming = await this.processStreamWithToolEvents(
        socket, streamResult, currentStep, agentName, modelName
      )
      const streamProcessingMs = Date.now() - processStreamStartMs

      // Get accumulated content from the active conversation (streamed text before/between tool calls)
      // Refresh reference after streaming - the conversation object may have been updated during streaming
      // Use getConversation to handle socket ID migration during reconnection
      const conversationAfterStream = this.getConversation(socket.id)
      const fullContent = conversationAfterStream?.accumulatedContent || ''

      // Debug log for accumulated content and tool calls
      const toolCallCount = conversationAfterStream?.pendingToolCalls?.size || 0
      if (fullContent.length > 0 || toolCallCount > 0) {
        this.logger.debug('llm.response.accumulated', {
          fullContentLength: fullContent.length,
          toolCallCount,
          toolNames: toolCallCount > 0 ? Array.from(conversationAfterStream!.pendingToolCalls!.values()).map((tc: any) => tc.name) : [],
          hasActiveConversation: !!conversationAfterStream,
          preview: fullContent.substring(0, 100) + (fullContent.length > 100 ? '...' : '')
        })
      }

      const streamAbortSignal =
        this.stateManager.getAbortController(socket.id)?.signal ?? abortSignal
      if (streamAbortSignal?.aborted) {
        this.logger.info('stream.aborted.skip_get_final_result', {
          socketId: socket.id,
          agentName,
          step: currentStep,
        })

        const toolResultsForSpan = conversationAfterStream?.pendingToolCalls
        const hasToolResultsForSpan = toolResultsForSpan && toolResultsForSpan.size > 0

        invocation.end({
          outputText: fullContent,
          responseType: fullContent ? 'llm_reply' : 'tool_call',
          ...(hasToolResultsForSpan && {
            responseData: Array.from(toolResultsForSpan.values()).map(t => ({
              name: t.name,
              status: t.status,
              output: t.result,
            }))
          }),
          success: false,
          finishReason: 'aborted',
        })

        // Return any steps captured before abort for cost attribution
        return { steps: executionSteps }
      }

      // Get final result with usage and tool calls
      const getFinalResultStartMs = Date.now()
      const finalResult = await streamResult.getFinalResult() as AgentExecutionResult
      const getFinalResultMs = Date.now() - getFinalResultStartMs

      const timingSummary = {
        socketId: socket.id,
        agentName,
        modelName,
        appId,
        timeToStreamStartMs: processStreamStartMs - startTime,
        streamProcessingMs,
        getFinalResultMs,
        timeToFirstTextChunkMs: streamTiming.timeToFirstTextChunkMs,
        maxChunkGapMs: streamTiming.maxChunkGapMs,
        chunksRead: streamTiming.chunksRead,
        streamDurationMs: streamTiming.streamDurationMs,
      }
      // info (not debug) for production observability
      this.logger.info('stream.timing.summary', timingSummary)
      this.emitDiagnostic(
        socket,
        'stream.timing.summary',
        timingSummary,
        { socketId: socket.id, appId, agentName, modelName }
      )

      // Capture execution steps for cost attribution (returned to caller for accumulation)
      executionSteps = finalResult.steps ?? []
      if (executionSteps.length > 0) {
        this.logger.info('steps.captured', {
          socketId: socket.id,
          stepCount: executionSteps.length,
          conversationId: conversationAfterStream?.conversationId,
        })
      }

      // Log token and cache usage information
      // Use totalUsage for accurate multi-step token tracking (sums all steps)
      const usageToTrack = finalResult.totalUsage || finalResult.usage
      const usage = usageToTrack ? buildTokenUsage(usageToTrack) : undefined
      let costEstimateTotalCost: number | undefined
      if (usage) {
        // Get model name from agent configuration
        let modelName = 'unknown'
        try {
          const agentConfig = agent.getConfig()
          modelName = agentConfig.modelName || agentName || 'unknown'
        } catch (error) {
          this.logger.warn('model.name.failure', {
            socketId: socket.id,
            agentName,
            error: error instanceof Error
              ? error.message
              : String(error),
          })
          modelName = agentName || 'unknown'
        }

        this.logger.info('token.usage', {
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
          this.logger.info('token.cache', cacheDetails)
        } else {
          this.logger.info('token.cache.none')
        }

        // Calculate and log cost estimate using accurate model pricing
        const costEstimate = calculateCostEstimate(usage, modelName)
        costEstimateTotalCost = costEstimate.totalCost
        const costLines = formatCostEstimate(costEstimate, usage)
        this.logger.info('token.cost', { details: costLines.join('; ') })

        const payload: TokenUsageSummaryEvent = {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          ...(usage.cachedInputTokensRead !== undefined
            && { cachedInputTokensRead:
              usage.cachedInputTokensRead }),
          ...(usage.cachedInputTokensWrite !== undefined
            && { cachedInputTokensWrite:
              usage.cachedInputTokensWrite }),
          modelName,
          totalCost: costEstimate.totalCost,
          inputCost: costEstimate.inputCost,
          outputCost: costEstimate.outputCost,
          ...(costEstimate.cachedInputCost !== undefined
            && { cachedInputCost:
              costEstimate.cachedInputCost }),
          savings: costEstimate.savings,
          currency: costEstimate.currency,
        }
        this.emitDiagnostic(
          socket,
          TOKEN_USAGE_SUMMARY_EVENT,
          payload,
          { socketId: socket.id, appId, agentName, modelName }
        )

        // Call onTokenUsage callback with accurate multi-step usage
        if (this.config.onTokenUsage) {
          try {
            const processedContext = context as ProcessedContext
            const contextAppId = processedContext?.appId || (processedContext?.metadata as MetadataRecord)?.appId
            const contextSubscriptionId = (processedContext?.metadata as MetadataRecord)?.subscriptionId
            const contextCustomerId = (processedContext?.metadata as MetadataRecord)?.customerId as string | undefined
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
                ...(contextSubscriptionId ? { subscriptionId: contextSubscriptionId } : {}),
                ...(contextCustomerId ? { customerId: contextCustomerId } : {})
              }
            )
          } catch (error) {
            this.logger.error('token.usage.callback_error', { error })
          }
        }
      }

      // Capture onLlmEnd ref before async gap (avoids TS2304 with `typeof this` after await)
      const onLlmEnd = this.config.onLlmEnd

      // Ensure response headers are available before onLlmEnd (may not have resolved from .then())
      if (streamResult && !capturedResponseHeaders) {
        const meta = await this.extractResponseMetadata(streamResult)
        capturedResponseHeaders ??= meta.headers
        capturedResponseId ??= meta.responseId
        capturedModelId ??= meta.modelId
      }

      // Call LLM end hook for observability
      if (onLlmEnd) {
        try {
          // Build params object, only including defined values
          const llmEndParams: Parameters<NonNullable<typeof onLlmEnd>>[0] = {
            socketId: socket.id,
            startTime: llmSpanInfo?.startTime || llmStartTime,
            model: modelName,
            provider: providerName,
            success: true
          }
          if (llmSpanInfo?.spanId !== undefined) {llmEndParams.spanId = llmSpanInfo.spanId}
          if (conversationId !== undefined) {llmEndParams.conversationId = conversationId}
          if (appId !== undefined) {llmEndParams.appId = appId}
          if (context !== undefined) {llmEndParams.context = context}
          if (finalResult.finishReason !== undefined) {llmEndParams.finishReason = finalResult.finishReason}
          if (usage) {
            const usageObj: NonNullable<typeof llmEndParams.usage> = {}
            if (usage.inputTokens !== undefined) {usageObj.inputTokens = usage.inputTokens}
            if (usage.outputTokens !== undefined) {usageObj.outputTokens = usage.outputTokens}
            if (usage.totalTokens !== undefined) {usageObj.totalTokens = usage.totalTokens}
            if (usage.cachedInputTokensRead !== undefined) {usageObj.cachedTokens = usage.cachedInputTokensRead}
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

          const correlationId = capturedResponseHeaders?.['x-correlation-id']
          if (correlationId) {
            llmEndParams.correlationId = correlationId
          }

          await onLlmEnd(llmEndParams)
        } catch (hookError) {
          this.logger.warn('llm.hook.end.failure', { error: hookError })
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
      // Check abort signal directly — avoids false positives from analyzeStreamError's
      // broad substring matching (e.g., "Transaction aborted" would misclassify).
      // Uses the signal captured at the top of the try block — immune to
      // cleanupConversation removing the state manager entry during async abort.
      if (abortSignal?.aborted) {
        invocation.end({ error: postStreamError instanceof Error ? postStreamError : String(postStreamError), success: false })
        this.logger.info('stream.aborted', {
          socketId: socket.id,
          agentName,
          step: currentStep,
        })

        // Don't publish complete:aborted here — the handoff loop abort check
        // in handleChatMessageInternal always publishes it after streamAgentResponse
        // returns (covering both throw and clean-return paths). Publishing here
        // would create a duplicate with inconsistent totalSteps.
        // Return any steps captured before abort for cost attribution
        return { steps: executionSteps }
      }

      // Mid-stream budget exceeded during stream processing: attempt grant advancement and retry
      if (BudgetExceededError.isInstance(postStreamError) && this.config.onBudgetExhaustedMidStream && midStreamRetryCount < 3) {
        const conv = this.getConversation(socket.id)
        const executedToolNames = conv?.pendingToolCalls
          ? Array.from(conv.pendingToolCalls.values())
              .filter((tc: any) => (tc.status === 'completed' || tc.status === 'running') && typeof tc.name === 'string')
              .map((tc: any) => tc.name as string)
          : []

        this.logger.info('budget.mid_stream.attempting_recovery', {
          socketId: socket.id,
          agentName,
          executedToolNames,
          executedToolCount: executedToolNames.length,
        })

        const MID_STREAM_CALLBACK_TIMEOUT_MS = 10_000
        const callbackPromise = this.config.onBudgetExhaustedMidStream(socket.id, postStreamError, executedToolNames)
        let timeoutHandle: ReturnType<typeof setTimeout>
        let timedOut = false
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => { timedOut = true; reject(new Error('onBudgetExhaustedMidStream timed out')) }, MID_STREAM_CALLBACK_TIMEOUT_MS)
        })
        let result: { retry: boolean; newUserId?: string; hasNonIdempotentTools: boolean }
        try {
          result = await Promise.race([callbackPromise, timeoutPromise])
          clearTimeout(timeoutHandle!)
        } catch (callbackErr) {
          clearTimeout(timeoutHandle!)
          this.logger.error(timedOut ? 'budget.mid_stream.callback_timeout' : 'budget.mid_stream.callback_error', {
            socketId: socket.id,
            agentName,
            ...(timedOut ? { timeoutMs: MID_STREAM_CALLBACK_TIMEOUT_MS } : { error: callbackErr instanceof Error ? callbackErr.message : String(callbackErr) }),
          })
          invocation.end({ error: postStreamError, success: false })
          throw postStreamError
        }
        if (result.retry && result.newUserId) {
          this.logger.info('budget.mid_stream.recovery_granted', {
            socketId: socket.id,
            agentName,
            newUserId: result.newUserId,
            hasNonIdempotentTools: result.hasNonIdempotentTools,
          })

          const metadata = context && typeof (context as any).metadata === 'object' ? (context as any).metadata : null
          if (!metadata) {
            this.logger.error('budget.mid_stream.context_missing_metadata', {
              socketId: socket.id,
              agentName,
              hasContext: !!context,
            })
            invocation.end({ error: postStreamError, success: false })
            throw postStreamError
          }
          metadata.user = result.newUserId

          if (!result.hasNonIdempotentTools) {
            // Layer 2: Clean retry (no non-idempotent tools ran)
            await this.publishToEventChannel(socket.id, 'stream_retry', '', {
              reason: 'budget_exceeded_grant_advanced',
              agentName,
            }, agentName)

            if (conv) {
              conv.accumulatedContent = ''
              conv.pendingToolCalls?.clear()
              conv.streamingEvents = []
              conv.pendingSegments = []
            }

            invocation.end({ error: postStreamError, success: false, finishReason: 'budget_retry' })

            try {
              return await this.streamAgentResponse(socket, agent, data, context, agentName, startTime, shouldComplete, midStreamRetryCount + 1, originalPrompt)
            } catch (retryError) {
              this.logger.error('budget.mid_stream.retry_failed', { socketId: socket.id, agentName, midStreamRetryCount, error: retryError instanceof Error ? retryError.message : String(retryError) })
              throw retryError
            }
          } else {
            // Layer 3: Continuation (non-idempotent tools ran)
            const partialContent = conv?.accumulatedContent || ''
            const toolHistory = executedToolNames.length > 0
              ? `The following tool calls already completed successfully: ${executedToolNames.join(', ')}. Do not re-execute them.`
              : ''
            const continuationContext = [
              `The user's original request: "${originalPrompt}"`,
              toolHistory,
              partialContent ? `You were in the middle of responding. Your partial response so far: "${partialContent.slice(-500)}"` : '',
              'Continue the task from where you left off.',
            ].filter(Boolean).join('\n\n')

            if (conv) {
              conv.pendingToolCalls?.clear()
              conv.streamingEvents = []
              conv.pendingSegments = []
            }

            invocation.end({ error: postStreamError, success: false, finishReason: 'budget_continuation' })

            const continuationData: ChatMessage = { ...data, message: continuationContext }
            try {
              return await this.streamAgentResponse(socket, agent, continuationData, context, agentName, startTime, shouldComplete, midStreamRetryCount + 1, originalPrompt)
            } catch (retryError) {
              this.logger.error('budget.mid_stream.continuation_failed', { socketId: socket.id, agentName, midStreamRetryCount, error: retryError instanceof Error ? retryError.message : String(retryError) })
              throw retryError
            }
          }
        }

        if (result?.retry && !result.newUserId) {
          this.logger.error('budget.mid_stream.retry_true_no_userid', {
            socketId: socket.id,
            agentName,
          })
        }

        this.logger.warn('budget.mid_stream.recovery_failed', {
          socketId: socket.id,
          agentName,
          reason: result?.retry && !result.newUserId ? 'contract_violation_no_userid' : 'grants_exhausted',
        })
      } else if (BudgetExceededError.isInstance(postStreamError) && this.config.onBudgetExhaustedMidStream && midStreamRetryCount >= 3) {
        this.logger.warn('budget.mid_stream.retry_cap_reached', {
          socketId: socket.id,
          agentName,
          midStreamRetryCount,
        })
      }

      invocation.end({ error: postStreamError instanceof Error ? postStreamError : String(postStreamError), success: false })

      const postErrorInfo = this.analyzeStreamError(postStreamError)
      this.logger.error('stream.post_stream.error', {
        socketId: socket.id,
        appId,
        agentName,
        model: modelName,
        provider: providerName,
        errorType: postErrorInfo.type,
        errorMessage: postErrorInfo.message,
        errorCode: postErrorInfo.code,
        causeChain: postErrorInfo.causeChain,
        statusCode: postErrorInfo.statusCode,
        responseBody: postErrorInfo.responseBody,
        isNetworkError: postErrorInfo.isNetworkError,
        step: currentStep,
        responseHeaders: capturedResponseHeaders,
        responseId: capturedResponseId,
        responseModelId: capturedModelId,
      })

      throw postStreamError
    }

    // Note: Conversation completion is now handled by completeConversation()
    // This allows multiple agents to contribute to the same conversation during handoffs

    // Return execution steps for cost attribution accumulation
    return { steps: executionSteps }
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
