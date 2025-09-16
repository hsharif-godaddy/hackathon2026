import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

export type MessageSegment = {
  id: string
  type: 'text'
  content: string
  timestamp: Date
} | {
  id: string
  type: 'tool'
  toolCall: ToolCall
  timestamp: Date
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  segments?: MessageSegment[] // Chronological segments for agentic messages
  toolCalls?: ToolCall[] // Legacy support
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cachedInputTokens?: number
  }
  metadata?: {
    attachedFiles?: Array<{
      name: string
      size: number
      type: string | null
    }>
    [key: string]: unknown
  }
  isAgentic?: boolean
  agenticSteps?: AgenticStep[]
}

export interface ToolCall {
  id?: string
  name: string
  input: Record<string, unknown>
  result?: Record<string, unknown>
  status?: 'running' | 'completed' | 'error'
}

export interface AgenticStep {
  step: number
  content: string
  toolCalls: ToolCall[]
  isFinal: boolean
}

export interface CurrentStep {
  step: number
  content: string
  toolCalls: ToolCall[]
}

export interface WebSocketState {
  connected: boolean
  status: 'idle' | 'thinking' | 'processing' | 'complete' | 'error'
}

export interface ConversationState {
  // Messages
  messages: ChatMessage[]
  currentMessage: ChatMessage | null
  
  // WebSocket state
  websocket: WebSocketState
  
  // Current streaming state
  currentStep: CurrentStep | null
  
  // Actions
  addMessage: (message: ChatMessage) => void
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void
  setCurrentMessage: (message: ChatMessage | null) => void
  appendToCurrentMessage: (content: string) => void
  addToolCallToCurrentMessage: (toolCall: ToolCall) => void
  updateToolCallInCurrentMessage: (toolCallId: string, updates: Partial<ToolCall>) => void
  finalizeCurrentMessage: () => void
  
  // Segment-based actions for chronological rendering
  addTextSegmentToCurrentMessage: (content: string) => void
  addToolSegmentToCurrentMessage: (toolCall: ToolCall) => void
  updateToolSegmentInCurrentMessage: (toolCallId: string, updates: Partial<ToolCall>) => void
  
  // WebSocket actions
  setWebSocketState: (state: Partial<WebSocketState>) => void
  
  // Step actions
  setCurrentStep: (step: CurrentStep | null) => void
  updateCurrentStep: (updates: Partial<CurrentStep>) => void
  
  // Utility actions
  clearMessages: () => void
  getMessageCount: () => number
}

