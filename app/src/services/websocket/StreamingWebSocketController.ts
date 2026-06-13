/**
 * StreamingWebSocketController
 *
 * Headless controller for WebSocket streaming logic.
 * Extracted from useStreamingWebSocket to improve testability and enable reuse outside React.
 *
 * Responsibilities:
 * - Coordinate TransportSupervisor and XState machine
 * - Message building and sending
 * - State machine integration via StoreSyncAdapter
 * - Event emission for UI integration (no direct store writes)
 */

import { EventEmitter } from 'events'
import type { Socket } from 'socket.io-client'
import type { Actor } from 'xstate'
import { createActor } from 'xstate'
import { DEFAULT_MESSAGE_ORIGIN, type MessageOrigin } from '@airo/shared/auth'
import type { BudgetUpdatePayload } from '@airo/shared/budget'
import type { AgentsAppChatMessage } from '@airo/shared/websocket'

import type { AssetManagerItem } from '@/app/[market]/develop/components/chat/AssetTypes'
import type { VisualContext } from '@/app/[market]/develop/components/visualContextCapture'
import { dynamicApiConfigService } from '@/config/dynamic-api'
import type {
  MessageHandlerActions,
  MessageHandlerHelpers,
  RecoveryAck,
  ServerConfig,
  WebSocketStateUpdate,
} from '@/hooks/websocket/handlers/types'
import {
  clearConversationIdCookie,
  getConversationIdFromCookie,
} from '@/hooks/websocket/useWebSocketHelpers'
import { JourneyTracker } from '@/lib/journeyTracker'
import { logger } from '@/lib/request-context'
import { toWebSocketError, WebSocketError, WebSocketErrorCode } from '@/lib/websocket-errors'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import {
  type AIEditContext,
  type BuildError,
  type BuildMessageParams,
  ChatMessageBuilder,
  type CustomContext,
  type TodoContext,
} from './ChatMessageBuilder'
import { ConnectionManager } from './ConnectionManager'
import { NetworkQualityMonitor } from './NetworkQualityMonitor'
import { StoreSyncAdapter } from './StoreSyncAdapter'
import { TransportSupervisor } from './TransportSupervisor'
import { type WebSocketMachine, webSocketMachine } from './webSocketMachine'

export interface StreamingWebSocketControllerEvents {
  'connection:established': { socket: Socket; recovered: boolean }
  'connection:failed': { error: Error }
  'connection:error': { error: Error }
  'grant:refresh-requested': void
  'budget:update': BudgetUpdatePayload
  'disconnect': { reason: Socket.DisconnectReason }
  'reconnect:attempt': void
  'reconnect:success': void
  'reconnect:error': { error: Error }
  'reconnect:failed': void
  'message:sent': { message: AgentsAppChatMessage }
  'message:error': { error: Error }
  // Application-level state events (for adapter to consume)
  'stream:error': { error: Error; shouldFinalize: boolean }
  'transport:retry-started': { socketId: string }
  'transport:retry-cleared': void
  'transport:escalation-timeout': { socketId: string }
}

export interface StreamingWebSocketControllerDeps {
  connectionManager: ConnectionManager
  messageBuilder: ChatMessageBuilder
  getActions: () => MessageHandlerActions
  getHelpers: () => Omit<MessageHandlerHelpers, 'maybeSendRecoveryAck' | 'trackReplayEventReceipt' | 'clearRetryState'>
  t?: (id: string, values?: Record<string, any>) => string
  toolDeltaBufferRef: { current: Map<string, { name: string; delta: string; hasExplicitName: boolean }> }
  getStoreState: () => {
    streamingState: string
    activeStream: unknown
    buildErrorContext: BuildError | null
    // Lifecycle actions - called by adapter via events
    setWebSocketState: (state: WebSocketStateUpdate) => void
    setStreamingState: (state: string) => void
    setIsLoading: (loading: boolean) => void
    markUpstreamError: (error: { message: string; type?: string }) => void
    finalizeStream: () => void
    startStream: (conversationId: string, messageId: string) => void
    setError: (error: Error) => void
    setRecoveryState: (state: { isRecovering: boolean; expectedEvents: number; receivedEvents: number }) => void
    setRetryState: (state: { isRetrying: boolean; retryCount: number; nextRetryMs?: number; exhausted?: boolean }) => void
  }
}

