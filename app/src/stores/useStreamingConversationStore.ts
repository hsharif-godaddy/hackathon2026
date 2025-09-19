/**
 * Streaming-First Conversation Store
 * 
 * Clean architecture designed for real-time AI streaming responses.
 * No backward compatibility - built for streaming from the ground up.
 */

import { create } from 'zustand'
import type { AiEditContext, PlanItem } from '../app/develop/components/types'

// Core streaming segment types
export interface StreamSegment {
  id: string
  type: 'text' | 'tool_start' | 'tool_result'
  content: string
  timestamp: Date
  toolCall?: ToolCall
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  result?: Record<string, unknown> | string
  status: 'running' | 'completed' | 'error'
  error?: string
  startTime?: number
  endTime?: number
}

// Streaming message (actively being built)
export interface StreamingMessage {
  id: string
  role: 'user' | 'assistant'
  content: string                  // Accumulated text content
  segments: StreamSegment[]        // Chronological segments
  toolCalls: ToolCall[]           // Tool invocations
  timestamp: Date
  isComplete: boolean
  metadata?: {
    usage?: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
    }
    agentId?: string
    step?: number
  }
}

// Completed message (finalized)
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'  
  content: string
  segments?: StreamSegment[]       // Preserved for rich display
  toolCalls?: ToolCall[]
  timestamp: Date
  metadata?: {
    usage?: {
      inputTokens: number
      outputTokens: number  
      totalTokens: number
    }
    agentId?: string
    totalSteps?: number
  }
}

// WebSocket connection state
export interface WebSocketState {
  connected: boolean
  status: 'idle' | 'connecting' | 'streaming' | 'completing' | 'error'
  error?: string
}

// Main store state
export interface StreamingConversationState {
  // Core data
  messages: ChatMessage[]                    // Only completed messages
  activeStream: StreamingMessage | null     // Current streaming message
  
  // Stream state
  streamingState: 'idle' | 'streaming' | 'completing' | 'error'
  currentStep: number
  
  // App context
  currentAppId: string | null
  inputValue: string
  isLoading: boolean
  
  // Additional context
  aiEditContext: AiEditContext | null
  developmentPlan: PlanItem[]
  conversations: Array<{ id: string; updatedAt: string }>
  
  // Per-app chat history cache (for future enhancement)
  appChatHistory: Record<string, ChatMessage[]>
  
  // WebSocket state
  websocket: WebSocketState
  
  // === CORE STREAMING ACTIONS ===
  
  // Stream lifecycle
  startNewStream: (userMessage: string) => void
  appendToStream: (content: string) => void
  addToolToStream: (toolCall: ToolCall) => void
  updateToolInStream: (toolId: string, updates: Partial<ToolCall>) => void
  finalizeStream: (metadata?: any) => void
  clearActiveStream: () => void
  
  // Stream content updates
  updateStreamContent: (content: string) => void
  appendTextSegment: (content: string) => void
  addToolStartSegment: (toolCall: ToolCall) => void
  addToolResultSegment: (toolCall: ToolCall) => void
  
  // === APP CONTEXT ACTIONS ===
  
  setCurrentAppId: (appId: string | null) => void
  setInputValue: (value: string) => void
  setIsLoading: (loading: boolean) => void
  setAiEditContext: (context: AiEditContext | null) => void
  setDevelopmentPlan: (plan: PlanItem[]) => void
  setConversations: (conversations: Array<{ id: string; updatedAt: string }>) => void
  
  // === WEBSOCKET ACTIONS ===
  
  setWebSocketState: (state: Partial<WebSocketState>) => void
  setStreamingState: (state: 'idle' | 'streaming' | 'completing' | 'error') => void
  
  // === UTILITY ACTIONS ===
  
  addCompletedMessage: (message: ChatMessage) => void
  clearMessages: () => void
  cleanup: () => void
  
  // === UTILITY FUNCTIONS ===
  
