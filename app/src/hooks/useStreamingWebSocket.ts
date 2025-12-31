/**
 * Streaming WebSocket Hook
 *
 * Connects Socket.IO events directly to the streaming store.
 * Clean, direct mapping without message array manipulation.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { Socket } from 'socket.io-client'

import { logger } from '@/lib/request-context'
import { ConnectionManager } from '@/services/websocket/ConnectionManager'
import {
  useAddToolCallSegment,
  useAddToolResultSegment,
  useAddToolStartSegment,
  useAppendTextSegment,
  useCurrentAppId,
  useFinalizeStream,
  useMarkBudgetExceeded,
  useMarkMaxStepsReached,
  useMarkUpstreamError,
  useSetIsLoading,
  useSetStreamingState,
  useSetWebSocketState,
  useStartNewStream,
  useStreamingConversationStore,
  useWebSocketState,
} from '@/stores/useStreamingConversationStore'
import {
  clearConversationIdCookie,
  getConversationIdFromCookie,
  setConversationIdCookie,
  useToolDeltaBuffer,
  useWebSocketHelpers,
  useWebSocketRecovery,
  useWebSocketRetry,
} from './websocket'
import {
  CatchupCompleteHandler,
  CatchupStatusHandler,
  ChunkHandler,
  CompleteHandler,
  ConversationInfoHandler,
  ErrorHandler,
  type MessageContext,
  MessageHandlerRegistry,
  RecoveryStatusHandler,
  ReplayCompleteHandler,
  ServerConfigHandler,
  StepCompleteHandler,
  StepStartHandler,
  ToolCallHandler,
  ToolInputDeltaHandler,
  ToolResultHandler,
  ToolStartHandler,
} from './websocket/handlers'
import { captureVisualContext } from '../app/develop/components/visualContextCapture'
import type { AgentsAppChatMessage, AgentsAppContext } from '../types/websocket-context'

// Constants
const CONNECTION_RETRY_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes - escalation timeout for connection retry
export function useStreamingWebSocket() {
  const socketRef = useRef<Socket | null>(null)
  const connectionManagerRef = useRef<ConnectionManager | null>(null)

  if (!connectionManagerRef.current) {
    connectionManagerRef.current = new ConnectionManager({
      getConversationId: (appId: string) => getConversationIdFromCookie(appId),
    })
  }

  const connectionManager = connectionManagerRef.current!
  const socketsWithHandlersRef = useRef<WeakSet<Socket>>(new WeakSet())
  const storeRef = useRef(useStreamingConversationStore.getState())

  const webSocketState = useWebSocketState()
  const currentAppId = useCurrentAppId()

  // Hook setters & streaming state (declared early for use in callbacks)
  const startNewStream = useStartNewStream()
  const appendTextSegment = useAppendTextSegment()
  const addToolStartSegment = useAddToolStartSegment()
  const addToolCallSegment = useAddToolCallSegment()
  const addToolResultSegment = useAddToolResultSegment()
  const markMaxStepsReached = useMarkMaxStepsReached()
  const markUpstreamError = useMarkUpstreamError()
  const markBudgetExceeded = useMarkBudgetExceeded()
  const finalizeStream = useFinalizeStream()
  const setWebSocketState = useSetWebSocketState()
  const setStreamingState = useSetStreamingState()
  const setIsLoading = useSetIsLoading()

  useEffect(() => {
    const unsubscribe = useStreamingConversationStore.subscribe((state) => {
      storeRef.current = state
    })
    return unsubscribe
  }, [])

  // Use composable sub-hooks for focused concerns
  const { wasRecoveredRef, serverConfigRef, pendingRecoveryAckRef, maybeSendRecoveryAck, trackReplayEventReceipt } =
    useWebSocketRecovery()
  const { retryStateRef, clearRetryState } = useWebSocketRetry()
  const { toolDeltaBufferRef, scheduleToolDeltaFlush, flushToolDeltaBufferImmediate } = useToolDeltaBuffer()
  const { clearStoredSocketId, handleCommitComplete, sendToolImpression } = useWebSocketHelpers(currentAppId)

  // Connection lifecycle handled by ConnectionManager
  const handleConnectionEstablished = useCallback(({ socket, recovered }: { socket: Socket; recovered: boolean }) => {
    wasRecoveredRef.current = recovered
    setWebSocketState({ connected: true, status: 'idle' })

    const store = storeRef.current
    if (store.connectionRetry.isRetrying) {
      logger.info('websocket.connect.clearing-stale-retry', {
        socketId: socket.id,
        elapsedMs: store.connectionRetry.retryStartedAt ? Date.now() - store.connectionRetry.retryStartedAt : null,
      })

      if (store.streamingState === 'retrying') {
        setStreamingState('streaming')
        setIsLoading(true)
        logger.info('websocket.stream.recovered-on-connect', { socketId: socket.id })
      } else {
        logger.info('websocket.connect.retry-already-cleared', {
          socketId: socket.id,
          currentStreamingState: store.streamingState,
        })
      }

      store.clearConnectionRetry()
    }
  }, [setIsLoading, setStreamingState, setWebSocketState, wasRecoveredRef])

  const handleConnectionFailed = useCallback((error: Error) => {
    const errorMessage = error?.message ?? 'Unknown error'
    logger.error('websocket.connection.init_failed', {
      message: 'Failed to initialize persistent connection',
      error: errorMessage,
      appId: currentAppId,
    })

    setWebSocketState({
      connected: false,
      status: 'error',
      error: { message: errorMessage },
    })
  }, [currentAppId, setWebSocketState])

  const handleConnectError = useCallback((error: Error) => {
    const errorMessage = error?.message ?? 'Unknown error'
    logger.error('websocket.connection.error', {
      message: errorMessage,
      appId: currentAppId,
    })

    setWebSocketState({
      connected: false,
      status: 'error',
      error: { message: errorMessage },
    })
  }, [currentAppId, setWebSocketState])

  const handleDisconnect = useCallback(({ reason, socket }: { reason: Socket.DisconnectReason; socket: Socket }) => {
    pendingRecoveryAckRef.current = null
    const store = storeRef.current
    const isStreaming =
      store.streamingState === 'streaming' || store.streamingState === 'retrying' || store.activeStream !== null

    if (isStreaming) {
      store.startConnectionRetry(socket.id)

      setWebSocketState({
        connected: false,
        status: 'connecting',
        error: {
          message: reason ? `Connection lost (${reason}), retrying...` : 'Connection lost, retrying...',
          type: 'NETWORK_ERROR',
        },
      })

      const escalationTimeoutId = setTimeout(() => {
        const currentStore = storeRef.current
        if (currentStore.connectionRetry.isRetrying) {
          logger.warn('websocket.escalation.timeout-fired', {
            socketId: socket.id,
            elapsedMs: currentStore.connectionRetry.retryStartedAt
              ? Date.now() - currentStore.connectionRetry.retryStartedAt
              : null,
          })

          const { activeStream } = currentStore
          if (activeStream) {
            currentStore.markUpstreamError({
              message: 'Connection lost - retry timeout exceeded',
              type: 'NETWORK_ERROR',
            })
            currentStore.finalizeStream()
          }

          currentStore.setWebSocketState({
            connected: false,
            status: 'error',
            error: { message: 'Connection lost - retry timeout exceeded' },
          })
          currentStore.setStreamingState('idle')
          currentStore.setIsLoading(false)
          currentStore.clearConnectionRetry()
        }
      }, serverConfigRef.current?.streamRecoveryWindow ?? CONNECTION_RETRY_TIMEOUT_MS)

      store.setEscalationTimeout(escalationTimeoutId)
    } else {
      setWebSocketState({ connected: false, status: 'idle' })
    }
  }, [pendingRecoveryAckRef, serverConfigRef, setWebSocketState])

  const handleReconnectAttempt = useCallback(() => {
    setWebSocketState({ connected: false, status: 'connecting' })
  }, [setWebSocketState])

  const handleReconnect = useCallback(({ socket }: { socket: Socket }) => {
    setWebSocketState({ connected: true, status: 'idle' })
    const store = storeRef.current

    if (store.connectionRetry.isRetrying) {
      logger.info('websocket.reconnect.resuming-stream', {
        socketId: socket.id,
        elapsedMs: store.connectionRetry.retryStartedAt ? Date.now() - store.connectionRetry.retryStartedAt : null,
      })

      if (store.streamingState === 'retrying') {
        setStreamingState('streaming')
        setIsLoading(true)
        logger.info('websocket.stream.recovered', { socketId: socket.id })
      } else {
        setStreamingState('error')
        setIsLoading(false)
      }

      store.clearConnectionRetry()
    }
  }, [setIsLoading, setStreamingState, setWebSocketState])

  const handleReconnectError = useCallback(({ error }: { socket: Socket; error: Error }) => {
    setWebSocketState({ connected: false, status: 'connecting', error: { message: error.message } })
  }, [setWebSocketState])

  const handleReconnectFailed = useCallback((_: { socket: Socket }) => {
    const store = storeRef.current
    const isStreaming =
      store.streamingState === 'streaming' || store.streamingState === 'retrying' || store.activeStream !== null
    const wasRetrying = store.connectionRetry.isRetrying || store.connectionRetry.wasStreamingOnDisconnect

    if (store.connectionRetry.isRetrying) {
      store.clearConnectionRetry()
    }

    setWebSocketState({ connected: false, status: 'error', error: { message: 'Failed to reconnect' } })

    if (isStreaming || wasRetrying) {
      const { activeStream } = store
      if (activeStream) {
        store.markUpstreamError({
          message: 'Failed to reconnect after multiple attempts',
          type: 'NETWORK_ERROR',
        })
        store.finalizeStream()
      }
      setStreamingState('idle')
      setIsLoading(false)
    }
  }, [setIsLoading, setStreamingState, setWebSocketState])

  /**
   * Handle commit selection and preview refresh after message completion
   *
   * MESSAGE_COMPLETE must fire AFTER commit selection completes to ensure files are synced
   *
   * @param commitHash - Optional commit hash from the completed message
   */
  // Set up Socket.IO event handlers for streaming (defined before useEffect to satisfy dependency ordering)
  const setupEventHandlers = useCallback((socket: Socket) => {
    // Create message handler registry for strategy pattern
    const registry = new MessageHandlerRegistry()

    // Register all handlers
    registry.register(new ServerConfigHandler())
    registry.register(new ConversationInfoHandler())
    registry.register(new RecoveryStatusHandler())
    registry.register(new ReplayCompleteHandler())
    registry.register(new CatchupStatusHandler())
    registry.register(new CatchupCompleteHandler())
    registry.register(new StepStartHandler())
    registry.register(new ChunkHandler())
    registry.register(new ToolStartHandler())
    registry.register(new ToolInputDeltaHandler())
    registry.register(new ToolCallHandler())
    registry.register(new ToolResultHandler())
    registry.register(new StepCompleteHandler())
    registry.register(new CompleteHandler())
    registry.register(new ErrorHandler())

    // Build context once (reused for all handlers)
    const messageContext: MessageContext = {
      socket,
      currentAppId,
      actions: {
        setWebSocketState,
        setStreamingState,
        setIsLoading,
        startNewStream,
        appendTextSegment,
        addToolStartSegment,
        addToolCallSegment,
        addToolResultSegment,
        markMaxStepsReached,
        markUpstreamError,
        markBudgetExceeded,
        finalizeStream,
        flushToolDeltaBufferImmediate,
        scheduleToolDeltaFlush,
      },
      helpers: {
        maybeSendRecoveryAck,
        trackReplayEventReceipt,
        clearStoredSocketId,
        handleCommitComplete,
        setConversationIdCookie,
        clearConversationIdCookie,
        getConversationIdFromCookie,
        clearRetryState,
        sendToolImpression,
      },
      refs: {
        serverConfig: serverConfigRef,
        pendingRecoveryAck: pendingRecoveryAckRef,
        toolDeltaBuffer: toolDeltaBufferRef,
        retryState: retryStateRef,
      },
    }

    // Track if we've initialized stream for replayed events
    socket.on('status', (data) => {
      if (data.data?.status === 'thinking') {
        setWebSocketState({ status: 'streaming' })
        setStreamingState('streaming')
      }
    })
    // Use function (not arrow) to ensure ack callback is reliably accessible
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on('message', async function (data: { type: string; content: string; data?: any }, ack?: () => void) {
      // Persist conversationId to per-app cookie for tab-closure recovery
      // This enables recovery even when sessionStorage (socket ID) is lost
      if (data.data?.conversationId && currentAppId && typeof data.data.conversationId === 'string') {
        setConversationIdCookie(currentAppId, data.data.conversationId)
      }

      trackReplayEventReceipt(socket, data.type)

      // Dispatch to appropriate handler via registry
      await registry.dispatch(data.type, data, messageContext, ack)
    })
  }, [
    appendTextSegment,
    addToolStartSegment,
    addToolResultSegment,
    addToolCallSegment,
    markMaxStepsReached,
    markUpstreamError,
    markBudgetExceeded,
    finalizeStream,
    setWebSocketState,
    setStreamingState,
    setIsLoading,
    clearRetryState,
    currentAppId,
    handleCommitComplete,
    scheduleToolDeltaFlush,
    flushToolDeltaBufferImmediate,
    maybeSendRecoveryAck,
    trackReplayEventReceipt,
    clearStoredSocketId,
    pendingRecoveryAckRef,
    retryStateRef,
    sendToolImpression,
    serverConfigRef,
    startNewStream,
    toolDeltaBufferRef,
  ])

  const handleSocketReady = useCallback((socket: Socket, _meta?: { isNew: boolean }) => {
    // _meta is provided for future telemetry; handler identity alone dictates setup.
    socketRef.current = socket
    if (!socketsWithHandlersRef.current.has(socket)) {
      setupEventHandlers(socket)
      socketsWithHandlersRef.current.add(socket)
    }
  }, [setupEventHandlers])

  useEffect(() => {
    if (!currentAppId) return

    const callbacks = {
      onSocketReady: handleSocketReady,
      onConnect: handleConnectionEstablished,
      onConnectionFailed: handleConnectionFailed,
      onConnectError: handleConnectError,
      onDisconnect: handleDisconnect,
      onReconnectAttempt: handleReconnectAttempt,
      onReconnect: handleReconnect,
      onReconnectError: handleReconnectError,
      onReconnectFailed: handleReconnectFailed,
    }

    void connectionManager.connect(currentAppId, callbacks)

    return () => {
      connectionManager.disconnect()
      socketRef.current = null
      clearRetryState()
      pendingRecoveryAckRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable refs omitted intentionally; reconnection depends on explicit list
  }, [
    currentAppId,
    handleSocketReady,
    handleConnectionEstablished,
    handleConnectionFailed,
    handleConnectError,
    handleDisconnect,
    handleReconnectAttempt,
    handleReconnect,
    handleReconnectError,
    handleReconnectFailed,
    clearRetryState,
    connectionManager,
  ])


  /**
   * Send message - the main streaming function
   */
  const sendMessage = useCallback(async (
    content: string,
    aiEditContext?: any,
    selectedAsset?: any,
    todoListContext?: any,
    isActionRequest?: boolean,
    customContext?: any
  ) => {
    if (!content.trim() || !currentAppId) return

    try {
      // Reuse existing Socket.IO connection
      const socket = socketRef.current

      if (!socket) {
        throw new Error('WebSocket connection not initialized. Please wait for connection to establish.')
      }

      if (!socket.connected) {
        throw new Error('WebSocket not connected. Connection may be reconnecting...')
      }

      setIsLoading(true)
      setStreamingState('streaming')

      // Start new stream (adds user message + creates activeStream)
      startNewStream(content)

      // Get current state for rich context
      const state = storeRef.current
      const { conversations, buildErrorContext } = state

      // Find current conversation ID
      const currentConversation = conversations.find((conv: any) => conv.appId === currentAppId)
      let conversationId = currentConversation?.id

      // If conversationId is null, check cookie and delete it
      if (!conversationId) {
        conversationId = getConversationIdFromCookie(currentAppId)
        if (conversationId) {
          clearConversationIdCookie(currentAppId)
        }
      }

      // Capture visual context from iframe
      const visualContext = await captureVisualContext()

      // Transform selected asset to include https protocol
      const transformedAsset = selectedAsset ? {
        ...selectedAsset,
        imageUrl: selectedAsset.imageUrl.startsWith('//')
          ? `https:${selectedAsset.imageUrl}`
          : selectedAsset.imageUrl,
        ...(selectedAsset.thumbnailUrl && {
          thumbnailUrl: selectedAsset.thumbnailUrl.startsWith('//')
            ? `https:${selectedAsset.thumbnailUrl}`
            : selectedAsset.thumbnailUrl
        }),
        ...(selectedAsset.videoUrl && {
          videoUrl: selectedAsset.videoUrl.startsWith('//')
            ? `https:${selectedAsset.videoUrl}`
            : selectedAsset.videoUrl
        })
      } : null

      // Build context attachments array using new framework
      const contextAttachments: any[] = []

      // Add AI Edit context as attachment (persisted)
      if (aiEditContext) {
        contextAttachments.push({
          type: 'ai_edit_context',
          data: aiEditContext,
          persistence: 'save',
          renderStrategy: 'before_prompt',
          metadata: {
            timestamp: Date.now(),
            source: 'ai-edit-dialog'
          }
        })
      }

      // Add Visual context as attachment (ephemeral)
      if (visualContext) {
        contextAttachments.push({
          type: 'visual_context',
          data: visualContext,
          persistence: 'ephemeral',
          renderStrategy: 'before_prompt',
          metadata: {
            timestamp: Date.now(),
            source: 'iframe-capture'
          }
        })
      }

      // Add Selected Assets as attachment (ephemeral)
      if (transformedAsset) {
        contextAttachments.push({
          type: 'selected_assets',
          data: [transformedAsset],
          persistence: 'ephemeral',
          renderStrategy: 'before_prompt',
          metadata: {
            timestamp: Date.now(),
            source: 'asset-manager'
          }
        })
      }

      // Add Build Error as attachment (ephemeral - from publish failures)
      if (buildErrorContext) {
        contextAttachments.push({
          type: 'build_error',
          data: {
            error: buildErrorContext.error,
            details: buildErrorContext.details,
            exitCode: buildErrorContext.exitCode
          },
          persistence: 'ephemeral',
          renderStrategy: 'before_prompt',
          metadata: {
            timestamp: Date.now(),
            source: 'publish-failure'
          }
        })
      }

      if (todoListContext) {
        contextAttachments.push({
          type: 'todo_list_context',
          data: todoListContext,
          persistence: 'save',
          renderStrategy: 'before_prompt',
          metadata: {
            timestamp: Date.now(),
            source: 'todo-list-tool'
          }
        })
      }

      // Add action request context when user selects a suggested response
      if (isActionRequest) {
        contextAttachments.push({
          type: 'action_request',
          data: { instruction: '[Action Request] Execute this request immediately. Do not summarize previous work.' },
          persistence: 'ephemeral',
          renderStrategy: 'before_prompt',
          metadata: {
            timestamp: Date.now(),
            source: 'suggested_response'
          }
        })
      }

      if (customContext) {
        if (customContext.customAttachments && Array.isArray(customContext.customAttachments)) {
          contextAttachments.push(...customContext.customAttachments)
        } else if (customContext.type && customContext.data) {
          contextAttachments.push({
            type: customContext.type,
            data: customContext.data,
            persistence: customContext.persistence || 'ephemeral',
            renderStrategy: 'before_prompt',
            metadata: {
              timestamp: Date.now(),
              source: customContext.source || 'custom-context'
            }
          })
        }
      }

      // Build rich context object with proper typing
      const richContext: AgentsAppContext = {
        // Basic metadata
        metadata: {
          appId: currentAppId,
          userId: 'current-user', // TODO: Get from auth context
          sessionId: socket.id,
          userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },

        // Conversation context
        conversation: {
          conversationId,
          maxMessages: 10,
          includeHistory: true
        },

        // App context - enable rich project understanding
        appContext: {
          includeDirectoryListing: true,
          includePackageInfo: true,
          includeDependencyStatus: true,
          maxDirectoryDepth: 3
        },

        // Generic context attachments (new framework)
        ...(contextAttachments.length > 0 && { contextAttachments }),
      }

      // Send the message to start streaming with rich context
      const chatMessage: AgentsAppChatMessage = {
        message: content,
        timestamp: new Date().toISOString(),
        // Don't set agentId - let backend routing logic decide based on app state
        context: richContext
      }

      // Clear any pending retry timer before starting new message
      if (retryStateRef.current.retryTimer) {
        clearTimeout(retryStateRef.current.retryTimer)
      }

      // Store message for potential retry on APP_NOT_FOUND error
      retryStateRef.current = {
        pendingMessage: { chatMessage, startTime: Date.now() },
        retryCount: 0
      }

      // Use Socket.IO acknowledgement for delivery confirmation
      socket.emit('chat_message', chatMessage, (response: any) => {
        if (response?.error) {
          logger.error('websocket.message.ack_error', { error: response.error })
        }
      })

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('websocket.message.failure', { error: errorMessage })

      setWebSocketState({
        status: 'error',
        error: { message: errorMessage }
      })
      setStreamingState('error')
      setIsLoading(false)
    }
  }, [
    currentAppId,
    startNewStream,
    setIsLoading,
    setStreamingState,
    setWebSocketState,
    retryStateRef,
  ])

  return {
    sendMessage,
    webSocketState,
    isConnected: webSocketState.connected,
    isStreaming: webSocketState.status === 'streaming'
  }
}