export class StreamingWebSocketController extends EventEmitter {
  private static readonly DEFAULT_ACK_TIMEOUT_MS = 30_000
  private static readonly MIN_REPLAY_DEDUP_TIMEOUT_MS = 60_000
  private static readonly REPLAY_DEDUP_TIMEOUT_MULTIPLIER = 2

  private currentAppId: string | null = null

  // XState machine and adapter
  private machine: Actor<WebSocketMachine>
  private adapter: StoreSyncAdapter
  private supervisor: TransportSupervisor
  private qualityMonitor: NetworkQualityMonitor

  // Refs for handler-specific state management
  // Note: These refs manage implementation-specific state (recovery ACK protocol, APP_NOT_FOUND retry, server config)
  // that is too granular for the state machine. Machine handles high-level lifecycle state.
  private serverConfigRef: { current: ServerConfig | null } = { current: null }
  private pendingRecoveryAckRef: { current: RecoveryAck | null } = { current: null }
  private retryStateRef: { current: { pendingMessage?: { chatMessage: AgentsAppChatMessage; startTime: number }; retryCount: number; retryTimer?: NodeJS.Timeout } } = { current: { retryCount: 0 } }

  // Event deduplication for recovery replay
  // Track seen event IDs during recovery replay to prevent duplicate processing
  private seenEventIds: Set<string> | null = null
  private isReplaying: boolean = false
  private replayDedupCleanupTimer: NodeJS.Timeout | null = null

  // History batch refs for incremental history loading
  private historyBatchRef: { current: any[] } = { current: [] }
  private historyBatchTimerRef: { current: NodeJS.Timeout | null } = { current: null }
  private historyReceivedForRecoveryRef: { current: boolean } = { current: false }

  // Session-level origin for care agent message styling
  private sessionOrigin: MessageOrigin = DEFAULT_MESSAGE_ORIGIN

  constructor(private deps: StreamingWebSocketControllerDeps) {
    super()

    // Initialize XState machine
    this.machine = createActor(webSocketMachine)
    this.machine.start()

    // Initialize network quality monitor
    this.qualityMonitor = new NetworkQualityMonitor()

    // Initialize adapter to sync machine → store
    // Pass full store state for adapter to access application-level actions
    this.adapter = new StoreSyncAdapter(this.machine, this, this.deps.getStoreState, this.qualityMonitor)

    // Initialize supervisor for connection lifecycle
    this.supervisor = new TransportSupervisor({
      connectionManager: this.deps.connectionManager,
      machine: this.machine,
      getActions: this.deps.getActions,
      getHelpers: this.deps.getHelpers,
      t: this.deps.t,
      qualityMonitor: this.qualityMonitor,
      refs: {
        serverConfig: this.serverConfigRef,
        pendingRecoveryAck: this.pendingRecoveryAckRef,
        toolDeltaBuffer: this.deps.toolDeltaBufferRef,
        retryState: this.retryStateRef,
        controller: this, // Pass controller reference for deduplication
        historyBatch: this.historyBatchRef,
        historyBatchTimer: this.historyBatchTimerRef,
        historyReceivedForRecovery: this.historyReceivedForRecoveryRef,
      },
      getStreamingState: () => {
        const store = this.deps.getStoreState()
        return {
          streamingState: store.streamingState,
          activeStream: store.activeStream,
        }
      },
      // Provide dynamic app ID getter for message validation
      getCurrentAppId: () => this.currentAppId,
    })

    // Forward supervisor events to controller events (for adapter consumption)
    this.supervisor.on('connection:established', (data) => {
      this.emit('connection:established', data)
    })
    this.supervisor.on('connection:failed', (data) => {
      this.emit('connection:failed', data)
    })
    this.supervisor.on('connection:error', (data) => {
      this.emit('connection:error', data)
    })
    this.supervisor.on('disconnect', (data) => {
      this.emit('disconnect', { reason: data.reason })
    })
    this.supervisor.on('reconnect:attempt', () => {
      this.emit('reconnect:attempt')
    })
    this.supervisor.on('reconnect:success', () => {
      this.emit('reconnect:success')
    })
    this.supervisor.on('reconnect:error', (data) => {
      this.emit('reconnect:error', data)
    })
    this.supervisor.on('reconnect:failed', () => {
      this.emit('reconnect:failed')
    })

    // Forward transport-level events for adapter to consume
    this.supervisor.on('transport:retry-started', (data) => {
      this.emit('transport:retry-started', data)
    })
    this.supervisor.on('transport:retry-cleared', () => {
      this.emit('transport:retry-cleared')
    })
    this.supervisor.on('transport:escalation-timeout', (data) => {
      this.emit('transport:escalation-timeout', data)
    })

    // Forward grant context events
    this.supervisor.on('grant:refresh-requested', () => {
      this.emit('grant:refresh-requested')
    })

    // Forward budget update events
    this.supervisor.on('budget:update', (data) => {
      this.emit('budget:update', data)
    })

  }

