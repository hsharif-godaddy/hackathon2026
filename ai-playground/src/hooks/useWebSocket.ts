import { useEffect, useState, useCallback, useRef } from 'react'
import { io, Socket } from 'socket.io-client'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  toolCalls?: Array<{
    id: string
    name: string
    input: unknown
    result?: unknown
  }>
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  isAgentic?: boolean
  agenticSteps?: Array<{
    step: number
    content: string
    toolCalls?: Array<{ name: string; id: string; input: unknown; result?: unknown }>
    isFinal: boolean
  }>
}

export interface WebSocketState {
  connected: boolean
  status: 'idle' | 'thinking' | 'processing' | 'complete' | 'error'
  messages: ChatMessage[]
  currentStep?: {
    step: number
    content: string
    toolCalls?: Array<{ name: string; id: string; input: unknown; result?: unknown }>
  }
  availableAgents?: Array<{
    id: string
    name: string
    description?: string
  }>
  defaultAgent?: string
}

export function useWebSocket() {
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    status: 'idle',
    messages: [],
  })
  
  const socketRef = useRef<Socket | null>(null)
  const currentMessageRef = useRef<ChatMessage | null>(null)

  useEffect(() => {
    // Initialize socket connection
    const socket = io(process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000', {
      transports: ['websocket', 'polling']
    })
    
    socketRef.current = socket

    socket.on('connect', () => {
      setState(prev => ({ ...prev, connected: true }))
      console.log('WebSocket connected')
    })

    socket.on('agents_available', (data) => {
      console.log('📥 Available agents:', data.data?.agents)
      // Store available agents in state if needed
      setState(prev => ({ 
        ...prev, 
        availableAgents: data.data?.agents || [],
        defaultAgent: data.data?.defaultAgent 
      }))
    })

    socket.on('disconnect', () => {
      setState(prev => ({ ...prev, connected: false }))
      console.log('WebSocket disconnected')
    })

    socket.on('error', (data) => {
      console.error('📥 Received error:', data)
      setState(prev => ({ ...prev, status: 'error' }))
    })

    socket.on('status', (data) => {
      setState(prev => ({ ...prev, status: data.data?.status || 'idle' }))
    })

    socket.on('step_start', (data) => {
      console.log('📥 Received step_start:', data)
      
      // Initialize new step
      setState(prev => ({
        ...prev,
        currentStep: {
          step: data.data?.step || 1,
          content: '',
          toolCalls: []
        }
      }))
    })

    // OLD EVENT HANDLER - REMOVED (replaced by complete event)

    // OLD EVENT HANDLER - REMOVED (replaced by new normalized schema events)

    // OLD EVENT HANDLER - REMOVED (replaced by step_start)

    socket.on('chunk', (data) => {
      console.log('📥 Received chunk:', data.content)
      
      // Real-time text streaming
      if (currentMessageRef.current) {
        const currentContent = currentMessageRef.current.content || ''
        const newContent = currentContent + data.content
        
        currentMessageRef.current = {
          ...currentMessageRef.current,
          content: newContent
        }
        
        // Update UI with streaming text
        setState(prev => ({
          ...prev,
          messages: prev.messages.map(msg => 
            msg.id === currentMessageRef.current?.id 
              ? { ...msg, content: newContent }
              : msg
          ),
          currentStep: prev.currentStep ? {
            ...prev.currentStep,
            content: newContent
          } : undefined
        }))
      }
    })

    socket.on('tool_start', (data) => {
      console.log('📥 Received tool_start:', data)
      
      // Add tool call placeholder immediately when it starts
      if (currentMessageRef.current) {
        const existingToolCalls = currentMessageRef.current.toolCalls || []
        const newToolCall = {
          ...data.data.tool,
          status: 'running',
          result: null
        }
        const allToolCalls = [...existingToolCalls, newToolCall]
        
        currentMessageRef.current = {
          ...currentMessageRef.current,
          toolCalls: allToolCalls
        }
        
        // Update UI immediately with running tool call
        setState(prev => ({
          ...prev,
          messages: prev.messages.map(msg => 
            msg.id === currentMessageRef.current?.id 
              ? { ...msg, toolCalls: allToolCalls }
              : msg
          )
        }))
      }
    })

    socket.on('tool_result', (data) => {
      console.log('📥 Received tool_result:', data)
      
      // Update the tool call with its result
      if (currentMessageRef.current) {
        const updatedToolCalls = (currentMessageRef.current.toolCalls || []).map(tool => 
          tool.id === data.data.tool.id 
            ? { ...tool, result: data.data.tool.result, status: 'completed' }
            : tool
        )
        
        currentMessageRef.current = {
          ...currentMessageRef.current,
          toolCalls: updatedToolCalls
        }
        
        // Update UI with completed tool call
        setState(prev => ({
          ...prev,
          messages: prev.messages.map(msg => 
            msg.id === currentMessageRef.current?.id 
              ? { ...msg, toolCalls: updatedToolCalls }
              : msg
          )
        }))
      }
    })

    socket.on('step_complete', (data) => {
      console.log('📥 Received step_complete:', data)
      
      // Step completion - mainly for logging and status updates
      setState(prev => ({
        ...prev,
        currentStep: prev.currentStep ? {
          ...prev.currentStep,
          content: data.content,
          toolCalls: data.data?.toolCalls || []
        } : undefined
      }))
    })

    socket.on('complete', (data) => {
      console.log('📥 Received complete:', data)
      
      if (currentMessageRef.current) {
        // Preserve accumulated tool calls from streaming, don't overwrite with final data
        const finalToolCalls = currentMessageRef.current.toolCalls || data.data?.toolCalls || []
        
        const updatedMessage: ChatMessage = {
          ...currentMessageRef.current,
          content: data.content || currentMessageRef.current.content, // Use streamed content if available
          toolCalls: finalToolCalls, // Use accumulated tool calls
          usage: data.data?.usage,
          isAgentic: true
        }
        
        console.log('📝 Adding agentic message to state:', updatedMessage)
        
        setState(prev => ({
          ...prev,
          messages: [...prev.messages, updatedMessage],
          status: 'complete',
          currentStep: undefined
        }))
        
        currentMessageRef.current = null
      } else {
        console.warn('⚠️ No currentMessageRef when agentic_complete received')
      }
    })

    socket.on('error', (data) => {
      console.error('📥 Received error event:', data)
      
      setState(prev => ({
        ...prev,
        status: 'error'
      }))
      
      // Add error message
      const errorMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: data.content || 'An error occurred',
        timestamp: new Date()
      }
      
      setState(prev => ({
        ...prev,
        messages: [...prev.messages, errorMessage]
      }))
      
      currentMessageRef.current = null
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  const sendMessage = useCallback((content: string, useAgentic: boolean = false) => {
    if (!socketRef.current?.connected) {
      console.error('Socket not connected')
      return
    }

    // Add user message to state
    const userMessage: ChatMessage = {
      id: Date.now().toString() + '_user',
      role: 'user',
      content,
      timestamp: new Date()
    }

    // Prepare assistant message placeholder
    const assistantMessage: ChatMessage = {
      id: Date.now().toString() + '_assistant',
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isAgentic: useAgentic
    }

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage, assistantMessage],
      status: 'thinking'
    }))

    currentMessageRef.current = assistantMessage

    // Send message to server
    socketRef.current.emit('chat_message', {
      message: content,
      useAgentic
    })
  }, [])

  const clearMessages = useCallback(() => {
    setState(prev => ({
      ...prev,
      messages: [],
      status: 'idle',
      currentStep: undefined
    }))
    currentMessageRef.current = null
  }, [])

  return {
    ...state,
    sendMessage,
    clearMessages
  }
}
