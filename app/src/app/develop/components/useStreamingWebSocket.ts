/**
 * Streaming WebSocket Hook
 * 
 * Connects Socket.IO events directly to the streaming store.
 * Clean, direct mapping without message array manipulation.
 */

import { useCallback, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { buildDynamicApiUrl } from '../../../config/dynamic-api'
import { 
  useWebSocketState, 
  useCurrentAppId,
  useStartNewStream,
  useAppendTextSegment,
  useAddToolStartSegment,
  useAddToolResultSegment,
  useFinalizeStream,
  useSetWebSocketState,
  useSetStreamingState,
  useSetIsLoading
} from './streamingConversationStore'
import type { ToolCall } from './streamingConversationStore'
import { useStreamingConversationStore } from './streamingConversationStore'
import type { AgentsAppContext, AgentsAppChatMessage } from '../../../types/websocket-context'
import { captureVisualContext } from './visualContextCapture'

export function useStreamingWebSocket() {
  const socketRef = useRef<Socket | null>(null)
  const webSocketState = useWebSocketState()
  const currentAppId = useCurrentAppId()
  
  const startNewStream = useStartNewStream()
  const appendTextSegment = useAppendTextSegment()
  const addToolStartSegment = useAddToolStartSegment()
  const addToolResultSegment = useAddToolResultSegment()
  const finalizeStream = useFinalizeStream()
  const setWebSocketState = useSetWebSocketState()
  const setStreamingState = useSetStreamingState()
  const setIsLoading = useSetIsLoading()

  /**
   * Ensure we're on the latest git commit before sending messages
   */
  const ensureLatestCommit = useCallback(async (appId: string) => {
    try {
      const apiUrl = await buildDynamicApiUrl(`/api/apps/${appId}/git/return`, appId)
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      
      if (!response.ok) {
        console.warn('⚠️ Git return request failed (non-blocking):', response.status)
      }
    } catch (error) {
      console.warn('⚠️ Git return error (non-blocking):', error)
    }
  }, [])

  /**
   * Create Socket.IO connection
   */
  const createConnection = useCallback(async (appId: string): Promise<Socket> => {
    return new Promise(async (resolve, reject) => {
      // Get the dynamic config to extract the baseUrl
      const { dynamicApiConfigService } = await import('../../../config/dynamic-api')
      const config = await dynamicApiConfigService.getConfigForSite(appId)
      
      // Socket.IO connects to the base URL, not the app-specific URL
      const socketUrl = config.baseUrl
      console.log('🔌 Creating Socket.IO connection to:', socketUrl)
      
      const socket = io(socketUrl, {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        autoConnect: true
      })

      socket.on('connect', () => {
        console.log('🔌 Socket.IO connected')
        setWebSocketState({ connected: true, status: 'idle' })
        resolve(socket)
      })

      socket.on('connect_error', (error) => {
        console.error('🔌 Socket.IO connection error:', error)
        setWebSocketState({ connected: false, status: 'error', error: error.message })
        reject(new Error(`Failed to connect to Socket.IO: ${error.message}`))
      })

      socket.on('disconnect', (reason) => {
        console.log('🔌 Socket.IO disconnected:', reason)
        setWebSocketState({ connected: false, status: 'idle' })
      })

      // Listen for agent availability
      socket.on('agents_available', (data) => {
        console.log('🤖 Available agents:', data.agents)
        console.log('🎯 Default agent:', data.defaultAgent)
      })
    })
  }, [setWebSocketState])

  /**
   * Set up Socket.IO event handlers for streaming
   */
  const setupEventHandlers = useCallback((socket: Socket) => {
    // Status updates
    socket.on('status', (data) => {
      console.log('📊 Status:', data.data?.status, data.content)
      
      if (data.data?.status === 'thinking') {
        setWebSocketState({ status: 'streaming' })
        setStreamingState('streaming')
      }
    })

    // Handle all events through the 'message' wrapper
    socket.on('message', (data) => {
      switch (data.type) {
        case 'step_start':
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
            
            addToolResultSegment(toolCall)
          }
          break
          
        case 'step_complete':
          break
          
        case 'complete':
          
          // Clean finalization - move activeStream to messages array
          finalizeStream({
            agentId: data.data?.agentId,
            usage: data.data?.usage,
            totalSteps: data.data?.step
          })
          
          setWebSocketState({ status: 'idle' })
          setStreamingState('idle')
          setIsLoading(false)
          break
          
        case 'error':
          console.error('❌ Socket.IO error:', data)
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

      console.log('📤 Sending Socket.IO message for app:', currentAppId)

      // Get current state for rich context
      const state = useStreamingConversationStore.getState()
      const { conversations } = state
      
      // Find current conversation ID
      const currentConversation = conversations.find((conv: any) => conv.appId === currentAppId)
      const conversationId = currentConversation?.id
      
      // Capture visual context from iframe
      console.log('📸 Capturing visual context from iframe...')
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
      
      console.log('📤 Sending message with rich context:', {
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
      console.error('❌ Failed to send message:', error)
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
        console.log('🧹 Cleaning up Socket.IO connection')
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