  /**
   * Connect to WebSocket for the given appId
   */
  async connect(appId: string): Promise<void> {
    if (this.transportConnectedForApp(appId)) {
      this.currentAppId = appId
      return
    }

    this.currentAppId = appId

    // Record connect start for quality monitoring (pass appId so slow_connect warnings include it)
    this.qualityMonitor.markConnectStart(appId)

    // Send CONNECT event to machine
    this.machine.send({ type: 'CONNECT', appId })

    // Delegate to supervisor
    await this.supervisor.connect(appId)
  }

  private transportConnectedForApp(appId: string): boolean {
    const snapshot = this.machine.getSnapshot()
    if (snapshot.context.appId !== appId) {
      return false
    }
    // Parent match for transport.connected (any substate); see webSocketMachine.test.ts (XState v5.30).
    if (!snapshot.matches({ transport: 'connected' })) {
      return false
    }
    return Boolean(this.supervisor.getSocket()?.connected)
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    // Clear any active replay state on disconnect to prevent memory leaks
    if (this.isReplaying) {
      logger.warn('websocket.controller.replay_interrupted', {
        message: 'Replay interrupted by disconnect',
        trackedEventCount: this.seenEventIds?.size ?? 0
      })
      this.clearReplayDeduplication()
    }

    // Tell the machine we're disconnecting so it transitions to disconnected state
    // This allows subsequent CONNECT events to be handled
    this.machine.send({ type: 'DISCONNECT', reason: 'app_switch' })

    this.supervisor.disconnect()
    this.supervisor.clearRetryState()
  }

  /**
   * Reconnect to the WebSocket with a fresh agent URL and clean history state.
   *
   * Use after cold-archive restore: the pre-archive agent_url is stale, and the
   * store's historyLoadingComplete flag would prevent history from loading again.
   * This clears both so the next connect fetches the new URL and re-requests history.
   *
   * Whether history actually reloads depends on the conversationId cookie being present
   * at connect time — the server uses handshake.auth.conversationId to enter 'initial'
   * recovery mode and replay history. If the cookie is missing, the server treats this
   * as a fresh connection and sends no history.
   */
  async reconnect(): Promise<void> {
    if (!this.currentAppId) return

    const appId = this.currentAppId

    dynamicApiConfigService.clearCache(appId)

    const store = useStreamingConversationStore.getState()
    store.clearMessages()
    store.setHistoryLoadingComplete(false)
    store.setHistoryLoadRequested(false)

    this.disconnect()
    await this.connect(appId)
  }

  /**
   * Cleanup - disconnect resources, then stop machine
   *
   * Order is critical to prevent race conditions:
   * 1. disconnect() - Stops WebSocket and removes event listeners (prevents new events)
   * 2. adapter.destroy() - Unsubscribes from machine (cleanup subscriptions)
   * 3. machine.stop() - Stops state machine (safe, no more events can arrive)
   *
   * Previous order (adapter → machine → disconnect) caused race conditions where
   * async connection events (CONNECT, CONNECTION_ESTABLISHED) would arrive after
   * machine was stopped, causing XState warnings and resource leaks.
   */
  destroy(): void {
    // 1. Disconnect transport first - stops event sources
    this.disconnect()

    // 2. Clean up quality monitor
    this.qualityMonitor.destroy()

    // 3. Clean up adapter subscriptions
    this.adapter.destroy()

    // 4. Stop machine last - safe because no more events can arrive
    this.machine.stop()
  }

  // ===== Event Deduplication Methods =====

  /**
   * Check if currently in replay mode
   */
  isInReplayMode(): boolean {
    return this.isReplaying
  }

