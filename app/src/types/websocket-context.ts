/**
 * App-specific WebSocket context types for the frontend
 * These match the backend types but are defined separately to avoid coupling
 */

import type { ContextAttachment } from './context-attachment'

/**
 * App-specific context structure for agents application
 */
export interface AgentsAppContext {
  // Generic context attachments (new flexible system)
  contextAttachments?: ContextAttachment[]
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
