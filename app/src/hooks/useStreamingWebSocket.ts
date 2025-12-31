/**
 * Streaming WebSocket Hook
 *
 * Connects Socket.IO events directly to the streaming store.
 * Clean, direct mapping without message array manipulation.
 */

import { useCallback, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'

import { logger } from '@/lib/request-context'
import { getSharedSocket, setSharedSocket } from '@/lib/socketRegistry'
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
const INIT_RETRY_MAX_ATTEMPTS = 5 // Maximum number of initialization retry attempts
const INIT_RETRY_BASE_DELAY_MS = 1000 // Initial retry delay (1 second)
const INIT_RETRY_MAX_DELAY_MS = 30000 // Maximum retry delay (30 seconds)

/**
 * Calculate exponential backoff delay for initialization retries
 * @param attempt - Current retry attempt number (1-indexed)
 * @returns Delay in milliseconds
 */
const calculateInitRetryDelay = (attempt: number): number => {
  const exponentialDelay = INIT_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
  return Math.min(exponentialDelay, INIT_RETRY_MAX_DELAY_MS)
}

/**
 * Get short-lived JWT token for WebSocket authentication (12 hours)
 */
const getAgentJWTToken = async (siteId: string): Promise<string | null> => {
  if (typeof document === 'undefined') return null;

  try {
    const response = await fetch('/api/auth/agent-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, expiresInSeconds: (12 * 60 * 60) })
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('websocket.token.request_failed', {
        message: 'Failed to get WebSocket agent token',
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        siteId
      });
      return null;
    }

    const data = await response.json();
    const token = data.token;

    if (!token) {
      logger.error('websocket.token.missing_field', {});
      return null;
    }

    return token;
  } catch (error) {
    logger.error('websocket.token.exception', {
      message: 'Failed to get WebSocket auth token',
      error: error instanceof Error ? error.message : String(error),
      siteId
    });
    return null;
  }
};

export function useStreamingWebSocket() {
  const socketRef = useRef<Socket | null>(null)
  const createdHereRef = useRef<boolean>(false) // Track if this instance created the socket

  // Guard flag to prevent concurrent initialization attempts
  const initializingRef = useRef<boolean>(false)
  // Timer ref for delayed initialization
  const initTimerRef = useRef<NodeJS.Timeout | null>(null)

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

  // Use composable sub-hooks for focused concerns
  const { wasRecoveredRef, serverConfigRef, pendingRecoveryAckRef, maybeSendRecoveryAck, trackReplayEventReceipt } =
    useWebSocketRecovery()
  const { retryStateRef, clearRetryState } = useWebSocketRetry()
  const { toolDeltaBufferRef, scheduleToolDeltaFlush, flushToolDeltaBufferImmediate } = useToolDeltaBuffer()
  const { clearStoredSocketId, handleCommitComplete, sendToolImpression } = useWebSocketHelpers(currentAppId)

  // Create Socket.IO connection (stable)
  const createConnection = useCallback(async (appId: string): Promise<Socket> => {
    return new Promise(async (resolve, reject) => {
      // Track initialization retry attempts
      let initAttempt = 0

      // Flag to track if the promise has been resolved/rejected to prevent double resolution
      let promiseResolved = false

      // Wrapper functions to ensure promise is only resolved/rejected once
      const safeResolve = (socket: Socket) => {
        if (!promiseResolved) {
          promiseResolved = true
          resolve(socket)
        } else {
          logger.warn('websocket.promise.already_resolved', {
            message: 'Attempted to resolve promise that was already resolved',
            socketId: socket.id,
            appId
          })
        }
      }

      const safeReject = (error: Error) => {
        if (!promiseResolved) {
          promiseResolved = true
          reject(error)
        } else {
          logger.warn('websocket.promise.already_resolved', {
            message: 'Attempted to reject promise that was already resolved',
            error: error.message,
            appId
          })
        }
      }

      // Clean up existing socket first to prevent duplicate handlers
      if (socketRef.current) {
        socketRef.current.removeAllListeners()
        socketRef.current.disconnect()
        socketRef.current = null
      }

      // Get the dynamic config to extract the baseUrl
      let config
      try {
        const { dynamicApiConfigService } = await import('../config/dynamic-api')
        config = await dynamicApiConfigService.getConfigForSite(appId)
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e)
        logger.error('websocket.config.error', { message: 'Failed to get dynamic config', error: errorMessage, appId })
        safeReject(e instanceof Error ? e : new Error(errorMessage))
        return
      }

      const socketUrl = config.baseUrl

      let authToken: string | null = null
      try {
        authToken = await getAgentJWTToken(appId)
      } catch (e) {
        logger.error('websocket.token.error', { message: 'Failed to get WebSocket JWT token', error: e instanceof Error ? e.message : String(e) })
      }

      const getSessionStorageKey = () => `socket_id_${appId}`
      const previousSocketId = sessionStorage.getItem(getSessionStorageKey())

      // Track token refresh attempts to prevent infinite loops
      let tokenRefreshCount = 0
      const MAX_TOKEN_REFRESH_ATTEMPTS = 7

      /**
       * Helper function to create a socket with given token and set up event handlers
       *
       * IMPORTANT: This function is defined inside the Promise executor, giving it lexical
       * access to `safeResolve` and `safeReject` via closure. This means:
       * - When called initially, the socket's connect handler will resolve the promise
       * - When called again during token refresh, the new socket's connect handler will
       *   still resolve the SAME original promise (not a new one)
       * - This closure behavior ensures the promise returned by createConnection is
       *   properly resolved even after token refresh
       *
       * @param token - JWT token to use for authentication
       * @param isInitialAttempt - Whether this is an initial connection attempt (for retry logic)
       * @returns The created Socket instance
       */
      const createSocketWithHandlers = (token: string | null, isInitialAttempt: boolean = true): Socket => {
        const socketOptions: any = {
          transports: ['websocket', 'polling'],
          timeout: 10000,
          autoConnect: false, // Prevent race: register handlers before connecting
          reconnection: true,
          reconnectionAttempts: 60,  // 60 attempts over ~5 minutes with exponential backoff
          reconnectionDelay: 2000,   // Start with 2 second delay
          reconnectionDelayMax: 5000, // Max 5 second delay between attempts
          randomizationFactor: 0.5,
          // Enable connection state recovery to preserve socket ID across reconnections
          // This allows the server to replay buffered events after brief disconnections
          connectionStateRecovery: {},
          // Pass previous socket ID for manual recovery after page reload
          // Pass conversationId from cookie for recovery after tab closure (when socket ID is lost)
          auth: {
            ...(token && { token }),
            ...(previousSocketId && { previousSocketId }),
            // Include conversationId from cookie for tab-closure recovery
            ...(getConversationIdFromCookie(appId) && { conversationId: getConversationIdFromCookie(appId) }),
            // Include appId for server-side validation of recovery requests
            appId,
          }
        }
        if (token) {
          socketOptions.extraHeaders = { Authorization: `Bearer ${token}` }
        }
        const socket = io(socketUrl, socketOptions)
        if (process.env.NODE_ENV === 'development') {
          // Disabled noisy websocket logging
          // socket.onAny((event, ...args) => logger.debug('websocket.event.incoming', { event, argsPreview: JSON.stringify(args).slice(0, 500), timestamp: Date.now() }))
          // socket.onAnyOutgoing((event, ...args) => logger.debug('websocket.event.outgoing', { event, argsCount: args.length, timestamp: Date.now() }))
        }
        socket.on('connect', () => {
          // Check if this is a recovered connection (socket ID preserved)
          if (socket.recovered) {
            // Mark that this connection was recovered so message handler knows to initialize stream
            wasRecoveredRef.current = true
            // Connection was recovered - buffered events will be replayed by server
            // Update UI state to show we're reconnected
            setWebSocketState({ connected: true, status: 'idle' })
          } else if (previousSocketId && previousSocketId !== socket.id) {
            wasRecoveredRef.current = true
            setWebSocketState({ connected: true, status: 'idle' })
            sessionStorage.setItem(getSessionStorageKey(), socket.id)
          } else {
            wasRecoveredRef.current = false
            setWebSocketState({ connected: true, status: 'idle' })
            sessionStorage.setItem(getSessionStorageKey(), socket.id)
          }

          // Check store-based retry state and clear stale state (same logic as 'reconnect' handler)
          // This is needed when a NEW socket connects (not just reconnects), e.g., after page refresh
          // or component remount, to clear any persisted retry state from Zustand
          const store = useStreamingConversationStore.getState()
          if (store.connectionRetry.isRetrying) {
            logger.info('websocket.connect.clearing-stale-retry', {
              socketId: socket.id,
              elapsedMs: store.connectionRetry.retryStartedAt
                ? Date.now() - store.connectionRetry.retryStartedAt
                : null
            })

            // If we're still in retrying state, the stream was successfully recovered
            if (store.streamingState === 'retrying') {
              setStreamingState('streaming')
              setIsLoading(true)
              logger.info('websocket.stream.recovered-on-connect', { socketId: socket.id })
            } else {
              // Otherwise, just clear the stale retry state without changing streamingState
              // (it may have already been set to 'idle' or 'streaming' by recovery_status)
              logger.info('websocket.connect.retry-already-cleared', {
                socketId: socket.id,
                currentStreamingState: store.streamingState
              })
            }

            // Clear store-based retry (this also clears the escalation timeout)
            store.clearConnectionRetry()
          }

          // Resolve the original promise (from createConnection) via closure
          // This works for both initial connection and token refresh retries
          safeResolve(socket)
        })
        socket.on('connect_error', async (error) => {
          const errorMessage = error.message || String(error)

          // Check if this is a JWT token expiration error
          if (errorMessage.includes('JWT validation failed') && errorMessage.includes('Token expired')) {
            // Prevent infinite token refresh loops
            if (tokenRefreshCount >= MAX_TOKEN_REFRESH_ATTEMPTS) {
              logger.error('websocket.token.refresh_limit_exceeded', {
                message: 'Maximum token refresh attempts exceeded, rejecting connection',
                appId,
                attempts: tokenRefreshCount
              })
              setWebSocketState({
                connected: false,
                status: 'error',
                error: { message: 'Failed to establish connection after multiple token refresh attempts' }
              })
              safeReject(new Error('Token refresh limit exceeded'))
              return
            }

            tokenRefreshCount++
            logger.info('websocket.token.expired', {
              message: 'JWT token expired, refetching and retrying connection',
              appId,
              originalError: errorMessage,
              attempt: tokenRefreshCount
            })

            try {
              // Refetch the agent token
              const newToken = await getAgentJWTToken(appId)

              if (!newToken) {
                logger.error('websocket.token.refetch_failed', {
                  message: 'Failed to refetch agent token after expiration',
                  appId
                })
                setWebSocketState({
                  connected: false,
                  status: 'error',
                  error: { message: 'Failed to refresh authentication token' }
                })
                safeReject(error instanceof Error ? error : new Error(String(error)))
                return
              }

              logger.info('websocket.token.refetched', {
                message: 'Successfully refetched agent token, retrying connection',
                appId,
                attempt: tokenRefreshCount
              })

              // Clean up the failed socket
              socket.removeAllListeners()
              socket.disconnect()

              // Create a new socket with the fresh token (not an initial attempt)
              // IMPORTANT: createSocketWithHandlers is defined in the same scope as safeResolve/safeReject,
              // so it has access to them via closure. When the new socket connects, its 'connect' handler
              // will call safeResolve(socket), which resolves the ORIGINAL promise from createConnection.
              // This ensures the caller of createConnection() gets the resolved socket even after token refresh.
              const newSocket = createSocketWithHandlers(newToken, false)

              // Store the new socket immediately so it's available even before connection completes
              // This ensures socketRef.current is always pointing to the active socket
              socketRef.current = newSocket

              // Return early - the new socket's connect handler will call safeResolve(socket)
              // which resolves the original promise via closure. No need to handle resolution here.
              return
            } catch (refreshError) {
              logger.error('websocket.token.refresh_exception', {
                message: 'Exception while refreshing token',
                appId,
                error: refreshError instanceof Error ? refreshError.message : String(refreshError)
              })
              setWebSocketState({
                connected: false,
                status: 'error',
                error: { message: 'Failed to refresh authentication token' }
              })
              safeReject(refreshError instanceof Error ? refreshError : new Error(String(refreshError)))
              return
            }
          }

          // Handle initialization retry for transient network failures
          if (isInitialAttempt && initAttempt < INIT_RETRY_MAX_ATTEMPTS) {
            initAttempt++
            const retryDelay = calculateInitRetryDelay(initAttempt)

            logger.info('websocket.init.retry', {
              message: 'Initial connection failed, retrying with exponential backoff',
              appId,
              attempt: initAttempt,
              maxAttempts: INIT_RETRY_MAX_ATTEMPTS,
              retryDelay,
              error: errorMessage
            })

            // Update UI to show retry status
            setWebSocketState({
              connected: false,
              status: 'connecting',
              error: { message: 'Connecting to server — retrying automatically.' }
            })

            // Wait for backoff delay, then retry
            await new Promise(resolve => setTimeout(resolve, retryDelay))

            // Check if cleanup ran during delay (component unmounted or appId changed)
            // If socketRef was cleared, don't create a new orphaned socket
            if (!socketRef.current) {
              logger.info('websocket.init.retry_aborted', {
                message: 'Component unmounted during retry delay, aborting retry',
                appId,
                attempt: initAttempt
              })
              safeReject(new Error('Connection retry aborted: component unmounted'))
              return
            }

            // Clean up the failed socket
            socket.removeAllListeners()
            socket.disconnect()

            // Retry connection with same token
            try {
              const newSocket = createSocketWithHandlers(token, true)
              socketRef.current = newSocket
              return
            } catch (retryError) {
              logger.error('websocket.init.retry_exception', {
                message: 'Exception during retry attempt',
                appId,
                attempt: initAttempt,
                error: retryError instanceof Error ? retryError.message : String(retryError)
              })
            }
          }

          // For non-token-expiration errors after exhausting retries, proceed with error handling
          if (isInitialAttempt && initAttempt >= INIT_RETRY_MAX_ATTEMPTS) {
            logger.error('websocket.init.max_retries_exceeded', {
              message: 'Maximum initialization retry attempts exceeded',
              appId,
              attempts: initAttempt,
              finalError: errorMessage
            })
          }

          setWebSocketState({
            connected: false,
            status: 'error',
            error: { message: errorMessage }
          })
          safeReject(error instanceof Error ? error : new Error(errorMessage))
        })
        socket.on('disconnect', () => {
          pendingRecoveryAckRef.current = null
          // DO NOT clear APP_NOT_FOUND retry state here - it contains pendingMessage for auto-resend
          // Only clear it when we explicitly give up on the retry (in error handlers)
          const store = useStreamingConversationStore.getState()
          const isStreaming = store.streamingState === 'streaming' || store.streamingState === 'retrying' || store.activeStream !== null

          if (isStreaming) {
            // Connection dropped during active streaming
            // Start store-based retry (survives component remounts)
            store.startConnectionRetry(socket.id)

            // Show warning (yellow) initially - we'll retry for 5 minutes
            setWebSocketState({ connected: false, status: 'connecting', error: { message: 'Connection lost, retrying...' } })

            // Create deterministic escalation timeout that survives component remounts
            // This fires regardless of component lifecycle state
            const escalationTimeoutId = setTimeout(() => {
              const currentStore = useStreamingConversationStore.getState()
              if (currentStore.connectionRetry.isRetrying) {
                logger.warn('websocket.escalation.timeout-fired', {
                  socketId: socket.id,
                  elapsedMs: currentStore.connectionRetry.retryStartedAt
                    ? Date.now() - currentStore.connectionRetry.retryStartedAt
                    : null
                })

                // Mark the active stream as failed and finalize it
                // This moves it to message history so user can see what failed
                const { activeStream } = currentStore
                if (activeStream) {
                  // Update active stream with error info before finalizing
                  currentStore.markUpstreamError({
                    message: 'Connection lost - retry timeout exceeded',
                    type: 'NETWORK_ERROR'
                  })
                  currentStore.finalizeStream()
                }

                // Escalate to error state
                currentStore.setWebSocketState({ connected: false, status: 'error', error: { message: 'Connection lost - retry timeout exceeded' } })
                currentStore.setStreamingState('idle') // Reset to idle since stream is finalized
                currentStore.setIsLoading(false)
                currentStore.clearConnectionRetry()
              }
            // Use server-configured timeout if available, otherwise use default
            // This ensures client and server use the same recovery window
            }, serverConfigRef.current?.streamRecoveryWindow ?? CONNECTION_RETRY_TIMEOUT_MS)

            // Store escalation timeout ID in Zustand (survives remounts)
            store.setEscalationTimeout(escalationTimeoutId)
          } else {
            // Normal disconnect when idle
            setWebSocketState({ connected: false, status: 'idle' })
          }
        })
        socket.on('reconnect_attempt', () => setWebSocketState({ connected: false, status: 'connecting' }))
        socket.on('reconnect', () => {
          setWebSocketState({ connected: true, status: 'idle' })
          const store = useStreamingConversationStore.getState()

          // Check store-based retry state
          if (store.connectionRetry.isRetrying) {
            logger.info('websocket.reconnect.resuming-stream', {
              socketId: socket.id,
              elapsedMs: store.connectionRetry.retryStartedAt
                ? Date.now() - store.connectionRetry.retryStartedAt
                : null
            })

            // If we're still in retrying state, the stream was successfully recovered
            if (store.streamingState === 'retrying') {
              setStreamingState('streaming')
              setIsLoading(true)
              logger.info('websocket.stream.recovered', { socketId: socket.id })
            } else {
              // Otherwise, mark as error
              setStreamingState('error')
              setIsLoading(false)
            }

            // Clear store-based retry (this also clears the escalation timeout)
            store.clearConnectionRetry()
          }
        })
        socket.on('reconnect_error', (error) => setWebSocketState({ connected: false, status: 'connecting', error: { message: error.message } }))
        socket.on('reconnect_failed', () => {
          const store = useStreamingConversationStore.getState()
          const isStreaming = store.streamingState === 'streaming' || store.streamingState === 'retrying' || store.activeStream !== null
          const wasRetrying = store.connectionRetry.isRetrying || store.connectionRetry.wasStreamingOnDisconnect

          // Clear store-based retry (this also clears the escalation timeout)
          if (store.connectionRetry.isRetrying) {
            store.clearConnectionRetry()
          }

          setWebSocketState({ connected: false, status: 'error', error: { message: 'Failed to reconnect' } })
          if (isStreaming || wasRetrying) {
            // Mark the active stream as failed and finalize it
            const { activeStream } = store
            if (activeStream) {
              store.markUpstreamError({
                message: 'Failed to reconnect after multiple attempts',
                type: 'NETWORK_ERROR'
              })
              store.finalizeStream()
            }
            setStreamingState('idle') // Reset to idle since stream is finalized
            setIsLoading(false)
          }
        })
        return socket
      }

      // Create the initial socket with retry logic enabled
      createSocketWithHandlers(authToken, true)
    })
  }, [setWebSocketState]) /* eslint-disable-line react-hooks/exhaustive-deps */

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
  ])

  useEffect(() => {
    // Effect intentionally depends ONLY on currentAppId to avoid recreating connection on stable callback identity changes.
    // createConnection & setupEventHandlers are stable (useCallback with static deps) and exclusion prevents unnecessary reconnects.
    if (!currentAppId) return

    const initializeConnection = async () => {
      const initAppId = currentAppId
      try {
        const socket = await createConnection(initAppId)

        // Check if app changed during async initialization
        const currentState = useStreamingConversationStore.getState()
        if (currentState.currentAppId !== initAppId) {
          socket.removeAllListeners()
          socket.disconnect()
          return
        }

        socketRef.current = socket
        createdHereRef.current = true // Mark that this instance created the socket

        // Register socket globally for OAuth popup access
        setSharedSocket(socket)

        // Set up event handlers once for the lifetime of this connection
        setupEventHandlers(socket)

        // Connect the socket after handlers are registered (autoConnect=false prevents race)
        socket.connect()
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        logger.error('websocket.connection.init_failed', {
          message: 'Failed to initialize persistent connection',
          error: errorMessage,
          appId: initAppId
        })

        // Set WebSocket error state so parent components can react
        setWebSocketState({
          connected: false,
          status: 'error',
          error: { message: errorMessage }
        })
      } finally {
        initializingRef.current = false
      }
    }

    // Reuse existing shared socket if available (prevents duplicate connections)
    const existingSocket = getSharedSocket()
    if (existingSocket && !socketRef.current) {
      socketRef.current = existingSocket
      createdHereRef.current = false // We didn't create this socket
      return;
    }
    // Only create connection if we don't have one and not already initializing
    if (!socketRef.current && !initializingRef.current) {
      initializingRef.current = true
      // Delay initialization by 500ms for eliminating race condition during app switch
      initTimerRef.current = setTimeout(() => {
        void initializeConnection()
      }, 500)
    }

    // Cleanup when app changes or component unmounts
    // IMPORTANT: Do NOT clear connectionRetry state here - it must survive remounts
    // The escalation timeout in the store will fire regardless of component lifecycle
    return () => {
      // Clear initialization timer if pending
      if (initTimerRef.current) {
        clearTimeout(initTimerRef.current)
        initTimerRef.current = null
        // Reset initialization flag if timer is cleared before initialization
        initializingRef.current = false
      }

      // Clear APP_NOT_FOUND retry timer (not connection retry - that survives remounts)
      clearRetryState()
      pendingRecoveryAckRef.current = null

      // DO NOT clear stored socket ID here - it must persist across remounts for manual recovery.
      // Socket ID is already cleared in the correct places: on 'complete' and 'error' events,
      // which are the only scenarios where we definitively know the stream is finished.
      // Clearing here would break manual recovery when users refresh during an active stream.

      if (socketRef.current) {
        // Only disconnect and clear shared socket if this instance created it
        if (createdHereRef.current && getSharedSocket() === socketRef.current) {
          // Clear shared socket reference
          setSharedSocket(null)

          socketRef.current.removeAllListeners()
          // Stop reconnection attempts before disconnecting to prevent stale reconnects
          socketRef.current.io.reconnection(false)
          socketRef.current.disconnect()
        }

        socketRef.current = null
        createdHereRef.current = false
      }
      // Reset initialization flag to allow re-initialization with new appId
      initializingRef.current = false
    }
    // Including createConnection & setupEventHandlers satisfies exhaustive-deps; guard prevents duplicate initialization.
  }, [currentAppId, createConnection, setupEventHandlers, clearRetryState, setWebSocketState, clearStoredSocketId]) /* eslint-disable-line react-hooks/exhaustive-deps */

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
      const state = useStreamingConversationStore.getState()
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
  ])

  return {
    sendMessage,
    webSocketState,
    isConnected: webSocketState.connected,
    isStreaming: webSocketState.status === 'streaming'
  }
}
