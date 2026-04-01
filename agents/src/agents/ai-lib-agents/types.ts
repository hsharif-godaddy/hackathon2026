/**
 * Enhanced types for AI-Lib agents with rich context support
 */

import type { ContextAttachment } from '@airo/shared/context-attachment'

/**
 * Enhanced Agent Context Interface
 * Extends the basic ai-lib AgentContext with rich conversation and app context
 */
export interface EnhancedAgentContext {
  // Generic context attachments (new flexible system)
  contextAttachments?: ContextAttachment[]
  // Basic context (already supported by ai-lib)
  metadata?: {
    appId?: string
    userId?: string
    sessionId?: string
    [key: string]: unknown
  }
  
  // Conversation context for history and continuity
  conversation?: {
    conversationId?: string
    maxMessages?: number
    includeHistory?: boolean
  }
  
  // App context for project understanding
  appContext?: {
    includeDirectoryListing?: boolean
    includePackageInfo?: boolean
    includeDependencyStatus?: boolean
    maxDirectoryDepth?: number
  }
}

/**
 * Context message types for building rich prompts
 */
export interface ContextMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  type?: 'app_context_stable' | 'app_context_secrets' | 'app_context_media_slots' | 'ai_edit_context' | 'visual_context' | 'conversation_history' | 'selected_assets_context' | 'build_error_context'
  insertionOrder?: 'before_history' | 'after_history'
  cachePoint?: { type: 'ephemeral' }
}

/**
 * Configuration for context generation
 */
export interface ContextGenerationConfig {
  includeAppContext: boolean
  includeConversationHistory: boolean
  maxHistoryMessages: number
  maxDirectoryDepth: number
}

/**
 * Default context generation configuration
 */
export const DEFAULT_CONTEXT_CONFIG: ContextGenerationConfig = {
  includeAppContext: true,
  includeConversationHistory: true,
  maxHistoryMessages: 500,
  maxDirectoryDepth: 3
}

/**
 * Agent-specific context preferences
 * Allows per-agent customization of context rendering
 */
export interface AgentContextPreferences {
  includeAppContext?: boolean
  includeConversationHistory?: boolean
  includeTemplateDescription?: boolean
  maxHistoryMessages?: number
  maxDirectoryDepth?: number
}
