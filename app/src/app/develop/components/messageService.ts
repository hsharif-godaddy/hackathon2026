import { Message, ToolCall, MessageSegment } from './types'

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
  conversationId?: string
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
  setConversationId?: React.Dispatch<React.SetStateAction<string | null>>
  onTokenUsageUpdate?: () => void
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
  conversationId,
  setMessages,
  setInputValue,
  setIsLoading,
  setConversationId,
  onTokenUsageUpdate
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
    
    // Always use develop agent
    const agentId = 'develop'

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
          setIsLoading,
          setConversationId,
          onTokenUsageUpdate
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
      conversationId: conversationId,
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
  data: {type: string; conversationId?: string; status?: string; message?: string; content?: string; tool_name?: string; tool_call_id?: string; tool_args?: unknown; start_time?: number; tool_result?: unknown; error?: string; end_time?: number; duration_ms?: number}, 
  agentMessage: Message, 
  agentMessageContent: string, 
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  lastUpdateTimeRef: { current: number },
  updateThrottleMs: number,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
  setConversationId?: React.Dispatch<React.SetStateAction<string | null>>,
  onTokenUsageUpdate?: () => void
): string {
  switch (data.type) {
    case 'metadata':
      console.log('WebSocket Metadata:', data)
      // Handle new conversation creation
      if (data.conversationId && setConversationId) {
        setConversationId(data.conversationId)
      }
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
                ? { 
                    ...msg, 
                    content: agentMessageContent, 
                    isThinking: false,
                    // Update streaming content in segments
                    segments: updateStreamingContent(msg.segments || [], agentMessageContent)
                  }
                : msg
            )
          )
        }
      }
      break
      
    case 'tool_start':
      console.log('Tool Start:', data.tool_name)
      
      // When a tool starts, we need to:
      // 1. Finalize the current content segment with whatever content we have so far
      // 2. Add the tool call as a new segment
      // 3. Reset agentMessageContent to start accumulating new content after the tool
      
      setMessages(prev => 
        prev.map(msg => 
          msg.id === agentMessage.id 
            ? {
                ...msg,
                // Keep legacy tool_calls for backward compatibility
                tool_calls: [
                  ...(msg.tool_calls || []),
                  {
                    id: data.tool_call_id,
                    tool_name: data.tool_name,
                    tool_args: data.tool_args,
                    start_time: data.start_time,
                    status: 'running' as const
                  }
                ],
                // Add to segments for the new rendering approach
                segments: finalizeContentAndAddTool(
                  msg.segments || [], 
                  agentMessageContent,
                  {
                    id: data.tool_call_id,
                    tool_name: data.tool_name,
                    tool_args: data.tool_args,
                    start_time: data.start_time,
                    status: 'running' as const
                  }
                )
              }
            : msg
        )
      )
      
      // Reset content to start accumulating post-tool content
      agentMessageContent = agentMessageContent // Keep accumulating for now, but mark where tool happened
      break
      
    case 'tool_complete':
      console.log('Tool Complete:', data.tool_name, data.status)
      // Update the specific tool call in both legacy and segments structures
      setMessages(prev => 
        prev.map(msg => 
          msg.id === agentMessage.id 
            ? {
                ...msg,
                // Update legacy tool_calls
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
                ),
                // Update segments
                segments: (msg.segments || []).map(segment =>
                  segment.type === 'tool_call' && segment.tool_call?.id === data.tool_call_id && segment.tool_call
                    ? {
                        ...segment,
                        tool_call: {
                          ...segment.tool_call,
                          tool_result: data.tool_result,
                          error: data.error,
                          end_time: data.end_time,
                          duration_ms: data.duration_ms,
                          status: data.status as 'success' | 'error'
                        }
                      }
                    : segment
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
      
      // Refresh token usage after completion
      if (onTokenUsageUpdate) {
        onTokenUsageUpdate()
      }
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

/**
 * Helper function to finalize current content and add a tool call segment
 */
function finalizeContentAndAddTool(segments: MessageSegment[], currentContent: string, toolCall: ToolCall): MessageSegment[] {
  const newSegments = [...segments]
  
  // Calculate how much content has already been captured in segments
  let capturedContentLength = 0
  for (const segment of segments) {
    if (segment.type === 'content' && segment.content) {
      capturedContentLength += segment.content.length
    }
  }
  
  // Get the new content that hasn't been captured yet
  const newContent = currentContent.slice(capturedContentLength)
  
  // Add new content segment if there's new content
  if (newContent.length > 0) {
    newSegments.push({
      id: `content-${Date.now()}`,
      type: 'content',
      content: newContent,
      timestamp: new Date()
    })
  }
  
  // Add the tool call segment
  newSegments.push({
    id: `tool-${toolCall.id}`,
    type: 'tool_call',
    tool_call: toolCall,
    timestamp: new Date()
  })
  
  return newSegments
}

/**
 * Helper function to update streaming content in the last content segment
 */
function updateStreamingContent(segments: MessageSegment[], currentContent: string): MessageSegment[] {
  const newSegments = [...segments]
  
  // Calculate how much content has been captured in completed segments (before tool calls)
  let capturedContentLength = 0
  for (const segment of segments) {
    if (segment.type === 'content' && segment.content) {
      capturedContentLength += segment.content.length
    }
  }
  
  // Get the new content that should be in the current streaming segment
  const newContent = currentContent.slice(capturedContentLength)
  
  if (newContent.length > 0) {
    // Find the last segment
    const lastSegment = newSegments[newSegments.length - 1]
    
    if (lastSegment && lastSegment.type === 'content') {
      // Update the existing content segment
      lastSegment.content = newContent
    } else {
      // Create a new content segment
      newSegments.push({
        id: `content-${Date.now()}`,
        type: 'content',
        content: newContent,
        timestamp: new Date()
      })
    }
  }
  
  return newSegments
}

/**
 * Load conversations for an app
 */
export const loadConversations = async (appId: string) => {
  try {
    const response = await fetch(`http://localhost:4000/agent/conversations/${appId}`)
    if (!response.ok) {
      throw new Error('Failed to fetch conversations')
    }
    return await response.json()
  } catch (error) {
    console.error('Error loading conversations:', error)
    return []
  }
}

/**
 * Load a specific conversation with its messages
 */
export const loadConversation = async (appId: string, conversationId: string) => {
  try {
    const response = await fetch(`http://localhost:4000/agent/conversations/${appId}/${conversationId}`)
    if (!response.ok) {
      throw new Error('Failed to fetch conversation')
    }
    const data = await response.json()
    
    // Convert database messages to UI message format
    const messages: Message[] = data.messages.map((msg: {id: string; sender: string; content: string; createdAt: string; messageType?: string; toolCalls?: ToolCall[]; segments?: MessageSegment[]; metadata?: Record<string, unknown>}) => ({
      id: msg.id, // Keep as string since database IDs are strings
      sender: msg.sender,
      content: msg.content,
      timestamp: new Date(msg.createdAt),
      messageType: msg.messageType,
      tool_calls: msg.toolCalls,
      segments: msg.segments,
      ...(msg.metadata || {})
    }))
    
    return {
      conversation: data.conversation,
      messages
    }
  } catch (error) {
    console.error('Error loading conversation:', error)
    return null
  }
}

/**
 * Delete a conversation
 */
export const deleteConversation = async (conversationId: string) => {
  try {
    const response = await fetch(`http://localhost:4000/agent/conversations/${conversationId}`, {
      method: 'DELETE'
    })
    if (!response.ok) {
      throw new Error('Failed to delete conversation')
    }
    return true
  } catch (error) {
    console.error('Error deleting conversation:', error)
    return false
  }
}