  /**
   * Initialize deduplication tracking when recovery replay starts
   */
  startReplayDeduplication(): void {
    if (this.seenEventIds !== null) {
      logger.warn('websocket.controller.replay_dedup_already_active', {
        message: 'Replay deduplication already active, clearing previous state',
        previousEventCount: this.seenEventIds.size
      })
      this.clearReplayDeduplication()
    }
    this.seenEventIds = new Set<string>()
    this.isReplaying = true
    logger.debug('websocket.controller.replay_dedup_started', {
      message: 'Started event deduplication tracking for recovery replay'
    })
    this.scheduleReplayDeduplicationCleanup()
  }

  /**
   * Clear deduplication tracking after replay completes
   */
  clearReplayDeduplication(): void {
    const count = this.seenEventIds?.size ?? 0
    this.seenEventIds = null
    this.isReplaying = false
    this.clearReplayDeduplicationTimeout()
    logger.debug('websocket.controller.replay_dedup_cleared', {
      message: 'Cleared event deduplication tracking',
      trackedEventCount: count
    })
  }

  private scheduleReplayDeduplicationCleanup(): void {
    this.clearReplayDeduplicationTimeout()
    const ackTimeout = this.serverConfigRef.current?.ackTimeout ?? StreamingWebSocketController.DEFAULT_ACK_TIMEOUT_MS
    const timeoutMs = Math.max(
      ackTimeout * StreamingWebSocketController.REPLAY_DEDUP_TIMEOUT_MULTIPLIER,
      StreamingWebSocketController.MIN_REPLAY_DEDUP_TIMEOUT_MS
    )

    this.replayDedupCleanupTimer = setTimeout(() => {
      logger.warn('websocket.controller.replay_dedup_timeout', {
        message: 'Replay deduplication timeout elapsed, forcing cleanup',
        timeoutMs,
        trackedEventCount: this.seenEventIds?.size ?? 0
      })
      this.clearReplayDeduplication()
    }, timeoutMs)
  }

  private clearReplayDeduplicationTimeout(): void {
    if (this.replayDedupCleanupTimer) {
      clearTimeout(this.replayDedupCleanupTimer)
      this.replayDedupCleanupTimer = null
    }
  }

  /**
   * Check if event has been seen during replay
   */
  hasSeenEvent(eventKey: string | undefined): boolean {
    if (!eventKey || !this.seenEventIds) {
      return false
    }
    return this.seenEventIds.has(eventKey)
  }

  /**
   * Mark event as seen during replay
   */
  markEventSeen(eventKey: string | undefined): void {
    if (eventKey && this.seenEventIds) {
      this.seenEventIds.add(eventKey)
    }
  }

  /**
   * Request the server to stop the current generation.
   *
   * Resolves once the server acks `stop_generation` — by which point the
   * server's AbortController has already fired (the handler aborts
   * synchronously before acking). Callers that need to perform a follow-up
   * operation against a quiescent agent (e.g. the chat Undo button rolling
   * back the working tree) MUST await this promise; fire-and-forget callers
   * can ignore the return value.
   *
   * Resolves immediately when the socket isn't connected (nothing to stop).
   */
  stopGeneration(): Promise<void> {
    const socket = this.supervisor.getSocket()
    if (!socket?.connected) return Promise.resolve()

    return new Promise<void>((resolve) => {
      socket.emit('stop_generation', {}, (response: { success?: boolean; error?: string }) => {
        if (response?.error) {
          logger.warn('websocket.stop.failed', { error: response.error })
        }
        resolve()
      })
    })
  }

  /**
   * Ask the server to cancel an in-flight background logo generation and revert
   * any placeholder slots. Resolves cancelled:false when there's no socket.
   */
  cancelLogoGeneration(jobId?: string): Promise<{ cancelled: boolean }> {
    const socket = this.supervisor.getSocket()
    if (!socket?.connected) return Promise.resolve({ cancelled: false })

    return new Promise((resolve) => {
      socket.emit(
        'cancel_logo_generation',
        jobId ? { jobId } : {},
        (response: { success?: boolean; cancelled?: boolean; error?: string }) => {
          if (response?.error) logger.warn('websocket.cancel_logo.failed', { error: response.error })
          resolve({ cancelled: !!response?.cancelled })
        },
      )
    })
  }

