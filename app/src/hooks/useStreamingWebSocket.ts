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
  useStreamingConversationStore
} from '@/stores/useStreamingConversationStore'
import type { ToolCall } from '@/stores/useStreamingConversationStore'
import type { AgentsAppContext, AgentsAppChatMessage } from '../types/websocket-context'
import { captureVisualContext } from '../app/develop/components/visualContextCapture'
import { logImpressionEvent } from '@/utils/instrumentation'
import { logger } from '@/lib/request-context'

/**
 * Get JWT token for Socket.IO authentication using our new JWT system
 */
const getAgentJWTToken = async (siteId: string): Promise<string | null> => {
  if (typeof document === 'undefined') return null;
  
  try {
    const response = await fetch('/api/auth/agent-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId })
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
  const webSocketState = useWebSocketState()
  const currentAppId = useCurrentAppId()
  
  const startNewStream = useStartNewStream()
  const appendTextSegment = useAppendTextSegment()
  const addToolStartSegment = useAddToolStartSegment()
  const addToolResultSegment = useAddToolResultSegment()
  const markMaxStepsReached = useMarkMaxStepsReached()
  const finalizeStream = useFinalizeStream()
  const setWebSocketState = useSetWebSocketState()
  const setStreamingState = useSetStreamingState()
  const setIsLoading = useSetIsLoading()

  const sendToolImpression = (tool: string) => logImpressionEvent({ eid: `develop.tool.${tool}` })()

  /**
   * Ensure we're on the latest git commit before sending messages
   */
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

  /**
   * Create Socket.IO connection
   */
  const createConnection = useCallback(async (appId: string): Promise<Socket> => {
    return new Promise(async (resolve, reject) => {
      // Get the dynamic config to extract the baseUrl
      const { dynamicApiConfigService } = await import('../config/dynamic-api')
      const config = await dynamicApiConfigService.getConfigForSite(appId)
      
      // Socket.IO connects to the base URL, not the app-specific URL
      const socketUrl = config.baseUrl
      logger.info('websocket.connection.create', { message: 'Creating Socket.IO connection', url: socketUrl })
      
      // Get JWT token for WebSocket authentication using our new system
      let authToken = null;
      try {
        // Use appId parameter directly - it comes from the URL params and is always available
        if (!appId) {
          throw new Error('Unable to determine appId for WebSocket authentication - appId is required');
        }
        
        logger.info('websocket.token.request', { 
          message: 'Requesting JWT token for WebSocket connection',
          appId,
          currentAppId,
          appIdFromParams: appId
        });
        
        authToken = await getAgentJWTToken(appId);
        
        if (!authToken) {
          logger.error('websocket.token.missing', { 
            message: 'No JWT token received - WebSocket connection will fail',
            appId 
          });
        } else {
          logger.info('websocket.token.success', { 
            message: 'JWT token received successfully for WebSocket',
            tokenLength: authToken.length,
            tokenPreview: authToken.substring(0, 20) + '...',
            appId
          });
        }
      } catch (error) {
        logger.error('websocket.token.error', { 
          message: 'Failed to get WebSocket JWT token - connection will fail', 
          error: error instanceof Error ? error.message : String(error)
        });
      }
      
      // Create Socket.IO connection with JWT authentication
      const socketOptions: any = {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        autoConnect: true
      };
      
      // Add JWT authentication (Socket.IO specific way)
      if (authToken) {
        // Use auth object - Socket.IO will send this in handshake.auth
        // The agent-side middleware needs to check handshake.auth.token
        socketOptions.auth = {
          token: authToken
        };
        
        // Also try extraHeaders for polling transport fallback
        socketOptions.extraHeaders = {
          'Authorization': `Bearer ${authToken}`
        };
        
        logger.info('websocket.connection.jwt', { 
          message: 'Socket.IO connection configured with JWT authentication via auth object and extraHeaders',
          tokenLength: authToken.length,
          socketUrl,
          authMethods: ['auth.token', 'extraHeaders.Authorization']
        });
      } else {
        logger.error('websocket.connection.no-auth', { 
          message: 'Socket.IO connection will proceed without JWT authentication - connection will fail' 
        });
      }
      
      const socket = io(socketUrl, socketOptions)

      socket.on('connect', () => {
        logger.info('websocket.connection.success', { message: 'Socket.IO connected' })
        setWebSocketState({ connected: true, status: 'idle' })
        resolve(socket)
      })

      socket.on('connect_error', (error) => {
        logger.error('websocket.connection.error', { message: 'Socket.IO connection error', error: error.message })
        setWebSocketState({ connected: false, status: 'error', error: error.message })
        reject(new Error(`Failed to connect to Socket.IO: ${error.message}`))
      })

      socket.on('disconnect', (reason) => {
        logger.info('websocket.connection.disconnect', { message: 'Socket.IO disconnected', reason })
        setWebSocketState({ connected: false, status: 'idle' })
      })

      // Listen for agent availability
      socket.on('agents_available', (data) => {
        logger.info('websocket.agents.available', { message: 'Available agents', agents: data.agents, defaultAgent: data.defaultAgent })
      })
    })
  }, [setWebSocketState])

  /**
   * Set up Socket.IO event handlers for streaming
   */
  const setupEventHandlers = useCallback((socket: Socket) => {
    // Status updates
    socket.on('status', (data) => {
      logger.debug('websocket.status', { message: 'Status update', status: data.data?.status, content: data.content })
      
      if (data.data?.status === 'thinking') {
        setWebSocketState({ status: 'streaming' })
        setStreamingState('streaming')
      }
    })

    // Handle all events through the 'message' wrapper
    socket.on('message', (data) => {
      switch (data.type) {
        case 'step_start':
          sendToolImpression('start')
          setStreamingState('streaming')
          break
          
        case 'chunk':
          // Direct streaming update - no message array manipulation
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
            const toolCall: ToolCall = {
              id: data.data.tool.id,
              name: data.data.tool.name,
              input: data.data.tool.input || {},
              result: data.data.tool.output || data.data.tool.result,
              status: 'completed',
              startTime: data.data.tool.startTime,
              endTime: Date.now()
            }

            sendToolImpression(data.data.tool.name)
            addToolResultSegment(toolCall)
          }
          break
          
        case 'step_complete':
          // Check if this step completion indicates max steps reached
          if (data.data?.maxStepsReached === true) {
            logger.info('websocket.steps.max-reached', { message: 'Max steps reached - marking in state' })
            markMaxStepsReached()
          }
          break
          
        case 'complete':
          
          // Clean finalization - move activeStream to messages array
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
          break
          
        default:
          // Unknown message type - silently ignore
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
    setIsLoading
  ])

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

      // Ensure we're on the latest commit
      await ensureLatestCommit(currentAppId)

      // Start new stream (adds user message + creates activeStream)
      startNewStream(content)

      // Create Socket.IO connection
      const socket = await createConnection(currentAppId)
      socketRef.current = socket

      // Set up streaming event handlers
      setupEventHandlers(socket)

      logger.info('websocket.message.send', { message: 'Sending Socket.IO message for app', appId: currentAppId })

      // Get current state for rich context
      const state = useStreamingConversationStore.getState()
      const { conversations } = state
      
      // Find current conversation ID
      const currentConversation = conversations.find((conv: any) => conv.appId === currentAppId)
      const conversationId = currentConversation?.id
      
      // Capture visual context from iframe
      logger.debug('websocket.visual-context.capture', { message: 'Capturing visual context from iframe' })
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
      
      logger.debug('websocket.message.details', {
        message: 'Sending message with rich context',
        messageLength: content.length,
        hasAiEditContext: !!aiEditContext,
        hasVisualContext: !!visualContext,
        conversationId,
        contextKeys: Object.keys(richContext),
        visualContextDetails: visualContext ? {
          page: visualContext.page,
          activeSection: visualContext.active_section,
          scrollY: visualContext.scroll_position.y
        } : null
      })

      // Send the message to start streaming with rich context
      const chatMessage: AgentsAppChatMessage = {
        message: content,
        timestamp: new Date().toISOString(),
        agentId: 'develop', // Default agent
        context: richContext
      }
      
      socket.emit('chat_message', chatMessage)

    } catch (error) {
      logger.error('websocket.message.failure', { message: 'Failed to send message', error: error instanceof Error ? error.message : String(error) })
      setWebSocketState({ 
        status: 'error', 
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      setStreamingState('error')
      setIsLoading(false)
    }
  }, [
    currentAppId,
    ensureLatestCommit,
    startNewStream,
    createConnection,
    setupEventHandlers,
    setIsLoading,
    setStreamingState,
    setWebSocketState
  ])

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        logger.info('websocket.cleanup', { message: 'Cleaning up Socket.IO connection' })
        socketRef.current.disconnect()
        socketRef.current = null
      }
    }
  }, [])

  /**
   * Disconnect socket when app changes
   */
  useEffect(() => {
    if (socketRef.current && currentAppId) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
  }, [currentAppId])

  return {
    sendMessage,
    webSocketState,
    isConnected: webSocketState.connected,
    isStreaming: webSocketState.status === 'streaming'
  }
}
