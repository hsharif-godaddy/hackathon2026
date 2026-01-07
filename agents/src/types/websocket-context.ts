/**
 * App-specific WebSocket context types
 * These extend the generic ai-lib ChatMessage with application-specific context
 */

import type { ChatMessage } from '@airo/ai-lib'
import type { ContextAttachment } from './context-attachment.js'
import type { ClientActionService } from '../services/ClientActionService.js'

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
    clientActionService?: ClientActionService
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
 * App-specific ChatMessage with typed context
 */
export interface AgentsAppChatMessage extends Omit<ChatMessage, 'context'> {
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
