import { Message, ToolCall, MessageSegment, AiEditContext, PlanItem } from './types'
import { Conversation } from '@/services/AgentService'
import { agentService } from '@/services/AgentService'
import { captureVisualContext } from './visualContextCapture'
import { appFetch } from '@/lib/gasket-config'

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
  aiEditContext?: AiEditContext | null
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
  setConversationId?: React.Dispatch<React.SetStateAction<string | null>>
  setDevelopmentPlan?: (plan: PlanItem[]) => void
  setConversations?: (conversations: Conversation[]) => void
  onTokenUsageUpdate?: () => void
  onMessageComplete?: () => void
}

// WebSocket connection management - Per app instance to avoid conflicts
const webSocketConnections = new Map<string, WebSocket>()
let reconnectAttempts = 0
const maxReconnectAttempts = 5
const reconnectDelay = 1000 // Start with 1 second, will be exponential backoff

/**
 * Cleanup function to close WebSocket connections
 * Should be called when component unmounts or when you want to cancel ongoing connections
 */
export const cleanup = (appId?: string) => {
  if (appId) {
    // Clean up specific app connection
    const ws = webSocketConnections.get(appId)
    if (ws) {
      ws.close()
      webSocketConnections.delete(appId)
    }
  } else {
    // Clean up all connections
    for (const [id, ws] of webSocketConnections) {
      ws.close()
    }
    webSocketConnections.clear()
  }
  reconnectAttempts = 0
}

/**
 * Create WebSocket connection with automatic reconnection
 */
function createWebSocketConnection(agentId: string, appId: string): Promise<WebSocket> {
  return new Promise(async (resolve, reject) => {
    try {
      const { buildDynamicWsUrl } = await import('@/config/dynamic-api')
      const wsUrl = await buildDynamicWsUrl(`ws/${agentId}`, appId)

      console.log('🔌 Creating WebSocket connection to:', wsUrl);
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('🔌 WebSocket connected');
        reconnectAttempts = 0; // Reset reconnect attempts on successful connection
        resolve(ws);
      };

      ws.onerror = (error) => {
        console.error('🔌 WebSocket connection error:', error);
        reject(new Error('Failed to connect to WebSocket'));
      };

      ws.onclose = (event) => {
        console.log('🔌 WebSocket connection closed:', event.code, event.reason);

        // Only attempt reconnection if this was an unexpected close and we have an appId
        if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts && appId) {
          reconnectAttempts++;
          const delay = reconnectDelay * Math.pow(2, reconnectAttempts - 1); // Exponential backoff

          console.log(`🔄 Attempting to reconnect WebSocket (${reconnectAttempts}/${maxReconnectAttempts}) in ${delay}ms...`);

          setTimeout(() => {
            createWebSocketConnection(agentId, appId)
              .then(newWs => {
                webSocketConnections.set(appId, newWs);
                console.log('🔌 WebSocket reconnected successfully');
              })
              .catch(error => {
                console.error('🔌 WebSocket reconnection failed:', error);
              });
          }, delay);
        }
      };
    } catch (error) {
      console.error('🔌 Failed to build WebSocket URL:', error);
      reject(error);
    }
  });
}

/**
 * Ensures the app is on the latest commit (HEAD) before making any changes
 * This prevents making changes on a detached HEAD state
 */
