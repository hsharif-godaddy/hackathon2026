import { Message, ToolCall } from './types'

/**
 * Message Service using WebSocket for real-time bidirectional communication
 * 
 * This implementation provides:
 * - Real-time bidirectional communication with WebSocket
 * - Automatic connection management with reconnection logic
 * - Built-in error handling and connection state management
 * - Proper cleanup to prevent memory leaks
 * - Throttled UI updates for smooth streaming
 * 
 * Benefits over SSE:
 * - Better browser compatibility and fewer browser-specific issues
 * - Lower latency and overhead
 * - Better error handling and connection state awareness
 * - Simplified connection management
 * - Works reliably across different network environments
 * 
 * WebSocket connection states:
 * - CONNECTING (0): The connection is not yet open
 * - OPEN (1): The connection is open and ready to communicate
 * - CLOSING (2): The connection is in the process of closing
 * - CLOSED (3): The connection is closed or couldn't be opened
 */

export interface SendMessageParams {
  messageContent?: string
  inputValue: string
  isLoading: boolean
  appId: string
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
}

// WebSocket connection management
let currentWebSocket: WebSocket | null = null
let reconnectAttempts = 0
const maxReconnectAttempts = 5
const reconnectDelay = 1000 // Start with 1 second, will be exponential backoff

/**
 * Cleanup function to close any ongoing WebSocket connections
 * Should be called when component unmounts or when you want to cancel ongoing connections
 */
export const cleanup = () => {
  if (currentWebSocket) {
    currentWebSocket.close()
    currentWebSocket = null
  }
  reconnectAttempts = 0
}

/**
 * Create WebSocket connection with automatic reconnection
 */