  getMessageCount: () => number
  autoSendInitialMessage: (message: string, appId: string) => boolean
  loadConversationHistory: (appId: string) => Promise<void>
}

// Helper function to generate unique IDs
const generateId = () => `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

// Create the store
export const useStreamingConversationStore = create<StreamingConversationState>()((set, get) => ({
  // === INITIAL STATE ===
  
  messages: [],
  activeStream: null,
  streamingState: 'idle',
  currentStep: 0,
  currentAppId: null,
  inputValue: '',
  isLoading: false,
  aiEditContext: null,
  developmentPlan: [],
  conversations: [],
  appChatHistory: {},
  websocket: {
    connected: false,
    status: 'idle'
  },
  
  // === CORE STREAMING ACTIONS ===
  
  startNewStream: (userMessage: string) => {
    const userMsgId = generateId()
    const assistantMsgId = generateId()
    
    if (process.env.NODE_ENV === 'development') {
      console.log('🚀 startNewStream called:', { userMessage, userMsgId, assistantMsgId })
    }
    
    // Add user message to completed messages
    const userChatMessage: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    }
    
    // Create new streaming message for assistant
    const streamingMessage: StreamingMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      segments: [],
      toolCalls: [],
      timestamp: new Date(),
      isComplete: false
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.log('🚀 Created streaming message:', streamingMessage.id)
    }
    
    set((state) => ({
      messages: [...state.messages, userChatMessage],
      activeStream: streamingMessage,
      streamingState: 'streaming',
      currentStep: 1,
      inputValue: '', // Clear input
      isLoading: true
    }))
    
    if (process.env.NODE_ENV === 'development') {
      console.log('🚀 Stream started - activeStream set')
    }
  },
  
  appendToStream: (content: string) => {
    const { activeStream } = get()
    if (!activeStream) return
    
    const updatedStream = {
      ...activeStream,
      content: activeStream.content + content
    }
    
    set({ activeStream: updatedStream })
  },
  
  updateStreamContent: (content: string) => {
    const { activeStream } = get()
    if (!activeStream) return
    
    set({
      activeStream: {
        ...activeStream,
        content: content
      }
    })
  },
  
  appendTextSegment: (content: string) => {
    const { activeStream } = get()
    
    
    if (!activeStream) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('🔧 No activeStream - cannot append text segment')
      }
      return
    }
    
    const segment: StreamSegment = {
      id: generateId(),
      type: 'text',
      content,
      timestamp: new Date()
    }
    
    const updatedStream = {
      ...activeStream,
      content: activeStream.content + content,
      segments: [...activeStream.segments, segment]
    }
    
    
    set({ activeStream: updatedStream })
  },
  
  addToolToStream: (toolCall: ToolCall) => {
    const { activeStream } = get()
    if (!activeStream) return
    
    const updatedStream = {
      ...activeStream,
      toolCalls: [...activeStream.toolCalls, toolCall]
    }
    
    set({ activeStream: updatedStream })
  },
  
  addToolStartSegment: (toolCall: ToolCall) => {
    const { activeStream } = get()
    if (!activeStream) return
    
    const segment: StreamSegment = {
      id: generateId(),
      type: 'tool_start',
      content: `Starting ${toolCall.name}...`,
      timestamp: new Date(),
      toolCall
    }
    
    const updatedStream = {
      ...activeStream,
      segments: [...activeStream.segments, segment],
      toolCalls: [...activeStream.toolCalls, toolCall]
    }
    
    set({ activeStream: updatedStream })
  },
  
  addToolResultSegment: (toolCall: ToolCall) => {
    const { activeStream } = get()
    if (!activeStream) return
    
    const segment: StreamSegment = {
      id: generateId(),
      type: 'tool_result',
      content: typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result),
      timestamp: new Date(),
      toolCall
    }
    
    const updatedStream = {
      ...activeStream,
      segments: [...activeStream.segments, segment],
      toolCalls: activeStream.toolCalls.map(tc => 
        tc.id === toolCall.id ? toolCall : tc
      )
    }
    
    set({ activeStream: updatedStream })
  },
  
  updateToolInStream: (toolId: string, updates: Partial<ToolCall>) => {
    const { activeStream } = get()
    if (!activeStream) return
    
    const updatedStream = {
      ...activeStream,
      toolCalls: activeStream.toolCalls.map(tc =>
        tc.id === toolId ? { ...tc, ...updates } : tc
      )
    }
    
    set({ activeStream: updatedStream })
  },
  
  finalizeStream: (metadata?: any) => {
    const { activeStream, messages } = get()
    if (!activeStream) return
    
    // Convert streaming message to completed message
    const completedMessage: ChatMessage = {
      id: activeStream.id,
      role: activeStream.role,
      content: activeStream.content,
      segments: activeStream.segments,
      toolCalls: activeStream.toolCalls,
      timestamp: activeStream.timestamp,
      metadata: {
        ...activeStream.metadata,
        ...metadata
      }
    }
    
    set({
      messages: [...messages, completedMessage],
      activeStream: null,
      streamingState: 'idle',
      isLoading: false
    })
  },
  
  clearActiveStream: () => {
    set({
      activeStream: null,
      streamingState: 'idle',
      isLoading: false
    })
  },
  
  // === APP CONTEXT ACTIONS ===
  
  setCurrentAppId: (appId) => {
    const currentState = get()
    
    // If switching to a different app, save current chat and load new app's chat
    if (currentState.currentAppId !== appId) {
      const newAppChatHistory = { ...currentState.appChatHistory }
      
      // Save current app's chat history if we have one
      if (currentState.currentAppId && currentState.messages.length > 0) {
        newAppChatHistory[currentState.currentAppId] = currentState.messages
        console.log(`💾 Saved ${currentState.messages.length} messages for app ${currentState.currentAppId}`)
      }
      
      // Load new app's chat history (or empty array if new app)
      const newAppMessages = appId ? (newAppChatHistory[appId] || []) : []
      
      console.log(`🔄 Switching from app ${currentState.currentAppId} to ${appId} - loaded ${newAppMessages.length} messages from cache`)
      
      set({
        currentAppId: appId,
        messages: newAppMessages,
        activeStream: null,
        streamingState: 'idle',
        currentStep: 0,
        inputValue: '',
        // Don't reset isLoading - let loadConversationHistory manage it
        aiEditContext: null,
        conversations: [],
        appChatHistory: newAppChatHistory,
        websocket: { connected: false, status: 'idle' }
      })
    } else {
      // Same app, just update the ID
      set({ currentAppId: appId })
    }
  },
  setInputValue: (value) => set({ inputValue: value }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setAiEditContext: (context) => set({ aiEditContext: context }),
  setDevelopmentPlan: (plan) => set({ developmentPlan: plan }),
  setConversations: (conversations) => set({ conversations }),
  
  // === WEBSOCKET ACTIONS ===
  
  setWebSocketState: (state) => {
    set((prevState) => ({
      websocket: { ...prevState.websocket, ...state }
    }))
  },
  
  setStreamingState: (state) => set({ streamingState: state }),
  
  // === UTILITY ACTIONS ===
  
  addCompletedMessage: (message) => {
    set((state) => ({
      messages: [...state.messages, message]
    }))
  },
  
  clearMessages: () => {
    set({
      messages: [],
      activeStream: null,
      streamingState: 'idle'
    })
  },
  
  cleanup: () => {
    set({
      messages: [],
      activeStream: null,
      streamingState: 'idle',
      currentStep: 0,
      currentAppId: null,
      inputValue: '',
      isLoading: false,
      aiEditContext: null,
      conversations: [],
      appChatHistory: {},
      websocket: { connected: false, status: 'idle' }
    })
  },
  
  // === UTILITY FUNCTIONS ===
  
  getMessageCount: () => {
    const { messages, activeStream } = get()
    return messages.length + (activeStream ? 1 : 0)
  },
  
  // Auto-send initial message for new apps
  autoSendInitialMessage: (message: string, appId: string) => {
    const state = get()
    
    // Only auto-send if we have no messages for this app and we're not currently loading
    const hasNoMessages = state.messages.length === 0 && !state.activeStream
    const isCorrectApp = state.currentAppId === appId
    const isNotLoading = !state.isLoading && state.streamingState === 'idle'
    
    if (hasNoMessages && isCorrectApp && isNotLoading && message.trim()) {
      console.log('🚀 Auto-sending initial message for new app:', appId, message.substring(0, 50) + '...')
      
      // Set the input value and trigger the send
      set({ inputValue: message.trim() })
      
      // Return true to indicate auto-send was triggered
      return true
    }
    
    console.log('⏭️ Skipping auto-send:', {
      hasNoMessages,
      isCorrectApp,
      isNotLoading,
      hasMessage: !!message.trim(),
      messagesCount: state.messages.length,
      currentAppId: state.currentAppId,
      targetAppId: appId,
      streamingState: state.streamingState
    })
    
    return false
  },
  
  // Load conversation history from backend
  loadConversationHistory: async (appId: string) => {
    const state = get()
    
    // Don't load if already loading
    if (state.isLoading) {
      console.log('⏭️ Skipping conversation history load - already loading')
      return
    }
    
    // Don't load if we already have messages for this app in cache AND they're not just empty
    const cachedMessages = state.appChatHistory[appId]
    if (state.currentAppId === appId && cachedMessages && cachedMessages.length > 0) {
      console.log('⏭️ Skipping conversation history load - already have cached messages:', {
        currentAppId: state.currentAppId,
        targetAppId: appId,
        cachedMessagesCount: cachedMessages.length
      })
      return
    }
    
    try {
      console.log('📚 Loading conversation history for app:', appId)
      set({ isLoading: true })
      
      // Import buildDynamicAgentUrl dynamically to avoid circular imports
      const { buildDynamicAgentUrl } = await import('../config/dynamic-api')
      
      // Build dynamic agent URL for conversations endpoint (no /apps/{appId}/ prefix)
      const conversationsUrl = await buildDynamicAgentUrl(`agent/conversations/${appId}`, appId)
      console.log('📚 Fetching conversations from:', conversationsUrl)
      
      // Fetch conversations for this app
      const response = await fetch(conversationsUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch conversations: ${response.status}`)
      }
      
      const conversations = await response.json()
      console.log('📚 Found conversations:', conversations.length)
      
      if (conversations.length === 0) {
        console.log('📚 No conversation history found for app:', appId)
        set({ isLoading: false })
        return
      }
      
      // Get the most recent conversation (conversations are ordered by updated_at DESC)
      const latestConversation = conversations[0]
      console.log('📚 Loading latest conversation:', latestConversation.id)
      
      // Build dynamic agent URL for messages endpoint (no /apps/{appId}/ prefix)
      const messagesUrl = await buildDynamicAgentUrl(`agent/conversations/${appId}/${latestConversation.id}`, appId)
      console.log('📚 Fetching messages from:', messagesUrl)
      
      // Fetch messages for the latest conversation
      const messagesResponse = await fetch(messagesUrl)
      if (!messagesResponse.ok) {
        throw new Error(`Failed to fetch messages: ${messagesResponse.status}`)
      }
      
      const conversationData = await messagesResponse.json()
      const messages = conversationData.messages || []
      
      console.log('📚 Loaded messages:', messages.length)
      
      // Convert backend messages to frontend format (no normalization needed - backend uses correct field names)
      const convertedMessages: ChatMessage[] = messages.map((msg: any) => ({
        id: msg.id,
        role: msg.sender === 'user' ? 'user' : 'assistant',
        type: msg.sender === 'user' ? 'user' : 'assistant',
        sender: msg.sender, // Preserve original sender field for Message.tsx compatibility
        content: msg.content,
        timestamp: new Date(msg.createdAt),
        toolCalls: msg.toolCalls || [],
        segments: (msg.segments || []).map((segment: any) => ({
          id: segment.id,
          type: segment.type,
          content: segment.content || '',
          timestamp: new Date(segment.timestamp || segment.createdAt || msg.createdAt),
          toolCall: segment.toolCall // Backend now uses correct camelCase field names
        })),
        metadata: msg.metadata
      }))
      
      
      // Update the store with loaded messages and cache them
      set((state) => {
        // Update both the current messages and the app cache
        const newAppChatHistory = { ...state.appChatHistory }
        newAppChatHistory[appId] = convertedMessages
        
        return {
          messages: convertedMessages,
          conversations: conversations,
          appChatHistory: newAppChatHistory,
          isLoading: false
        }
      })
      
      console.log('✅ Conversation history loaded successfully:', {
        appId,
        messagesCount: convertedMessages.length,
        conversationsCount: conversations.length
      })
      
    } catch (error) {
      console.error('❌ Failed to load conversation history:', error)
      set({ isLoading: false })
      
      // Don't throw - just log and continue with empty history
      console.log('📚 Continuing with empty conversation history for app:', appId)
    }
  }
}))