async function ensureLatestCommit(appId: string): Promise<boolean> {
  try {
    // Only attempt to return to HEAD if we have an app ID
    if (!appId) return true
    
    console.log('Ensuring app is on latest commit before sending message')
    
    const response = await appFetch(`/api/apps/${appId}/git/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: 'main' })
    })
    
    if (response.ok) {
      const result = await response.json()
      console.log('✅ Successfully returned to latest commit:', result.message)
      return true
    } else {
      console.error('❌ Failed to return to latest commit:', response.status)
      return false
    }
  } catch (error) {
    console.error('❌ Error ensuring latest commit:', error)
    return false
  }
}

export const handleSendMessage = async ({
  messageContent,
  inputValue,
  isLoading,
  appId,
  conversationId,
  aiEditContext,
  setMessages,
  setInputValue,
  setIsLoading,
  setConversationId,
  onTokenUsageUpdate,
  onMessageComplete
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
    // CRITICAL: Always ensure we're on the latest commit before making changes
    // This prevents making changes on a detached HEAD state
    await ensureLatestCommit(appId)
    
    // Close any existing WebSocket connection for this app
    const existingWs = webSocketConnections.get(appId)
    if (existingWs) {
      existingWs.close()
      webSocketConnections.delete(appId)
    }
    
    // Always use develop agent
    const agentId = 'develop'

    // Create new WebSocket connection for this app
    const newWebSocket = await createWebSocketConnection(agentId, appId)
    webSocketConnections.set(appId, newWebSocket)

    // Set up message handler
    newWebSocket.onmessage = (event) => {
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
          onTokenUsageUpdate,
          onMessageComplete
        )
      } catch (error) {
        console.warn('Failed to parse WebSocket data:', event.data, error)
      }
    }

    // Set up error handler
    newWebSocket.onerror = (error) => {
      console.error('WebSocket Error:', error)
      handleWebSocketError(agentMessage, setMessages)
      setIsLoading(false)
    }

    // Capture visual context before sending the message
    let visualContext = null
    try {
      console.log('Attempting to capture visual context...')
      visualContext = await captureVisualContext()
      
      if (visualContext?.active_section === 'unknown') {
        console.log('Visual context captured with fallback data (preview still loading or not accessible)')
      } else {
        console.log('Visual context captured successfully:', visualContext)
      }
    } catch (error) {
      console.warn('Failed to capture visual context, proceeding without it:', error)
    }
    
    // Send the chat message  
    console.log('📤 Sending message for app:', appId, 'with conversationId:', conversationId)
    
    const chatMessage = {
      type: 'chat',
      message: content,
      appId: appId,
      conversationId: conversationId,
      threadId: undefined, // Let server generate
      userId: undefined,
      metadata: {
        ...(aiEditContext && {
          aiEditContext: {
            elementInfo: aiEditContext.elementInfo,
            selector: aiEditContext.selector,
            devContext: aiEditContext.devContext
          }
        }),
        ...(visualContext && {
          visualContext: visualContext
        })
      }
    }

    newWebSocket.send(JSON.stringify(chatMessage))

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
  onTokenUsageUpdate?: () => void,
  onMessageComplete?: () => void
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
          setMessages(prev => {
            const updatedMessages = [...prev]
            const thinkingAgentIndex = findThinkingAgentMessageIndex(updatedMessages)
            
            if (thinkingAgentIndex >= 0) {
              updatedMessages[thinkingAgentIndex] = {
                ...updatedMessages[thinkingAgentIndex],
                content: agentMessageContent,
                isThinking: false,
                // Update streaming content in segments
                segments: updateStreamingContent(updatedMessages[thinkingAgentIndex].segments || [], agentMessageContent)
              }
            }
            
            return updatedMessages
          })
        }
      }
      break
      
    case 'tool_start':
      console.log('Tool Start:', data.tool_name)
      
      // When a tool starts, we need to:
      // 1. Finalize the current content segment with whatever content we have so far
      // 2. Add the tool call as a new segment
      // 3. Reset agentMessageContent to start accumulating new content after the tool
      
      setMessages(prev => {
        const updatedMessages = [...prev]
        const thinkingAgentIndex = findThinkingAgentMessageIndex(updatedMessages)
        
        if (thinkingAgentIndex >= 0) {
          const msg = updatedMessages[thinkingAgentIndex]
          updatedMessages[thinkingAgentIndex] = {
            ...msg,
            // Keep legacy tool_calls for backward compatibility
            tool_calls: [
              ...(msg.tool_calls || []),
              ...(data.tool_call_id && data.tool_name ? [{
                id: data.tool_call_id,
                tool_name: data.tool_name,
                tool_args: typeof data.tool_args === 'string' ? data.tool_args : JSON.stringify(data.tool_args),
                start_time: data.start_time,
                status: 'running' as const
              }] : [])
            ],
            // Add to segments for the new rendering approach
            segments: (data.tool_call_id && data.tool_name) ? finalizeContentAndAddTool(
              msg.segments || [], 
              agentMessageContent,
              {
                id: data.tool_call_id,
                tool_name: data.tool_name,
                tool_args: typeof data.tool_args === 'string' ? data.tool_args : JSON.stringify(data.tool_args),
                start_time: data.start_time,
                status: 'running' as const
              }
            ) : msg.segments || []
          }
        }
        
        return updatedMessages
      })
      
      // Reset content to start accumulating post-tool content
      agentMessageContent = agentMessageContent // Keep accumulating for now, but mark where tool happened
      break
      
    case 'tool_complete':
      console.log('Tool Complete:', data.tool_name, data.status)
      // Update the specific tool call in both legacy and segments structures
      setMessages(prev => {
        const updatedMessages = [...prev]
        const thinkingAgentIndex = findThinkingAgentMessageIndex(updatedMessages)
        
        if (thinkingAgentIndex >= 0) {
          const msg = updatedMessages[thinkingAgentIndex]
          updatedMessages[thinkingAgentIndex] = {
            ...msg,
            // Update legacy tool_calls
            tool_calls: (msg.tool_calls || []).map(toolCall =>
              toolCall.id === data.tool_call_id
                ? {
                    ...toolCall,
                    tool_result: typeof data.tool_result === 'string' ? data.tool_result : JSON.stringify(data.tool_result),
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
                      tool_result: typeof data.tool_result === 'string' ? data.tool_result : JSON.stringify(data.tool_result),
                      error: data.error,
                      end_time: data.end_time,
                      duration_ms: data.duration_ms,
                      status: data.status as 'success' | 'error'
                    }
                  }
                : segment
            )
          }
        }
        
        return updatedMessages
      })
      break
      
    case 'tool_result':
      console.log('Tool Result (legacy):', data.tool_name, data.tool_result)
      // Keep for backward compatibility - this shouldn't be used with new tool_start/tool_complete flow
      const toolResultMessage: Message = {
        id: Math.random().toString(36).substring(2, 15),
        sender: 'agent',
        content: typeof data.tool_result === 'string' ? data.tool_result : JSON.stringify(data.tool_result) || '',
        timestamp: new Date(),
        type: 'tool_result',
        tool_name: data.tool_name,
        tool_result: typeof data.tool_result === 'string' ? data.tool_result : JSON.stringify(data.tool_result)
      }
      setMessages(prev => [...prev, toolResultMessage])
      break
      
    case 'tool_error':
      console.error('Tool Error:', data.tool_name, data.error)
      break
      
    case 'complete':
      console.log('WebSocket Complete:', data)
      // Mark the main agent message as complete with final content and duration
      setMessages(prev => {
        const updatedMessages = [...prev]
        const thinkingAgentIndex = findThinkingAgentMessageIndex(updatedMessages)
        
        if (thinkingAgentIndex >= 0) {
          updatedMessages[thinkingAgentIndex] = {
            ...updatedMessages[thinkingAgentIndex],
            content: agentMessageContent,
            isThinking: false,
            is_complete: true,
            response_start_time: data.start_time,
            response_end_time: data.end_time,
            response_duration_ms: data.duration_ms
          }
        }
        
        return updatedMessages
      })
      
      setIsLoading(false)
      
      // Refresh token usage after completion
      if (onTokenUsageUpdate) {
        onTokenUsageUpdate()
      }
      
      // Trigger preview refresh when message completes
      if (onMessageComplete) {
        setTimeout(() => {
          onMessageComplete()
        }, 500) // Small delay to ensure file changes are processed
      }
      break
      
    case 'error':
      console.error('WebSocket Error:', data.error)
      // Update the main agent message with error state
      setMessages(prev => {
        const updatedMessages = [...prev]
        const thinkingAgentIndex = findThinkingAgentMessageIndex(updatedMessages)
        
        if (thinkingAgentIndex >= 0) {
          updatedMessages[thinkingAgentIndex] = {
            ...updatedMessages[thinkingAgentIndex],
            content: `Sorry, I encountered an error. Please make sure the agents server is running and WebSocket connections are supported.`,
            isThinking: false,
            is_complete: true,
            error: data.error,
            response_start_time: data.start_time,
            response_end_time: data.end_time,
            response_duration_ms: data.duration_ms
          }
        }
        
        return updatedMessages
      })
      
      setIsLoading(false)
      break
      
    default:
      console.log('Unknown WebSocket event type:', data.type, data)
  }
  
  return agentMessageContent
}

/**
 * Helper function to find the most recent agent message that's currently thinking/streaming
 */
function findThinkingAgentMessageIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.sender === 'agent' && (msg.isThinking === true || !msg.is_complete)) {
      return i
    }
  }
  return -1
}

function handleWebSocketError(
  agentMessage: Message,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
) {
  setMessages(prev => {
    const updatedMessages = [...prev]
    const thinkingAgentIndex = findThinkingAgentMessageIndex(updatedMessages)
    
    if (thinkingAgentIndex >= 0) {
      updatedMessages[thinkingAgentIndex] = {
        ...updatedMessages[thinkingAgentIndex],
        content: 'Sorry, I encountered an error. Please make sure the agents server is running and WebSocket connections are supported.',
        isThinking: false,
        is_complete: true,
        error: 'WebSocket connection error'
      }
    }
    
    return updatedMessages
  })
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
    const conversations = await agentService.getConversations(appId)
    console.log('loadConversations - loaded conversations:', conversations?.length || 0, conversations)
    return conversations
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
    const data = await agentService.getConversation(appId, conversationId)
    console.log('loadConversation - loaded conversation data:', data)
    
    // Convert database messages to UI message format
    type DatabaseMessage = {id: string; sender: string; content: string; createdAt: string; messageType?: string; toolCalls?: ToolCall[]; segments?: MessageSegment[]; metadata?: Record<string, unknown>};
    const messages: Message[] = (data.messages as DatabaseMessage[]).map((msg: DatabaseMessage) => ({
      id: msg.id, // Keep as string since database IDs are strings
      sender: msg.sender as 'user' | 'agent',
      content: msg.content,
      timestamp: new Date(msg.createdAt),
      messageType: msg.messageType,
      tool_calls: msg.toolCalls,
      segments: msg.segments,
      ...(msg.metadata || {})
    }))
    
    console.log('loadConversation - converted messages:', messages?.length || 0, messages)
    
    return {
      conversation: data,
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
export const deleteConversation = async (appId: string, conversationId: string) => {
  try {
    const data = await agentService.deleteConversation(appId, conversationId)
    return data.success
  } catch (error) {
    console.error('Error deleting conversation:', error)
    return false
  }
}