function createWebSocketConnection(agentId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:4000/ws/${agentId}`)
    
    ws.onopen = () => {
      console.log('🔌 WebSocket connected')
      reconnectAttempts = 0 // Reset reconnect attempts on successful connection
      resolve(ws)
    }
    
    ws.onerror = (error) => {
      console.error('🔌 WebSocket connection error:', error)
      reject(new Error('Failed to connect to WebSocket'))
    }
    
    ws.onclose = (event) => {
      console.log('🔌 WebSocket connection closed:', event.code, event.reason)
      
      // Only attempt reconnection if this was an unexpected close
      if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++
        const delay = reconnectDelay * Math.pow(2, reconnectAttempts - 1) // Exponential backoff
        
        console.log(`🔄 Attempting to reconnect WebSocket (${reconnectAttempts}/${maxReconnectAttempts}) in ${delay}ms...`)
        
        setTimeout(() => {
          createWebSocketConnection(agentId)
            .then(newWs => {
              currentWebSocket = newWs
              console.log('🔌 WebSocket reconnected successfully')
            })
            .catch(error => {
              console.error('🔌 WebSocket reconnection failed:', error)
            })
        }, delay)
      }
    }
  })
}

export const handleSendMessage = async ({
  messageContent,
  inputValue,
  isLoading,
  appId,
  setMessages,
  setInputValue,
  setIsLoading
}: SendMessageParams) => {
  const content = messageContent || inputValue.trim()
  if (!content || isLoading) return

  const userMessage: Message = {
    id: Date.now(),
    sender: 'user',
    content,
    timestamp: new Date()
  }

  setMessages(prev => [...prev, userMessage])
  setInputValue('')
  setIsLoading(true)

  // Create agent message outside try block so it's accessible in catch
  const agentMessage: Message = {
    id: Date.now() + 1,
    sender: 'agent',
    content: '',
    timestamp: new Date(),
    isThinking: true,
    tool_calls: [],
    response_start_time: Date.now(),
    is_complete: false
  }

  // Add thinking message that we'll update
  setMessages(prev => [...prev, agentMessage])

  // Throttling for smooth updates without overwhelming React
  const lastUpdateTimeRef = { current: 0 }
  const updateThrottleMs = 16 // ~60fps
  
  // Track accumulated content
  let agentMessageContent = ''

  try {
    // Close any existing WebSocket connection
    if (currentWebSocket) {
      currentWebSocket.close()
      currentWebSocket = null
    }
    
    // Use fake-events agent when message is 'FAKE-EVENTS'
    const agentId = content === 'FAKE-EVENTS' ? 'fake-events' : 'develop'

    // Create new WebSocket connection
    currentWebSocket = await createWebSocketConnection(agentId)

    // Set up message handler
    currentWebSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        agentMessageContent = handleWebSocketMessage(
          data, 
          agentMessage, 
          agentMessageContent, 
          setMessages, 
          lastUpdateTimeRef, 
          updateThrottleMs,
          setIsLoading
        )
      } catch (error) {
        console.warn('Failed to parse WebSocket data:', event.data, error)
      }
    }

    // Set up error handler
    currentWebSocket.onerror = (error) => {
      console.error('WebSocket Error:', error)
      handleWebSocketError(agentMessage, setMessages)
      setIsLoading(false)
    }

    // Send the chat message
    const chatMessage = {
      type: 'chat',
      message: content,
      appId: appId,
      threadId: undefined, // Let server generate
      userId: undefined,
      metadata: {}
    }

    currentWebSocket.send(JSON.stringify(chatMessage))

  } catch (error) {
    console.error('Error sending message via WebSocket:', error)
    handleWebSocketError(agentMessage, setMessages)
    setIsLoading(false)
  }
}

function handleWebSocketMessage(
  data: any, 
  agentMessage: Message, 
  agentMessageContent: string, 
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  lastUpdateTimeRef: { current: number },
  updateThrottleMs: number,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
): string {
  switch (data.type) {
    case 'metadata':
      console.log('WebSocket Metadata:', data)
      break
      
    case 'status':
      console.log('WebSocket Status:', data.status, data.message)
      // Add status message to the message list
      const statusMessage: Message = {
        id: Date.now() + Math.random(),
        sender: 'agent',
        content: data.message || '',
        timestamp: new Date(),
        type: 'status',
        status: data.status,
        message: data.message
      }
      setMessages(prev => [...prev, statusMessage])
      break
      
    case 'content':
      if (data.content) {
        agentMessageContent += data.content
        
        // Throttle updates to ~60fps for smooth streaming without overwhelming React
        const now = Date.now()
        const timeSinceLastUpdate = now - lastUpdateTimeRef.current

        if (timeSinceLastUpdate >= updateThrottleMs) {
          lastUpdateTimeRef.current = now
          setMessages(prev => 
            prev.map(msg => 
              msg.id === agentMessage.id 
                ? { ...msg, content: agentMessageContent, isThinking: false }
                : msg
            )
          )
        }
      }
      break
      
    case 'tool_start':
      console.log('Tool Start:', data.tool_name)
      // Add tool call to the main agent message's tool_calls array
      setMessages(prev => 
        prev.map(msg => 
          msg.id === agentMessage.id 
            ? {
                ...msg,
                tool_calls: [
                  ...(msg.tool_calls || []),
                  {
                    id: data.tool_call_id,
                    tool_name: data.tool_name,
                    tool_args: data.tool_args,
                    start_time: data.start_time,
                    status: 'running' as const
                  }
                ]
              }
            : msg
        )
      )
      break
      
    case 'tool_complete':
      console.log('Tool Complete:', data.tool_name, data.status)
      // Update the specific tool call in the main agent message
      setMessages(prev => 
        prev.map(msg => 
          msg.id === agentMessage.id 
            ? {
                ...msg,
                tool_calls: (msg.tool_calls || []).map(toolCall =>
                  toolCall.id === data.tool_call_id
                    ? {
                        ...toolCall,
                        tool_result: data.tool_result,
                        error: data.error,
                        end_time: data.end_time,
                        duration_ms: data.duration_ms,
                        status: data.status as 'success' | 'error'
                      }
                    : toolCall
                )
              }
            : msg
        )
      )
      break
      
    case 'tool_result':
      console.log('Tool Result (legacy):', data.tool_name, data.tool_result)
      // Keep for backward compatibility - this shouldn't be used with new tool_start/tool_complete flow
      const toolResultMessage: Message = {
        id: Date.now() + Math.random(),
        sender: 'agent',
        content: data.tool_result || '',
        timestamp: new Date(),
        type: 'tool_result',
        tool_name: data.tool_name,
        tool_result: data.tool_result
      }
      setMessages(prev => [...prev, toolResultMessage])
      break
      
    case 'tool_error':
      console.error('Tool Error:', data.tool_name, data.error)
      break
      
    case 'complete':
      console.log('WebSocket Complete:', data)
      // Mark the main agent message as complete with final content and duration
      setMessages(prev => 
        prev.map(msg => 
          msg.id === agentMessage.id 
            ? { 
                ...msg, 
                content: agentMessageContent, 
                isThinking: false,
                is_complete: true,
                response_start_time: data.start_time,
                response_end_time: data.end_time,
                response_duration_ms: data.duration_ms
              }
            : msg
        )
      )
      
      setIsLoading(false)
      break
      
    case 'error':
      console.error('WebSocket Error:', data.error)
      // Update the main agent message with error state
      setMessages(prev => 
        prev.map(msg => 
          msg.id === agentMessage.id 
            ? { 
                ...msg, 
                content: `Sorry, I encountered an error. Please make sure the agents server is running on localhost:4000 and WebSocket connections are supported.`,
                isThinking: false,
                is_complete: true,
                error: data.error,
                response_start_time: data.start_time,
                response_end_time: data.end_time,
                response_duration_ms: data.duration_ms
              }
            : msg
        )
      )
      
      setIsLoading(false)
      break
      
    default:
      console.log('Unknown WebSocket event type:', data.type, data)
  }
  
  return agentMessageContent
}

function handleWebSocketError(
  agentMessage: Message,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
) {
  setMessages(prev => 
    prev.map(msg => 
      msg.id === agentMessage.id 
        ? { 
            ...msg, 
            content: 'Sorry, I encountered an error. Please make sure the agents server is running on localhost:4000 and WebSocket connections are supported.',
            isThinking: false 
          }
        : msg
    )
  )
}