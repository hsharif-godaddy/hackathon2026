import { useEffect, useCallback, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { 
  useConversationActions,
  useWebSocketState,
  useConversationStore,
  type ChatMessage,
  type ToolCall
} from '../stores/conversationStore'
import type { UploadedFile } from '../components/FileUpload'

export function useWebSocketWithStore() {
  const socketRef = useRef<Socket | null>(null)
  const websocketState = useWebSocketState()
  
  const {
    addMessage,
    updateMessage,
    setCurrentMessage,
    appendToCurrentMessage,
    addToolCallToCurrentMessage,
    updateToolCallInCurrentMessage,
    finalizeCurrentMessage,
    addTextSegmentToCurrentMessage,
    addToolSegmentToCurrentMessage,
    updateToolSegmentInCurrentMessage,
    setWebSocketState,
    setCurrentStep,
    updateCurrentStep,
    clearMessages
  } = useConversationActions()

  useEffect(() => {
    // Initialize socket connection
    const socket = io(process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000', {
      transports: ['websocket', 'polling']
    })
    
    socketRef.current = socket

    socket.on('connect', () => {
      setWebSocketState({ connected: true })
    })

    socket.on('disconnect', () => {
      setWebSocketState({ connected: false })
    })

    socket.on('status', (data) => {
      setWebSocketState({ status: data.data?.status || 'idle' })
    })

    // Streaming event handlers
    socket.on('step_start', (data) => {
      setCurrentStep({
        step: data.data?.step || 1,
        content: '',
        toolCalls: []
      })
    })

    socket.on('chunk', (data) => {
      // Add text as a chronological segment
      addTextSegmentToCurrentMessage(data.content)
      
      // Update current step content
      updateCurrentStep({ content: data.content })
    })

    socket.on('tool_start', (data) => {
      // Add tool call as a chronological segment
      const toolCall: ToolCall = {
        ...data.data.tool,
        status: 'running'
        // Don't set result: null - leave it undefined for running state
      }
      
      addToolSegmentToCurrentMessage(toolCall)
    })

    socket.on('tool_result', (data) => {
      // Update the tool call segment with its result
      updateToolSegmentInCurrentMessage(data.data.tool.id, {
        result: data.data.tool.result,
        status: 'completed'
      })
    })

    socket.on('step_complete', (data) => {
      // Step completion - update current step
      updateCurrentStep({
        content: data.content,
        toolCalls: data.data?.toolCalls || []
      })
    })

    socket.on('complete', (data) => {
      // Update current message with usage data before finalizing
      const { currentMessage } = useConversationStore.getState()
      if (currentMessage && data.data?.usage) {
        updateMessage(currentMessage.id, { usage: data.data.usage })
      }
      
      // Finalize the current message and clear streaming state
      finalizeCurrentMessage()
      setCurrentStep(null)
      setWebSocketState({ status: 'complete' })
    })

    socket.on('error', (data) => {
      setWebSocketState({ status: 'error' })
      
      // Add error message
      const errorMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: data.content || 'An error occurred',
        timestamp: new Date()
      }
      
      addMessage(errorMessage)
      setCurrentMessage(null)
    })

    return () => {
      socket.disconnect()
    }
  }, [
    setWebSocketState,
    addMessage,
    updateMessage,
    setCurrentMessage,
    appendToCurrentMessage,
    addToolCallToCurrentMessage,
    updateToolCallInCurrentMessage,
    finalizeCurrentMessage,
    setCurrentStep,
    updateCurrentStep
  ])

  const sendMessage = useCallback((content: string, useAgentic: boolean = true, files?: UploadedFile[]) => {
    console.log('🚀 Sending message:', {
      content,
      useAgentic,
      hasFiles: !!files,
      fileCount: files?.length || 0,
      files: files ? files.map(f => ({ name: f.originalName, size: f.size })) : []
    })
    
    if (!socketRef.current?.connected) {
      return
    }

    // Add user message to store
    const userMessage: ChatMessage = {
      id: Date.now().toString() + '_user',
      role: 'user',
      content,
      timestamp: new Date(),
      // Store file information for display
      metadata: files && files.length > 0 ? { 
        attachedFiles: files.map(f => ({
          name: f.originalName,
          size: f.size,
          type: f.mimeType
        }))
      } : undefined
    }

    // Prepare assistant message placeholder
    const assistantMessage: ChatMessage = {
      id: Date.now().toString() + '_assistant',
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isAgentic: useAgentic
    }

    // Add both messages to store
    addMessage(userMessage)
    addMessage(assistantMessage)
    setCurrentMessage(assistantMessage)
    setWebSocketState({ status: 'thinking' })

    // Send message to server with file information
    socketRef.current.emit('chat_message', {
      message: content,
      useAgentic,
      files: files || []
    })
  }, [addMessage, setCurrentMessage, setWebSocketState])

  return {
    connected: websocketState.connected,
    status: websocketState.status,
    sendMessage,
    clearMessages
  }
}