// === SELECTORS ===

export const useMessages = () => useStreamingConversationStore(state => state.messages)
export const useActiveStream = () => useStreamingConversationStore(state => state.activeStream)

// Simple approach: remove the problematic combined selector
// Components should use useMessages and useActiveStream separately and combine with useMemo
export const useStreamingState = () => useStreamingConversationStore(state => state.streamingState)

// Memoized selector for streaming check
const isActivelyStreamingSelector = (state: StreamingConversationState) => 
  state.streamingState === 'streaming' && !!state.activeStream

export const useIsActivelyStreaming = () => useStreamingConversationStore(isActivelyStreamingSelector)
export const useInputValue = () => useStreamingConversationStore(state => state.inputValue)
export const useIsLoading = () => useStreamingConversationStore(state => state.isLoading)
export const useCurrentAppId = () => useStreamingConversationStore(state => state.currentAppId)
export const useWebSocketState = () => useStreamingConversationStore(state => state.websocket)

// Individual action selectors to prevent infinite loops
export const useStartNewStream = () => useStreamingConversationStore(state => state.startNewStream)
export const useAppendTextSegment = () => useStreamingConversationStore(state => state.appendTextSegment)
export const useAddToolStartSegment = () => useStreamingConversationStore(state => state.addToolStartSegment)
export const useAddToolResultSegment = () => useStreamingConversationStore(state => state.addToolResultSegment)
export const useFinalizeStream = () => useStreamingConversationStore(state => state.finalizeStream)
export const useAutoSendInitialMessage = () => useStreamingConversationStore(state => state.autoSendInitialMessage)
export const useLoadConversationHistory = () => useStreamingConversationStore(state => state.loadConversationHistory)

export const useSetCurrentAppId = () => useStreamingConversationStore(state => state.setCurrentAppId)
export const useSetInputValue = () => useStreamingConversationStore(state => state.setInputValue)
export const useSetIsLoading = () => useStreamingConversationStore(state => state.setIsLoading)
export const useSetAiEditContext = () => useStreamingConversationStore(state => state.setAiEditContext)
export const useSetDevelopmentPlan = () => useStreamingConversationStore(state => state.setDevelopmentPlan)
export const useSetConversations = () => useStreamingConversationStore(state => state.setConversations)

export const useSetWebSocketState = () => useStreamingConversationStore(state => state.setWebSocketState)
export const useSetStreamingState = () => useStreamingConversationStore(state => state.setStreamingState)

export const useDevelopmentPlan = () => useStreamingConversationStore(state => state.developmentPlan)
export const useAiEditContext = () => useStreamingConversationStore(state => state.aiEditContext)
export const useConversations = () => useStreamingConversationStore(state => state.conversations)

// Note: useStreamingActions has been removed to prevent infinite loops.
// Use individual selectors above instead.