  /**
   * Send a message through the WebSocket
   */
  async sendMessage(params: {
    content: string
    visualContext?: VisualContext | null
    aiEditContext?: AIEditContext
    aiEditContexts?: AIEditContext[]
    selectedAssets?: AssetManagerItem[]
    todoListContext?: TodoContext
    isActionRequest?: boolean
    askQuestionSkipped?: boolean
    customContext?: CustomContext
    rebuildBuildPageSlug?: string
    rebuildDesignDirection?: string
    templateId?: string
    modelOverride?: string
    uploadedFileName?: string
    market?: string
    fullStorySessionId?: string
  }): Promise<void> {
    const { content } = params

    const hasText = Boolean(content.trim())
    const hasReferencedFiles = (params.customContext?.referencedFiles?.length ?? 0) > 0
    const hasSelectedAssets = (params.selectedAssets?.length ?? 0) > 0
    if ((!hasText && !hasReferencedFiles && !hasSelectedAssets) || !this.currentAppId) {
      return
    }

    try {
      const socket = this.supervisor.getSocket()

      if (!socket) {
        throw new WebSocketError(WebSocketErrorCode.SOCKET_NOT_INITIALIZED, {
          context: {
            appId: this.currentAppId,
            socketState: 'disconnected'
          }
        })
      }

      if (!socket.connected) {
        throw new WebSocketError(WebSocketErrorCode.CONNECTION_LOST, {
          context: {
            appId: this.currentAppId,
            socketId: socket.id,
            socketState: 'disconnected'
          }
        })
      }

      // Prevent sending messages during the authentication window
      const snapshot = this.machine.getSnapshot()
      if (!snapshot.matches({ transport: 'connected' })) {
        throw new WebSocketError(WebSocketErrorCode.INVALID_STATE, {
          message: 'WebSocket not authenticated. Please wait for authentication to complete.',
          context: {
            appId: this.currentAppId,
            socketId: socket.id,
            machineState: JSON.stringify(snapshot.value)
          }
        })
      }

      // Create user message in store (Tier 2 - transcript data)
      // Extract referencedFiles from customContext if present
      const referencedFiles = params.customContext?.referencedFiles as Array<{ path: string; content: string }> | undefined
      const userMessageMetadata =
        params.askQuestionSkipped === true
          ? { askQuestionSkipped: true }
          : params.isActionRequest === true
            ? { isActionRequest: true }
            : undefined
      this.deps.getActions().startNewStream(
        content,
        params.selectedAssets,
        referencedFiles,
        this.sessionOrigin,
        params.uploadedFileName,
        userMessageMetadata,
      )

      const store = this.deps.getStoreState()
      const { buildErrorContext } = store

      // Check for conversationId in cookie (used for page reload recovery)
      const conversationId = getConversationIdFromCookie(this.currentAppId)
      if (conversationId) {
        clearConversationIdCookie(this.currentAppId)
      }
      // If no conversationId found, server will create a new conversation

      const messageParams: BuildMessageParams<AssetManagerItem> = {
        content,
        appId: this.currentAppId,
        sessionId: socket.id,
        conversationId,
        visualContext: params.visualContext,
        aiEditContext: params.aiEditContext,
        aiEditContexts: params.aiEditContexts,
        selectedAssets: params.selectedAssets,
        todoListContext: params.todoListContext,
        buildErrorContext,
        isActionRequest: params.isActionRequest,
        customContext: params.customContext,
        rebuildBuildPageSlug: params.rebuildBuildPageSlug,
        rebuildDesignDirection: params.rebuildDesignDirection,
        templateId: params.templateId,
        modelOverride: params.modelOverride,
        market: params.market,
        fullStorySessionId: params.fullStorySessionId,
      }

      const chatMessage = this.deps.messageBuilder.build(messageParams)

      if (this.retryStateRef.current.retryTimer) {
        clearTimeout(this.retryStateRef.current.retryTimer)
      }

      this.retryStateRef.current = {
        pendingMessage: { chatMessage, startTime: Date.now() },
        retryCount: 0,
      }

      // Send SEND_MESSAGE event to machine (Tier 1 - lifecycle)
      // Machine will transition to streaming state, adapter will update UI
      // Note: conversationId may be undefined for new conversations - server will create one
      this.machine.send({
        type: 'SEND_MESSAGE',
        message: chatMessage,
        conversationId: conversationId ?? ''
      })

      // Diagnostic logging before emit
      logger.info('websocket.message.emitting', {
        socketId: socket.id,
        connected: socket.connected,
        conversationId: conversationId ?? 'new',
        messageLength: content.length
      })

      const sentAt = this.qualityMonitor.markMessageSent()

      socket.emit('chat_message', chatMessage, (response: any) => {
        this.qualityMonitor.markMessageAcked(sentAt, socket.id)
        logger.info('websocket.message.ack_received', {
          socketId: socket.id,
          hasError: !!response?.error,
          error: response?.error
        })
        if (response?.error) {
          logger.error('websocket.message.ack_error', { appId: this.currentAppId, error: response.error })
        }
      })

      JourneyTracker.current()?.trackPromptStarted(crypto.randomUUID(), content)

      this.emit('message:sent', { message: chatMessage })
    } catch (error) {
      // Convert to WebSocketError and enrich with call-site context
      // toWebSocketError merges context for existing WebSocketError instances
      const wsError = toWebSocketError(error, WebSocketErrorCode.MESSAGE_SEND_FAILED, {
        appId: this.currentAppId,
        socketId: this.supervisor.getSocket()?.id,
        messageLength: content.length
      })

      logger.error('websocket.message.failure', wsError.toLogObject())

      // Send STREAM_ERROR event to machine
      this.machine.send({
        type: 'STREAM_ERROR',
        error: wsError,
        retryable: wsError.retryable
      })

      // Emit stream:error so adapter can update store (markUpstreamError + finalizeStream)
      // Always finalize MESSAGE_SEND_FAILED - these are pre-send failures after startNewStream()
      // For other streaming errors, only finalize if non-retryable
      const shouldFinalize = wsError.code === WebSocketErrorCode.MESSAGE_SEND_FAILED || !wsError.retryable
      this.emit('stream:error', { error: wsError, shouldFinalize })

      this.emit('message:error', { error: wsError })
    }
  }

