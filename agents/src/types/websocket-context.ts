/**
 * App-specific WebSocket context types
 * These extend the generic ai-lib ChatMessageData with application-specific context
 */

import type { ChatMessageData } from '@airo/ai-lib'

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
  
  // Image upload context
  uploadedFiles?: {
    uploadId: string
    files: Array<{
      id: string
      originalName: string
      filename: string
      size: number
      mimeType: string | null
      uploadedAt: string
    }>
  }
  
  // Extensibility for future context types
  [key: string]: unknown
}

/**
 * App-specific ChatMessageData with typed context
 */
export interface AgentsAppChatMessageData extends Omit<ChatMessageData, 'context'> {
  context?: AgentsAppContext
}

/**
 * Type guard to check if context is AgentsAppContext
 */
export function isAgentsAppContext(context: unknown): context is AgentsAppContext {
  return typeof context === 'object' && context !== null
}

/**
 * Helper to safely extract app-specific context from generic context
 */
export function extractAgentsAppContext(context: Record<string, unknown> | undefined): AgentsAppContext | undefined {
  if (!context || !isAgentsAppContext(context)) {
    return undefined
  }
  return context
}
