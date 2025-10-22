/**
 * Streaming-First Conversation Store
 *
 * Clean architecture designed for real-time AI streaming responses.
 * No backward compatibility - built for streaming from the ground up.
 */

import { create } from 'zustand'
import type { AiEditContext, PlanItem } from '../app/develop/components/types'
import { logger } from '@/lib/request-context'

// Core streaming segment types
export interface StreamSegment {
  id: string
  type: 'text' | 'tool_start' | 'tool_result' | 'tool_call' | 'content'
  content: string
  timestamp: Date
  toolCall?: ToolCall
}

export interface Conversation {
  id: string
  appId: string
  agentId: string
  title?: string
  createdAt: Date
  updatedAt: Date
  messageCount: number
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
  duration?: number
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
  maxStepsReached?: boolean        // True when agent hit max steps limit
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
  maxStepsReached?: boolean        // True when agent hit max steps limit
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

// Error state for retry functionality
export interface ErrorState {
  hasError: boolean
  errorMessage: string | null
  failedMessage: string | null  // Original user message that failed
  failedContext: AiEditContext | null  // AI edit context at time of failure
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
  conversations: Conversation[]

  // Pagination state
  conversationPagination: {
    total: number
    loaded: number
    hasMore: boolean
    isLoading: boolean
  }

  // Per-app chat history cache (for future enhancement)
  appChatHistory: Record<string, ChatMessage[]>

  // WebSocket state
  websocket: WebSocketState

  // Error state
  errorState: ErrorState

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
  markMaxStepsReached: () => void

  // === APP CONTEXT ACTIONS ===

  setCurrentAppId: (appId: string | null) => void
  setInputValue: (value: string) => void
  setIsLoading: (loading: boolean) => void
  setAiEditContext: (context: AiEditContext | null) => void
  setDevelopmentPlan: (plan: PlanItem[]) => void
  setConversations: (conversations: Conversation[]) => void

  // === WEBSOCKET ACTIONS ===

  setWebSocketState: (state: Partial<WebSocketState>) => void
  setStreamingState: (state: 'idle' | 'streaming' | 'completing' | 'error') => void

  // === ERROR RECOVERY ACTIONS ===

  setErrorState: (errorMessage: string, failedMessage?: string, failedContext?: AiEditContext | null) => void
  clearErrorState: () => void
  retryLastMessage: () => Promise<void>

  // === UTILITY ACTIONS ===

  addCompletedMessage: (message: ChatMessage) => void
  clearMessages: () => void
  cleanup: () => void

  // === UTILITY FUNCTIONS ===

  getMessageCount: () => number
  autoSendInitialMessage: (message: string, appId: string) => boolean
  loadConversationHistory: (appId: string) => Promise<void>
  loadMoreConversations: (appId: string) => Promise<void>
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
  conversationPagination: {
    total: 0,
    loaded: 0,
    hasMore: false,
    isLoading: false
  },
  appChatHistory: {},
  websocket: {
    connected: false,
    status: 'idle'
  },
  errorState: {
    hasError: false,
    errorMessage: null,
    failedMessage: null,
    failedContext: null
  },

  // === CORE STREAMING ACTIONS ===