  /**
   * Flush tool delta buffer immediately
   */
  flushToolDeltaBufferImmediate(): void {
    this.deps.getActions().flushToolDeltaBufferImmediate()
  }

  /**
   * Schedule tool delta flush
   */
  scheduleToolDeltaFlush(): void {
    this.deps.getActions().scheduleToolDeltaFlush()
  }

  /**
   * Emit grant context to the agent
   * Returns true if sent successfully, false if not connected
   */
  emitGrantContext(payload: { grants: unknown[]; timestamp: number }): boolean {
    return this.supervisor.emitGrantContext(payload)
  }

  /**
   * Register callback for grant refresh requests from agent
   * Returns cleanup function to unregister the listener
   */
  onGrantRefreshRequested(callback: () => void): () => void {
    this.on('grant:refresh-requested', callback)
    return () => {
      this.off('grant:refresh-requested', callback)
    }
  }

  /**
   * Register callback for budget update events from agent
   * Returns cleanup function to unregister the listener
   */
  onBudgetUpdate(callback: (data: BudgetUpdatePayload) => void): () => void {
    this.on('budget:update', callback)
    return () => {
      this.off('budget:update', callback)
    }
  }

  /**
   * Set the session-level message origin (support vs customer)
   * Called once at connection time based on auth type
   */
  setSessionOrigin(origin: MessageOrigin): void {
    this.sessionOrigin = origin
  }

  /**
   * Emits load_history WebSocket event.
   * Without cursor: initial load (history_message* → history_loaded).
   * With cursor: pagination (history_message* → history_complete).
   * Returns true if sent successfully, false if not connected or no conversationId.
   */
  loadHistory(params: { cursor?: string; limit?: number } = {}): boolean {
    const socket = this.supervisor.getSocket()
    if (!socket?.connected || !this.currentAppId) {
      return false
    }

    const conversationId = getConversationIdFromCookie(this.currentAppId)
    if (!conversationId) {
      logger.warn('websocket.load_history.no_conversation', {
        appId: this.currentAppId
      })
      return false
    }

    logger.debug('websocket.load_history', {
      appId: this.currentAppId,
      conversationId,
      cursor: params.cursor,
      limit: params.limit ?? 20
    })

    socket.emit('load_history', {
      conversationId,
      ...(params.cursor && { cursor: params.cursor }),
      limit: params.limit ?? 20
    })

    return true
  }
}
