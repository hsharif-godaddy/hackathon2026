import { Message } from './types'

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
    isThinking: true
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
      // Could update UI to show status if needed
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
      
    case 'tool_result':
      console.log('Tool Result:', data.tool_name, data.tool_result)
      // Could display tool results in UI if needed
      break
      
    case 'tool_error':
      console.error('Tool Error:', data.tool_name, data.error)
      break
      
    case 'complete':
      console.log('WebSocket Complete:', data)
      // Ensure final update with complete content
      setMessages(prev => 
        prev.map(msg => 
          msg.id === agentMessage.id 
            ? { ...msg, content: agentMessageContent, isThinking: false }
            : msg
        )
      )
      setIsLoading(false)
      break
      
    case 'error':
      console.error('WebSocket Error:', data.error)
      handleWebSocketError(agentMessage, setMessages)
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