  startNewStream: (userMessage: string) => {
    const userMsgId = generateId()
    const assistantMsgId = generateId()

    if (process.env.NODE_ENV === 'development') {
      logger.debug('streaming-store.start-stream', { message: 'startNewStream called', userMessage, userMsgId, assistantMsgId })
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
      logger.debug('streaming-store.create-message', { message: 'Created streaming message', id: streamingMessage.id })
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
      logger.debug('streaming-store.stream-started', { message: 'Stream started - activeStream set' })
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
        logger.warn('streaming-store.append-text.no-stream', { message: 'No activeStream - cannot append text segment' })
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

  markMaxStepsReached: () => {
    const { activeStream } = get()
    if (!activeStream) return

    const updatedStream = {
      ...activeStream,
      maxStepsReached: true
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
      maxStepsReached: activeStream.maxStepsReached,
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
        logger.info('streaming-store.save-messages', { message: 'Saved messages for app', count: currentState.messages.length, appId: currentState.currentAppId })
      }

      // Load new app's chat history (or empty array if new app)
      const newAppMessages = appId ? (newAppChatHistory[appId] || []) : []

      logger.info('streaming-store.switch-app', { message: 'Switching app', fromAppId: currentState.currentAppId, toAppId: appId, messagesLoaded: newAppMessages.length })

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
        conversationPagination: {
          total: 0,
          loaded: 0,
          hasMore: false,
          isLoading: false
        },
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

  // === ERROR RECOVERY ACTIONS ===

  setErrorState: (errorMessage, failedMessage, failedContext) => {
    logger.error('streaming-store.error-state.set', {
      message: 'Setting error state for retry',
      errorMessage,
      hasFailedMessage: !!failedMessage,
      hasFailedContext: !!failedContext
    })

    set({
      errorState: {
        hasError: true,
        errorMessage,
        failedMessage: failedMessage || null,
        failedContext: failedContext || null
      },
      streamingState: 'error',
      isLoading: false
    })
  },

  clearErrorState: () => {
    logger.info('streaming-store.error-state.clear', { message: 'Clearing error state' })
    set({
      errorState: {
        hasError: false,
        errorMessage: null,
        failedMessage: null,
        failedContext: null
      }
    })
  },

  retryLastMessage: async () => {
    const { errorState, currentAppId } = get()

    if (!errorState.hasError || !errorState.failedMessage) {
      logger.warn('streaming-store.retry.no-error', { message: 'No error state to retry' })
      return
    }

    logger.info('streaming-store.retry.begin', {
      message: 'Retrying last message',
      messagePreview: errorState.failedMessage.slice(0, 50) + '...',
      hasContext: !!errorState.failedContext
    })

    // Clear error state before retry
    get().clearErrorState()

    // The retry will be handled by the WebSocket hook through a custom event
    // Dispatch event with retry details
    const retryEvent = new CustomEvent('airo-retry-message', {
      detail: {
        message: errorState.failedMessage,
        context: errorState.failedContext,
        appId: currentAppId
      }
    })
    window.dispatchEvent(retryEvent)
  },

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
      conversationPagination: {
        total: 0,
        loaded: 0,
        hasMore: false,
        isLoading: false
      },
      appChatHistory: {},
      websocket: { connected: false, status: 'idle' },
      errorState: {
        hasError: false,
        errorMessage: null,
        failedMessage: null,
        failedContext: null
      }
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
      logger.info('streaming-store.auto-send', { message: 'Auto-sending initial message for new app', appId, messagePreview: message.substring(0, 50) + '...' })

      // Set the input value and trigger the send
      set({ inputValue: message.trim() })

      // Return true to indicate auto-send was triggered
      return true
    }

    logger.debug('streaming-store.auto-send-skip', {
      message: 'Skipping auto-send',
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
      logger.debug('streaming-store.load-history.skip-loading', { message: 'Skipping conversation history load - already loading' })
      return
    }

    // Don't load if we already have messages for this app in cache AND they're not just empty
    const cachedMessages = state.appChatHistory[appId]
    if (state.currentAppId === appId && cachedMessages && cachedMessages.length > 0) {
      logger.debug('streaming-store.load-history.skip-cached', {
        message: 'Skipping conversation history load - already have cached messages',
        currentAppId: state.currentAppId,
        targetAppId: appId,
        cachedMessagesCount: cachedMessages.length
      })
      return
    }

    try {
      logger.info('streaming-store.load-history.begin', { message: 'Loading conversation history for app', appId })
      set({ isLoading: true })

      // Add timeout protection
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Conversation history request timeout')), 10000)
      })

      // Import buildDynamicAgentUrl dynamically to avoid circular imports
      const { buildDynamicAgentUrl } = await import('../config/dynamic-api')

      // Build dynamic agent URL for conversations endpoint (no /apps/{appId}/ prefix)
      const conversationsUrl = await buildDynamicAgentUrl(`agent/conversations/${appId}?limit=1&offset=0`, appId)
      logger.debug('streaming-store.load-history.fetch', { message: 'Fetching conversations from URL', url: conversationsUrl })

      // Import agentFetch dynamically to avoid circular imports
      const { agentFetch } = await import('../lib/agent-fetch')

      // Fetch conversations for this app with timeout protection
      const response = await Promise.race([
        agentFetch(conversationsUrl, { siteId: appId }),
        timeoutPromise
      ]) as Response
      if (!response.ok) {
        throw new Error(`Failed to fetch conversations: ${response.status}`)
      }

      const data = await response.json()
      const conversations = data.conversations || []
      logger.debug('streaming-store.load-history.found', { message: 'Found conversations', count: conversations.length })

      if (conversations.length === 0) {
        logger.info('streaming-store.load-history.empty', { message: 'No conversation history found for app', appId })
        set({
          isLoading: false,
          conversationPagination: {
            total: data.pagination?.total || 0,
            loaded: 0,
            hasMore: false,
            isLoading: false
          },
          // Ensure we cache empty results to prevent repeated attempts
          appChatHistory: { ...get().appChatHistory, [appId]: [] }
        })
        return
      }

      // Get the most recent conversation (conversations are ordered by updated_at DESC)
      const latestConversation = conversations[0]
      logger.debug('streaming-store.load-history.latest', { message: 'Loading latest conversation', conversationId: latestConversation.id })

      // Build dynamic agent URL for messages endpoint (no /apps/{appId}/ prefix)
      const messagesUrl = await buildDynamicAgentUrl(`agent/conversations/${appId}/${latestConversation.id}`, appId)
      logger.debug('streaming-store.load-history.fetch-messages', { message: 'Fetching messages from URL', url: messagesUrl })

      // Fetch messages for the latest conversation
      const messagesResponse = await agentFetch(messagesUrl, { siteId: appId })
      if (!messagesResponse.ok) {
        throw new Error(`Failed to fetch messages: ${messagesResponse.status}`)
      }

      const conversationData = await messagesResponse.json()
      const messages = conversationData.messages || []

      logger.debug('streaming-store.load-history.loaded-messages', { message: 'Loaded messages', count: messages.length })

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

      // Convert conversation dates from strings to Date objects
      const convertedConversations: Conversation[] = conversations.map((conv: any) => ({
        ...conv,
        createdAt: new Date(conv.createdAt),
        updatedAt: new Date(conv.updatedAt)
      }))

      // Update the store with loaded messages and cache them
      set((state) => {
        // Update both the current messages and the app cache
        const newAppChatHistory = { ...state.appChatHistory }
        newAppChatHistory[appId] = convertedMessages

        return {
          messages: convertedMessages,
          conversations: convertedConversations,
          conversationPagination: {
            total: data.pagination?.total || 0,
            loaded: convertedConversations.length,
            hasMore: data.pagination?.hasMore || false,
            isLoading: false
          },
          appChatHistory: newAppChatHistory,
          isLoading: false
        }
      })

      logger.info('streaming-store.load-history.success', {
        message: 'Conversation history loaded successfully',
        appId,
        messagesCount: convertedMessages.length,
        conversationsCount: conversations.length
      })

    } catch (error) {
      logger.error('streaming-store.load-history.failure', {
        message: 'Failed to load conversation history',
        appId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
      set({
        isLoading: false,
        conversationPagination: {
          total: 0,
          loaded: 0,
          hasMore: false,
          isLoading: false
        },
        // Cache empty result to prevent repeated failed attempts
        appChatHistory: { ...get().appChatHistory, [appId]: [] }
      })

      // Don't throw - just log and continue with empty history
      logger.info('streaming-store.load-history.continue-empty', { message: 'Continuing with empty conversation history for app', appId })
    }
  },

  // Load more conversations from previous history
  loadMoreConversations: async (appId: string) => {
    const state = get()

    // Don't load if already loading or no more to load
    if (state.conversationPagination.isLoading || !state.conversationPagination.hasMore) {
      logger.debug('streaming-store.load-more.skip', { message: 'Skipping load more - already loading or no more to load' })
      return
    }

    try {
      logger.info('streaming-store.load-more.begin', { message: 'Loading more conversations for app', appId })
      set((state) => ({
        conversationPagination: {
          ...state.conversationPagination,
          isLoading: true
        }
      }))

      // Import buildDynamicAgentUrl dynamically to avoid circular imports
      const { buildDynamicAgentUrl } = await import('../config/dynamic-api')

      const offset = state.conversationPagination.loaded
      const limit = 5 // Load 5 more conversations at a time

      // Import agentFetch dynamically to avoid circular imports
      const { agentFetch } = await import('../lib/agent-fetch')

      // Fetch older conversations
      const conversationsUrl = await buildDynamicAgentUrl(`agent/conversations/${appId}?limit=${limit}&offset=${offset}`, appId)
      logger.debug('streaming-store.load-more.fetch', { message: 'Fetching more conversations from URL', url: conversationsUrl })

      const response = await agentFetch(conversationsUrl, { siteId: appId })
      if (!response.ok) {
        throw new Error(`Failed to fetch more conversations: ${response.status}`)
      }

      const data = await response.json()
      const newConversations = data.conversations || []
      logger.debug('streaming-store.load-more.found', { message: 'Found additional conversations', count: newConversations.length })

      if (newConversations.length === 0) {
        set((state) => ({
          conversationPagination: {
            ...state.conversationPagination,
            hasMore: false,
            isLoading: false
          }
        }))
        return
      }

      // Convert conversations
      const convertedNewConversations = newConversations.map((conv: any) => ({
        ...conv,
        createdAt: new Date(conv.createdAt),
        updatedAt: new Date(conv.updatedAt)
      }))

      // Load messages for all new conversations
      const conversationIds = newConversations.map((conv: any) => conv.id).join(',')
      const messagesUrl = await buildDynamicAgentUrl(`agent/conversations/${appId}/messages?conversationIds=${conversationIds}`, appId)

      const messagesResponse = await agentFetch(messagesUrl, { siteId: appId })
      if (!messagesResponse.ok) {
        throw new Error(`Failed to fetch conversation messages: ${messagesResponse.status}`)
      }

      const messagesData = await messagesResponse.json()
      const newMessages = messagesData.messages || []

      logger.debug('streaming-store.load-more.loaded-messages', { message: 'Loaded messages for older conversations', count: newMessages.length })

      // Convert backend messages to frontend format
      const convertedNewMessages: ChatMessage[] = newMessages.map((msg: any) => ({
        id: msg.id,
        role: msg.sender === 'user' ? 'user' : 'assistant',
        type: msg.sender === 'user' ? 'user' : 'assistant',
        sender: msg.sender,
        content: msg.content,
        timestamp: new Date(msg.createdAt),
        toolCalls: msg.toolCalls || [],
        segments: (msg.segments || []).map((segment: any) => ({
          id: segment.id,
          type: segment.type,
          content: segment.content || '',
          timestamp: new Date(segment.timestamp || segment.createdAt || msg.createdAt),
          toolCall: segment.toolCall
        })),
        metadata: msg.metadata
      }))

      // Update store with new conversations and messages
      set((state) => {
        const combinedMessages = [...convertedNewMessages, ...state.messages].sort(
          (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
        )

        const newAppChatHistory = { ...state.appChatHistory }
        newAppChatHistory[appId] = combinedMessages

        return {
          messages: combinedMessages,
          conversations: [...state.conversations, ...convertedNewConversations],
          conversationPagination: {
            total: data.pagination?.total || state.conversationPagination.total,
            loaded: state.conversationPagination.loaded + convertedNewConversations.length,
            hasMore: data.pagination?.hasMore || false,
            isLoading: false
          },
          appChatHistory: newAppChatHistory
        }
      })

      logger.info('streaming-store.load-more.success', {
        message: 'More conversations loaded successfully',
        appId,
        newConversationsCount: convertedNewConversations.length,
        newMessagesCount: convertedNewMessages.length,
        totalLoaded: state.conversationPagination.loaded + convertedNewConversations.length
      })

    } catch (error) {
      logger.error('streaming-store.load-more.failure', { message: 'Failed to load more conversations', error: error instanceof Error ? error.message : String(error) })
      set((state) => ({
        conversationPagination: {
          ...state.conversationPagination,
          isLoading: false
        }
      }))
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
export const useMarkMaxStepsReached = () => useStreamingConversationStore(state => state.markMaxStepsReached)
export const useFinalizeStream = () => useStreamingConversationStore(state => state.finalizeStream)
export const useAutoSendInitialMessage = () => useStreamingConversationStore(state => state.autoSendInitialMessage)
export const useLoadConversationHistory = () => useStreamingConversationStore(state => state.loadConversationHistory)
export const useLoadMoreConversations = () => useStreamingConversationStore(state => state.loadMoreConversations)
export const useConversationPagination = () => useStreamingConversationStore(state => state.conversationPagination)

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

// Error state selectors
export const useErrorState = () => useStreamingConversationStore(state => state.errorState)
export const useSetErrorState = () => useStreamingConversationStore(state => state.setErrorState)
export const useClearErrorState = () => useStreamingConversationStore(state => state.clearErrorState)
export const useRetryLastMessage = () => useStreamingConversationStore(state => state.retryLastMessage)
