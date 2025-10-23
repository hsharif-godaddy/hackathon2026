/**
 * Streaming WebSocket Hook
 *
 * Connects Socket.IO events directly to the streaming store.
 * Clean, direct mapping without message array manipulation.
 */

import { useCallback, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { buildDynamicApiUrl } from '../config/dynamic-api'
import { agentFetch } from '../lib/agent-fetch'
import {
  useWebSocketState,
  useCurrentAppId,
  useStartNewStream,
  useAppendTextSegment,
  useAddToolStartSegment,
  useAddToolResultSegment,
  useMarkMaxStepsReached,
  useFinalizeStream,
  useSetWebSocketState,
  useSetStreamingState,
  useSetIsLoading,
  useSetErrorState,
  useStreamingConversationStore
} from '@/stores/useStreamingConversationStore'
import type { ToolCall } from '@/stores/useStreamingConversationStore'
import type { AgentsAppContext, AgentsAppChatMessage } from '../types/websocket-context'
import { captureVisualContext } from '../app/develop/components/visualContextCapture'
import { logImpressionEvent } from '@/utils/instrumentation'
import { logger } from '@/lib/request-context'

/**
 * Get short-lived JWT token for WebSocket authentication (5 minutes)
 */
const getAgentJWTToken = async (siteId: string): Promise<string | null> => {
  if (typeof document === 'undefined') return null;

  try {
    const response = await fetch('/api/auth/agent-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, expiresInSeconds: 300 })
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

export function useStreamingWebSocket() {
  const socketRef = useRef<Socket | null>(null)
  const lastMessageRef = useRef<{ content: string; context?: any } | null>(null)
  // Guard flag to prevent concurrent initialization attempts
  const initializingRef = useRef<boolean>(false)
  const webSocketState = useWebSocketState()
  const currentAppId = useCurrentAppId()
  // Hook setters & streaming state (declared early for use in callbacks)
  const startNewStream = useStartNewStream()
  const appendTextSegment = useAppendTextSegment()
  const addToolStartSegment = useAddToolStartSegment()
  const addToolResultSegment = useAddToolResultSegment()
  const markMaxStepsReached = useMarkMaxStepsReached()
  const finalizeStream = useFinalizeStream()
  const setWebSocketState = useSetWebSocketState()
  const setStreamingState = useSetStreamingState()
  const setIsLoading = useSetIsLoading()
  const setErrorState = useSetErrorState()
  const sendToolImpression = (tool: string) => logImpressionEvent(`develop.tool.${tool}`)()

  // Ensure latest commit before starting streaming (stable)
  const ensureLatestCommit = useCallback(async (appId: string) => {
    try {
      const apiUrl = await buildDynamicApiUrl(`/git/return`, appId)
      const response = await agentFetch(apiUrl, {
        siteId: appId,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      if (!response.ok) {
        logger.warn('websocket.git-return.failure', { message: 'Git return request failed (non-blocking)', status: response.status })
      }
    } catch (error) {
      logger.warn('websocket.git-return.error', { message: 'Git return error (non-blocking)', error: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  // Create Socket.IO connection (stable)
  const createConnection = useCallback(async (appId: string): Promise<Socket> => {
    return new Promise(async (resolve, reject) => {
      if (socketRef.current) {
        socketRef.current.removeAllListeners()
        socketRef.current.disconnect()
        socketRef.current = null
      }
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
        if (lastMessageRef.current) {
          setErrorState(`Connection failed: ${error.message}`, lastMessageRef.current.content, lastMessageRef.current.context)
        }
        reject(error)
      })
      socket.on('disconnect', () => setWebSocketState({ connected: false, status: 'idle' }))
      socket.on('reconnect_attempt', () => setWebSocketState({ connected: false, status: 'connecting' }))
      socket.on('reconnect', () => setWebSocketState({ connected: true, status: 'idle' }))
      socket.on('reconnect_error', (error) => setWebSocketState({ connected: false, status: 'connecting', error: error.message }))
      socket.on('reconnect_failed', () => {
        setWebSocketState({ connected: false, status: 'error', error: 'Failed to reconnect' })
        if (lastMessageRef.current) {
          setErrorState('Connection lost. Please try again.', lastMessageRef.current.content, lastMessageRef.current.context)
        }
      })
    })
  }, [setWebSocketState, setErrorState])
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
          }
          break
        case 'step_complete':
          if (data.data?.maxStepsReached === true) {
            logger.info('websocket.steps.max-reached', { message: 'Max steps reached - marking in state' })
            markMaxStepsReached()
          }
          break
        case 'complete':
          finalizeStream({
            agentId: data.data?.agentId,
            usage: data.data?.usage,
            totalSteps: data.data?.step
          })
          sendToolImpression('complete')
          setWebSocketState({ status: 'idle' })
          setStreamingState('idle')
          setIsLoading(false)
          break
        case 'error':
          logger.error('websocket.error', { message: 'Socket.IO error', data })
          sendToolImpression('error')
          setWebSocketState({ status: 'error', error: data.content })
          setStreamingState('error')
          setIsLoading(false)
          if (lastMessageRef.current) {
            setErrorState(
              data.content || 'An error occurred during streaming',
              lastMessageRef.current.content,
              lastMessageRef.current.context
            )
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
    markMaxStepsReached,
    finalizeStream,
    setWebSocketState,
    setStreamingState,
    setIsLoading,
    setErrorState
  ])

  useEffect(() => {
    // Effect intentionally depends ONLY on currentAppId to avoid recreating connection on stable callback identity changes.
    // createConnection & setupEventHandlers are stable (useCallback with static deps) and exclusion prevents unnecessary reconnects.
    if (!currentAppId) return

    const initializeConnection = async () => {
      try {
        logger.info('websocket.connection.initialize', {
          message: 'Initializing persistent WebSocket connection',
          appId: currentAppId
        })

        const socket = await createConnection(currentAppId)
        socketRef.current = socket

        // Set up event handlers once for the lifetime of this connection
        setupEventHandlers(socket)

        logger.info('websocket.connection.ready', {
          message: 'Persistent WebSocket connection established and ready',
          appId: currentAppId,
          socketId: socket.id
        })
      } catch (error) {
        logger.error('websocket.connection.init_failed', {
          message: 'Failed to initialize persistent connection',
          error: error instanceof Error ? error.message : String(error),
          appId: currentAppId
        })
      } finally {
        initializingRef.current = false
      }
    }

    // Only create connection if we don't have one and not already initializing
    if (!socketRef.current && !initializingRef.current) {
      initializingRef.current = true
      void initializeConnection()
    }

    // Cleanup when app changes or component unmounts
    return () => {
      if (socketRef.current) {
        logger.info('websocket.cleanup', {
          message: 'Cleaning up Socket.IO connection',
          reason: 'app change or unmount',
          appId: currentAppId
        })
        socketRef.current.removeAllListeners()
        socketRef.current.disconnect()
        socketRef.current = null
      }
    }
    // Including createConnection & setupEventHandlers satisfies exhaustive-deps; guard prevents duplicate initialization.
  }, [currentAppId, createConnection, setupEventHandlers])


  /**
   * Send message - the main streaming function
   */
  const sendMessage = useCallback(async (
    content: string,
    aiEditContext?: any
  ) => {
    if (!content.trim() || !currentAppId) return

    try {
      setIsLoading(true)
      setStreamingState('streaming')

      // Store message details for potential retry
      lastMessageRef.current = {
        content,
        context: aiEditContext
      }

      // Ensure we're on the latest commit
      await ensureLatestCommit(currentAppId)

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
      const { conversations } = state

      // Find current conversation ID
      const currentConversation = conversations.find((conv: any) => conv.appId === currentAppId)
      const conversationId = currentConversation?.id

      // Capture visual context from iframe
      const visualContext = await captureVisualContext()

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

        // Visual context from iframe
        ...(visualContext && { visualContext }),
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
          // Clear lastMessageRef on successful delivery confirmation
          lastMessageRef.current = null
        } else if (response?.error) {
          logger.error('websocket.message.ack_error', {
            message: 'Server rejected message',
            error: response.error
          })
          // Keep lastMessageRef for potential retry
          setErrorState(
            response.error,
            lastMessageRef.current?.content || content,
            lastMessageRef.current?.context || aiEditContext
          )
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

      // Set error state for retry
      if (lastMessageRef.current) {
        setErrorState(
          errorMessage,
          lastMessageRef.current.content,
          lastMessageRef.current.context
        )
      }
    }
  }, [
    currentAppId,
    ensureLatestCommit,
    startNewStream,
    setIsLoading,
    setStreamingState,
    setWebSocketState,
    setErrorState
  ])

  /**
   * Retry message - specifically for error recovery
   * Differs from sendMessage by NOT creating duplicate user messages
   * Socket.IO auto-reconnection handles connection state automatically
   */
  const retrySendMessage = useCallback(async (
    content: string,
    aiEditContext?: any
  ) => {
    if (!content.trim() || !currentAppId) return

    try {
      setIsLoading(true)
      setStreamingState('streaming')

      // Store message details for potential future retry
      lastMessageRef.current = {
        content,
        context: aiEditContext
      }

      // Ensure we're on the latest commit
      await ensureLatestCommit(currentAppId)

      // IMPORTANT: Do NOT call startNewStream here!
      // The user message already exists from the original failed attempt

      // Socket.IO auto-reconnection means socket should already be connected
      // or is in the process of reconnecting
      const socket = socketRef.current

      if (!socket) {
        throw new Error('No socket connection available')
      }

      if (!socket.connected) {
        logger.info('websocket.retry.waiting', {
          message: 'Socket not connected, relying on Socket.IO auto-reconnection',
          socketId: socket.id
        })
        // Socket.IO will automatically reconnect and our effect will retry
        return
      }

      logger.info('websocket.retry.send', {
        message: 'Socket connected, sending retry message',
        socketId: socket.id,
        appId: currentAppId
      })

      // Get current state for rich context
      const state = useStreamingConversationStore.getState()
      const { conversations } = state

      // Find current conversation ID
      const currentConversation = conversations.find((conv: any) => conv.appId === currentAppId)
      const conversationId = currentConversation?.id

      // Capture visual context from iframe
      const visualContext = await captureVisualContext()

      // Build rich context object
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
        ...(aiEditContext && { aiEditContext }),
        ...(visualContext && { visualContext }),
      }

      // Send the retry message with acknowledgement
      const chatMessage: AgentsAppChatMessage = {
        message: content,
        timestamp: new Date().toISOString(),
        agentId: 'develop',
        context: richContext
      }

      socket.emit('chat_message', chatMessage, (response: any) => {
        if (response?.status === 'ok') {
          logger.info('websocket.retry.acknowledged', {
            message: 'Retry message delivery confirmed by server',
            messageLength: content.length
          })
          // Clear lastMessageRef on successful delivery confirmation
          lastMessageRef.current = null
        } else if (response?.error) {
          logger.error('websocket.retry.ack_error', {
            message: 'Server rejected retry message',
            error: response.error
          })
          // Keep lastMessageRef for another potential retry
          setErrorState(
            response.error,
            lastMessageRef.current?.content || content,
            lastMessageRef.current?.context || aiEditContext
          )
        }
      })

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('websocket.retry.failure', { message: 'Retry failed', error: errorMessage })

      setWebSocketState({
        status: 'error',
        error: errorMessage
      })
      setStreamingState('error')
      setIsLoading(false)

      // Set error state for another retry attempt
      if (lastMessageRef.current) {
        setErrorState(
          errorMessage,
          lastMessageRef.current.content,
          lastMessageRef.current.context
        )
      }
    }
  }, [
    currentAppId,
    ensureLatestCommit,
    setIsLoading,
    setStreamingState,
    setWebSocketState,
    setErrorState
  ])

  /**
   * Auto-retry pending message after successful reconnection
   */
  useEffect(() => {
    // retrySendMessage is included because it is used in handleReconnect; not just to satisfy exhaustive-deps.
    const socket = socketRef.current
    if (!socket) return

    const handleReconnect = () => {
      if (lastMessageRef.current) {
        logger.info('websocket.reconnection.auto_retry', {
          message: 'Auto-retrying pending message after reconnection'
        })
        retrySendMessage(
          lastMessageRef.current.content,
          lastMessageRef.current.context
        )
      }
    }

    socket.on('reconnect', handleReconnect)

    return () => {
      socket.off('reconnect', handleReconnect)
    }
  }, [retrySendMessage])

  /**
   * Listen for retry events from the store
   */
  useEffect(() => {
    const handleRetry = async (event: CustomEvent) => {
      const { message, context, appId } = event.detail

      // Only handle retry for current app
      if (appId !== currentAppId) {
        logger.warn('websocket.retry.app-mismatch', {
          message: 'Retry event for different app',
          eventAppId: appId,
          currentAppId
        })
        return
      }

      logger.info('websocket.retry.start', {
        message: 'Starting retry',
        messagePreview: message.slice(0, 50) + '...',
        hasContext: !!context
      })

      // Use retrySendMessage to avoid duplicates
      await retrySendMessage(message, context)
    }

    window.addEventListener('airo-retry-message', handleRetry as EventListener)

    return () => {
      window.removeEventListener('airo-retry-message', handleRetry as EventListener)
    }
  }, [currentAppId, retrySendMessage])

  return {
    sendMessage,
    webSocketState,
    isConnected: webSocketState.connected,
    isStreaming: webSocketState.status === 'streaming'
  }
}