export const useConversationStore = create<ConversationState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    messages: [],
    currentMessage: null,
    websocket: {
      connected: false,
      status: 'idle'
    },
    currentStep: null,
    
    // Message actions
    addMessage: (message) => {
      set((state) => ({
        messages: [...state.messages, message]
      }))
    },
    
    updateMessage: (id, updates) => {
      set((state) => ({
        messages: state.messages.map(msg => 
          msg.id === id ? { ...msg, ...updates } : msg
        )
      }))
    },
    
    setCurrentMessage: (message) => {
      set({ currentMessage: message })
    },
    
    appendToCurrentMessage: (content) => {
      const { currentMessage, updateMessage } = get()
      if (currentMessage) {
        const newContent = (currentMessage.content || '') + content
        
        // Update both currentMessage and the message in the array
        set({ 
          currentMessage: { ...currentMessage, content: newContent }
        })
        
        updateMessage(currentMessage.id, { content: newContent })
      }
    },
    
    addToolCallToCurrentMessage: (toolCall) => {
      const { currentMessage, updateMessage } = get()
      if (currentMessage) {
        const existingToolCalls = currentMessage.toolCalls || []
        const newToolCalls = [...existingToolCalls, toolCall]
        
        // Update both currentMessage and the message in the array
        set({ 
          currentMessage: { ...currentMessage, toolCalls: newToolCalls }
        })
        
        updateMessage(currentMessage.id, { toolCalls: newToolCalls })
      }
    },
    
    updateToolCallInCurrentMessage: (toolCallId, updates) => {
      const { currentMessage, updateMessage } = get()
      if (currentMessage && currentMessage.toolCalls) {
        const updatedToolCalls = currentMessage.toolCalls.map(tool => 
          tool.id === toolCallId ? { ...tool, ...updates } : tool
        )
        
        // Update both currentMessage and the message in the array
        set({ 
          currentMessage: { ...currentMessage, toolCalls: updatedToolCalls }
        })
        
        updateMessage(currentMessage.id, { toolCalls: updatedToolCalls })
      }
    },
    
    finalizeCurrentMessage: () => {
      const { currentMessage } = get()
      if (currentMessage) {
        // Ensure the final message is in the messages array
        set((state) => {
          const messageExists = state.messages.some(msg => msg.id === currentMessage.id)
          if (!messageExists) {
            return {
              messages: [...state.messages, currentMessage],
              currentMessage: null
            }
          }
          return { currentMessage: null }
        })
      }
    },
    
    // Segment-based actions for chronological rendering
    addTextSegmentToCurrentMessage: (content) => {
      const { currentMessage, updateMessage } = get()
      if (currentMessage) {
        const newSegment: MessageSegment = {
          id: `text-${Date.now()}-${Math.random()}`,
          type: 'text',
          content,
          timestamp: new Date()
        }
        
        const existingSegments = currentMessage.segments || []
        const newSegments = [...existingSegments, newSegment]
        
        // Also update the main content for backward compatibility
        const newContent = (currentMessage.content || '') + content
        
        set({ 
          currentMessage: { 
            ...currentMessage, 
            content: newContent,
            segments: newSegments 
          }
        })
        
        updateMessage(currentMessage.id, { 
          content: newContent,
          segments: newSegments 
        })
      }
    },
    
    addToolSegmentToCurrentMessage: (toolCall) => {
      const { currentMessage, updateMessage } = get()
      if (currentMessage) {
        const newSegment: MessageSegment = {
          id: `tool-${toolCall.id || Date.now()}`,
          type: 'tool',
          toolCall,
          timestamp: new Date()
        }
        
        const existingSegments = currentMessage.segments || []
        const newSegments = [...existingSegments, newSegment]
        
        // Also update toolCalls array for backward compatibility
        const existingToolCalls = currentMessage.toolCalls || []
        const newToolCalls = [...existingToolCalls, toolCall]
        
        set({ 
          currentMessage: { 
            ...currentMessage, 
            segments: newSegments,
            toolCalls: newToolCalls
          }
        })
        
        updateMessage(currentMessage.id, { 
          segments: newSegments,
          toolCalls: newToolCalls
        })
      }
    },
    
    updateToolSegmentInCurrentMessage: (toolCallId, updates) => {
      const { currentMessage, updateMessage } = get()
      if (currentMessage && currentMessage.segments) {
        const updatedSegments = currentMessage.segments.map(segment => {
          if (segment.type === 'tool' && segment.toolCall.id === toolCallId) {
            return {
              ...segment,
              toolCall: { ...segment.toolCall, ...updates }
            }
          }
          return segment
        })
        
        // Also update toolCalls array for backward compatibility
        const updatedToolCalls = (currentMessage.toolCalls || []).map(tool => 
          tool.id === toolCallId ? { ...tool, ...updates } : tool
        )
        
        set({ 
          currentMessage: { 
            ...currentMessage, 
            segments: updatedSegments,
            toolCalls: updatedToolCalls
          }
        })
        
        updateMessage(currentMessage.id, { 
          segments: updatedSegments,
          toolCalls: updatedToolCalls
        })
      }
    },
    
    // WebSocket actions
    setWebSocketState: (state) => {
      set((prevState) => ({
        websocket: { ...prevState.websocket, ...state }
      }))
    },
    
    // Step actions
    setCurrentStep: (step) => {
      set({ currentStep: step })
    },
    
    updateCurrentStep: (updates) => {
      set((state) => ({
        currentStep: state.currentStep 
          ? { ...state.currentStep, ...updates }
          : null
      }))
    },
    
    // Utility actions
    clearMessages: () => {
      set({ 
        messages: [],
        currentMessage: null,
        currentStep: null
      })
    },
    
    getMessageCount: () => {
      return get().messages.length
    }
  }))
)

// Selectors for common use cases
export const useMessages = () => useConversationStore(state => state.messages)
export const useCurrentMessage = () => useConversationStore(state => state.currentMessage)
export const useWebSocketState = () => useConversationStore(state => state.websocket)
export const useCurrentStep = () => useConversationStore(state => state.currentStep)
export const useMessageCount = () => useConversationStore(state => state.getMessageCount())

// Actions selectors - memoized to prevent infinite loops
export const useConversationActions = () => useConversationStore(state => state)
