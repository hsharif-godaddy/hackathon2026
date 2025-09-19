/**
 * App-specific WebSocket context types for the frontend
 * These match the backend types but are defined separately to avoid coupling
 */

/**
 * App-specific context structure for agents application
 */
export interface AgentsAppContext {
  // Basic metadata
  metadata?: {
    appId?: string
    userId?: string
    sessionId?: string
    [key: string]: unknown
  }
  
  // Conversation context
  conversation?: {
    conversationId?: string
    maxMessages?: number
    includeHistory?: boolean
  }
  
  // App context - project understanding
  appContext?: {
    includeDirectoryListing?: boolean
    includePackageInfo?: boolean
    includeDependencyStatus?: boolean
    maxDirectoryDepth?: number
  }
  
  // AI Edit context - selected element information
  aiEditContext?: {
    elementInfo?: {
      tagName?: string
      className?: string
      id?: string
      textContent?: string
    }
    devContext?: {
      fileName?: string
      componentName?: string
      lineNumber?: number
    }
    selector?: string
  }
  
  // Visual context - user's current view state
  visualContext?: {
    page?: string
    scroll_position?: { x: number; y: number }
    active_section?: string
    viewport?: { width: number; height: number }
    timestamp?: number
  }
  
  // Extensibility for future context types
  [key: string]: unknown
}

/**
 * App-specific ChatMessageData with typed context
 */
export interface AgentsAppChatMessage {
  message: string
  timestamp?: string
  agentId?: string
  context?: AgentsAppContext
}
