/**
 * Streaming WebSocket Hook
 *
 * Connects Socket.IO events directly to the streaming store.
 * Clean, direct mapping without message array manipulation.
 */

import { useCallback, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { validate as validateUUID } from 'uuid'
import {
  useWebSocketState,
  useCurrentAppId,
  useStartNewStream,
  useAppendTextSegment,
  useAddToolStartSegment,
  useAddToolCallSegment,
  useAddToolResultSegment,
  useMarkMaxStepsReached,
  useMarkUpstreamError,
  useFinalizeStream,
  useSetWebSocketState,
  useSetStreamingState,
  useSetIsLoading,
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore'
import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { useTodoListStore } from '@/stores/useTodoListStore'
import type { AgentsAppContext, AgentsAppChatMessage } from '../types/websocket-context'
import { captureVisualContext } from '../app/develop/components/visualContextCapture'
import { logImpressionEvent } from '@/utils/instrumentation'
import { logger } from '@/lib/request-context'
import { setSharedSocket, getSharedSocket } from '@/lib/socketRegistry'

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
      logger.error('websocket.token.missing_field', {
        message: 'WebSocket agent token response missing token field',
        responseData: data
      });
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

/**
 * Get conversationId from browser cookies
 * @returns Conversation ID string or null if not found or invalid
 */
function getConversationIdFromCookie(): string | null {
  if (typeof document === 'undefined') return null

  const cookies = document.cookie.split(';')
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=')
    if (name === 'conversationId' && value) {
      const decodedValue = decodeURIComponent(value)
      if (validateUUID(decodedValue)) {
        return decodedValue
      }
    }
  }
  return null
}

/**
 * Delete conversationId cookie from browser
 */
function deleteConversationIdCookie(): void {
  if (typeof document === 'undefined') return

  // Delete cookie by setting it with past expiration date
  document.cookie = 'conversationId=; path=/; max-age=0; SameSite=Lax'
}

export function useStreamingWebSocket() {
  const socketRef = useRef<Socket | null>(null)
  const createdHereRef = useRef<boolean>(false) // Track if this instance created the socket

  // Track retry state for APP_NOT_FOUND errors (race condition during app registration)
  const retryStateRef = useRef<{
    pendingMessage?: { content: string; aiEditContext?: any; startTime: number }
    retryCount: number
    retryTimer?: NodeJS.Timeout
  }>({ retryCount: 0 })
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
  const finalizeStream = useFinalizeStream()
  const setWebSocketState = useSetWebSocketState()
  const setStreamingState = useSetStreamingState()
  const setIsLoading = useSetIsLoading()
  const sendToolImpression = (tool: string) => logImpressionEvent(`develop.tool.${tool}`)()

  // Create Socket.IO connection (stable)
  const createConnection = useCallback(async (appId: string): Promise<Socket> => {
    return new Promise(async (resolve, reject) => {
      // Clean up existing socket first to prevent duplicate handlers
      if (socketRef.current) {
        logger.info('websocket.connection.cleanup', { message: 'Cleaning up existing socket before creating new one' })
        socketRef.current.removeAllListeners()
        socketRef.current.disconnect()
        socketRef.current = null
      }

      // Get the dynamic config to extract the baseUrl
      const { dynamicApiConfigService } = await import('../config/dynamic-api')
      const config = await dynamicApiConfigService.getConfigForSite(appId)
      const socketUrl = config.baseUrl
      logger.info('websocket.connection.create', { message: 'Creating Socket.IO connection', url: socketUrl })

      let authToken: string | null = null
      try {
        authToken = await getAgentJWTToken(appId)
      } catch (e) {
        logger.error('websocket.token.error', { message: 'Failed to get WebSocket JWT token', error: e instanceof Error ? e.message : String(e) })
      }

      const socketOptions: any = {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        randomizationFactor: 0.5
      }
      if (authToken) {
        socketOptions.auth = { token: authToken }
        socketOptions.extraHeaders = { Authorization: `Bearer ${authToken}` }
      }
      const socket = io(socketUrl, socketOptions)
      if (process.env.NODE_ENV === 'development') {
        socket.onAny((event, ...args) => logger.debug('websocket.event.incoming', { event, argsPreview: JSON.stringify(args).slice(0, 500), timestamp: Date.now() }))
        socket.onAnyOutgoing((event, ...args) => logger.debug('websocket.event.outgoing', { event, argsCount: args.length, timestamp: Date.now() }))
      }
      socket.on('connect', () => {
        setWebSocketState({ connected: true, status: 'idle' })
        resolve(socket)
      })
      socket.on('connect_error', (error) => {
        setWebSocketState({ connected: false, status: 'error', error: error.message })
        reject(error)
      })
      socket.on('disconnect', () => setWebSocketState({ connected: false, status: 'idle' }))
      socket.on('reconnect_attempt', () => setWebSocketState({ connected: false, status: 'connecting' }))
      socket.on('reconnect', () => setWebSocketState({ connected: true, status: 'idle' }))
      socket.on('reconnect_error', (error) => setWebSocketState({ connected: false, status: 'connecting', error: error.message }))
      socket.on('reconnect_failed', () => {
        setWebSocketState({ connected: false, status: 'error', error: 'Failed to reconnect' })
      })
    })
  }, [setWebSocketState])
  // Set up Socket.IO event handlers for streaming (defined before useEffect to satisfy dependency ordering)
  const setupEventHandlers = useCallback((socket: Socket) => {
    socket.on('status', (data) => {
      if (data.data?.status === 'thinking') {
        setWebSocketState({ status: 'streaming' })
        setStreamingState('streaming')
      }
    })
    socket.on('message', (data) => {
      switch (data.type) {
        case 'step_start':
          sendToolImpression('start')
          setStreamingState('streaming')
          break
        case 'chunk':
          appendTextSegment(data.content)
          break
        case 'tool_start':
          if (data.data?.tool) {
            const toolCall: ToolCall = {
              id: data.data.tool.id || `tool_${Date.now()}`,
              name: data.data.tool.name,
              input: data.data.tool.input || {},
              status: 'running',
              startTime: Date.now()
            }
            addToolStartSegment(toolCall)
          }
          break
        case 'tool_input_delta':
          // Tool input streaming delta - update partial input accumulation
          // Only require toolId and delta - toolName can be looked up from existing tool calls
          // Skip empty deltas (they don't add any information)
          if (data.data?.toolId && data.data?.delta !== undefined && data.data.delta.length > 0) {
            const updateToolDelta = useStreamingConversationStore.getState().updateToolDelta
            if (updateToolDelta) {
              // toolName might be undefined, but updateToolDelta can handle it
              const toolName = data.data.toolName || 'unknown-tool'
              updateToolDelta(data.data.toolId, toolName, data.data.delta)
            }
          }
          break
        case 'tool_call':
          // Tool call with complete input - update existing tool start segment
          if (data.data?.tool) {
            const toolCall: ToolCall = {
              id: data.data.tool.id,
              name: data.data.tool.name,
              input: data.data.tool.input || {},
              status: 'running'
            }
            addToolCallSegment(toolCall)
          }
          break
        case 'tool_result':
          if (data.data?.tool) {
            const hasError = data.data.tool.error || data.data.tool.is_error

            const toolCall: ToolCall = {
              id: data.data.tool.id,
              name: data.data.tool.name,
              input: data.data.tool.input || {},
              result: data.data.tool.output || data.data.tool.result,
              error: data.data.tool.error,
              status: hasError ? 'error' : 'completed',
              startTime: data.data.tool.startTime,
              endTime: Date.now()
            }
            sendToolImpression(data.data.tool.name)
            addToolResultSegment(toolCall)
            // Update persistent todo list if this is a todoList tool
            if (data.data.tool.name === 'todoList' && !hasError) {
              try {
                const { updateFromToolCall } = useTodoListStore.getState()
                updateFromToolCall(toolCall.result)
              } catch (error) {
                logger.error('websocket.todo-list.update.failure', {
                  error: error instanceof Error ? error.message : String(error)
                })
              }
            }
          }
          break
        case 'step_complete':
          if (data.data?.maxStepsReached === true) {
            logger.info('websocket.steps.max-reached', { message: 'Max steps reached - marking in state' })
            markMaxStepsReached()
          }
          break
        case 'complete':
          // Clear retry state on successful completion
          if (retryStateRef.current.retryTimer) {
            clearTimeout(retryStateRef.current.retryTimer)
          }
          retryStateRef.current = { retryCount: 0 }

          finalizeStream({
            agentId: data.data?.agentId,
            usage: data.data?.usage,
            totalSteps: data.data?.step
          })
          sendToolImpression('complete')
          setWebSocketState({ status: 'idle' })
          setStreamingState('idle')
          setIsLoading(false)
          // Send window message to trigger preview refresh
          window.postMessage({
            type: 'MESSAGE_COMPLETE',
            source: 'websocket'
          }, window.location.origin)
          break
        case 'error':
          // Check if this is an APP_NOT_FOUND error that we should retry
          const errorType = data.data?.errorType
          const isAppNotFound = errorType === 'APP_NOT_FOUND'
          const retryState = retryStateRef.current
          const elapsedTime = retryState.pendingMessage
            ? Date.now() - retryState.pendingMessage.startTime
            : 0
          const shouldRetry = isAppNotFound && elapsedTime < 10000 // Retry for up to 10 seconds

          if (shouldRetry && retryState.pendingMessage) {
            retryState.retryCount++
            const retryDelay = Math.min(500 * Math.pow(2, retryState.retryCount - 1), 2000) // Exponential backoff, max 2s

            logger.warn('websocket.error.app_not_found.retry', {
              message: 'App not found, will retry',
              retryCount: retryState.retryCount,
              retryDelay,
              elapsedTime,
              data
            })

            // Clear any existing retry timer
            if (retryState.retryTimer) {
              clearTimeout(retryState.retryTimer)
            }

            // Schedule retry
            retryState.retryTimer = setTimeout(() => {
              logger.info('websocket.error.app_not_found.retrying', {
                message: 'Retrying message after APP_NOT_FOUND error',
                retryCount: retryState.retryCount
              })

              // Re-send the message using the stored pending message
              const { content, aiEditContext } = retryState.pendingMessage!
              const socket = socketRef.current

              if (socket && socket.connected) {
                // Build the same rich context as in sendMessage
                const state = useStreamingConversationStore.getState()
                const { conversations } = state
                const currentConversation = conversations.find((conv: any) => conv.appId === currentAppId)
                let conversationId = currentConversation?.id

                // If conversationId is null, check cookie and delete it
                if (!conversationId) {
                  conversationId = getConversationIdFromCookie()
                  if (conversationId) {
                    deleteConversationIdCookie()
                  }
                }

                const richContext: AgentsAppContext = {
                  metadata: {
                    appId: currentAppId,
                    userId: 'current-user',
                    sessionId: socket.id
                  },
                  conversation: {
                    conversationId,
                    maxMessages: 10,
                    includeHistory: true
                  },
                  appContext: {
                    includeDirectoryListing: true,
                    includePackageInfo: true,
                    includeDependencyStatus: true,
                    maxDirectoryDepth: 3
                  },
                  ...(aiEditContext && { aiEditContext })
                }

                const chatMessage: AgentsAppChatMessage = {
                  message: content,
                  timestamp: new Date().toISOString(),
                  agentId: 'develop',
                  context: richContext
                }

                socket.emit('chat_message', chatMessage)
              }
            }, retryDelay)
          } else {
            // Not retryable or exceeded retry time - show error
            if (isAppNotFound && elapsedTime >= 10000) {
              logger.error('websocket.error.app_not_found.timeout', {
                message: 'App not found after 10 seconds of retries',
                retryCount: retryState.retryCount,
                elapsedTime
              })
            } else {
              logger.error('websocket.error', { message: 'Socket.IO error', data })
            }

            // Clear retry state
            if (retryState.retryTimer) {
              clearTimeout(retryState.retryTimer)
            }
            retryStateRef.current = { retryCount: 0 }

            markUpstreamError();
            sendToolImpression('error')
            setWebSocketState({ status: 'error', error: data.content })
            setStreamingState('error')
            setIsLoading(false)
          }
          break
        default:
          break
      }
    })
  }, [
    appendTextSegment,
    addToolStartSegment,
    addToolResultSegment,
    addToolCallSegment,
    markMaxStepsReached,
    markUpstreamError,
    finalizeStream,
    setWebSocketState,
    setStreamingState,
    setIsLoading,
    currentAppId,
  ])

  useEffect(() => {
    // Effect intentionally depends ONLY on currentAppId to avoid recreating connection on stable callback identity changes.
    // createConnection & setupEventHandlers are stable (useCallback with static deps) and exclusion prevents unnecessary reconnects.
    if (!currentAppId) return

    const initializeConnection = async () => {
      const initAppId = currentAppId
      try {
        logger.info('websocket.connection.initialize', {
          message: 'Initializing persistent WebSocket connection',
          appId: initAppId
        })

        const socket = await createConnection(initAppId)

        // Check if app changed during async initialization
        const currentState = useStreamingConversationStore.getState()
        if (currentState.currentAppId !== initAppId) {
          logger.info('websocket.connection.abort', {
            message: 'App changed during initialization, aborting socket setup',
            initAppId,
            currentAppId: currentState.currentAppId
          })
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

        logger.info('websocket.connection.ready', {
          message: 'Persistent WebSocket connection established and ready',
          appId: initAppId,
          socketId: socket.id
        })
      } catch (error) {
        logger.error('websocket.connection.init_failed', {
          message: 'Failed to initialize persistent connection',
          error: error instanceof Error ? error.message : String(error),
          appId: initAppId
        })
      } finally {
        initializingRef.current = false
      }
    }

    // Reuse existing shared socket if available (prevents duplicate connections)
    const existingSocket = getSharedSocket()
    if (existingSocket && !socketRef.current) {
      logger.info('websocket.connection.reuse', {
        message: 'Reusing existing shared socket',
        socketId: existingSocket.id,
        appId: currentAppId
      })
      socketRef.current = existingSocket
      createdHereRef.current = false // We didn't create this socket
      return
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
    return () => {
      // Clear initialization timer if pending
      if (initTimerRef.current) {
        clearTimeout(initTimerRef.current)
        initTimerRef.current = null
        // Reset initialization flag if timer is cleared before initialization
        initializingRef.current = false
      }

      if (socketRef.current) {
        // Only disconnect and clear shared socket if this instance created it
        if (createdHereRef.current && getSharedSocket() === socketRef.current) {
          logger.info('websocket.cleanup', {
            message: 'Cleaning up Socket.IO connection (created by this instance)',
            reason: 'app change or unmount',
            appId: currentAppId
          })

          // Clear shared socket reference
          setSharedSocket(null)

          socketRef.current.removeAllListeners()
          socketRef.current.disconnect()
        } else {
          logger.info('websocket.cleanup.skip', {
            message: 'Not cleaning up socket (reused from shared registry)',
            appId: currentAppId
          })
        }

        socketRef.current = null
        createdHereRef.current = false
      }
      // Reset initialization flag to allow re-initialization with new appId
      initializingRef.current = false
    }
    // Including createConnection & setupEventHandlers satisfies exhaustive-deps; guard prevents duplicate initialization.
  }, [currentAppId, createConnection, setupEventHandlers])


  /**
   * Send message - the main streaming function
   */
  const sendMessage = useCallback(async (
    content: string,
    aiEditContext?: any,
    selectedAsset?: any
  ) => {
    if (!content.trim() || !currentAppId) return

    try {
      setIsLoading(true)
      setStreamingState('streaming')

      // Store message for potential retry on APP_NOT_FOUND error
      retryStateRef.current = {
        pendingMessage: { content, aiEditContext, startTime: Date.now() },
        retryCount: 0
      }

      // Start new stream (adds user message + creates activeStream)
      startNewStream(content)

      // Reuse existing Socket.IO connection
      const socket = socketRef.current

      if (!socket) {
        throw new Error('WebSocket connection not initialized. Please wait for connection to establish.')
      }

      if (!socket.connected) {
        throw new Error('WebSocket not connected. Connection may be reconnecting...')
      }

      logger.info('websocket.message.send', {
        message: 'Sending Socket.IO message using existing connection',
        appId: currentAppId,
        socketId: socket.id
      })

      // Get current state for rich context
      const state = useStreamingConversationStore.getState()
      const { conversations, buildErrorContext } = state

      // Find current conversation ID
      const currentConversation = conversations.find((conv: any) => conv.appId === currentAppId)
      let conversationId = currentConversation?.id

      // If conversationId is null, check cookie and delete it
      if (!conversationId) {
        conversationId = getConversationIdFromCookie()
        if (conversationId) {
          deleteConversationIdCookie()
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

      // Build rich context object with proper typing
      const richContext: AgentsAppContext = {
        // Basic metadata
        metadata: {
          appId: currentAppId,
          userId: 'current-user', // TODO: Get from auth context
          sessionId: socket.id
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

        // AI Edit context if available
        ...(aiEditContext && { aiEditContext }),

        // Build error context if available (from publish failures)
        ...(buildErrorContext && {
          buildError: {
            error: buildErrorContext.error,
            details: buildErrorContext.details,
            exitCode: buildErrorContext.exitCode
          }
        }),

        // Visual context from iframe
        ...(visualContext && { visualContext }),

        // Selected assets from Asset Manager
        ...(transformedAsset && { selectedAssets: [transformedAsset] }),
      }

      // Send the message to start streaming with rich context
      const chatMessage: AgentsAppChatMessage = {
        message: content,
        timestamp: new Date().toISOString(),
        agentId: 'develop', // Default agent
        context: richContext
      }

      // Use Socket.IO acknowledgement for delivery confirmation
      socket.emit('chat_message', chatMessage, (response: any) => {
        if (response?.status === 'ok') {
          logger.info('websocket.message.acknowledged', {
            message: 'Message delivery confirmed by server',
            messageLength: content.length
          })
        } else if (response?.error) {
          logger.error('websocket.message.ack_error', {
            message: 'Server rejected message',
            error: response.error
          })
        }
      })

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('websocket.message.failure', { message: 'Failed to send message', error: errorMessage })

      setWebSocketState({
        status: 'error',
        error: errorMessage
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
