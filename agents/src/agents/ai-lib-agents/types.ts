/**
 * Enhanced types for AI-Lib agents with rich context support
 */

/**
 * Enhanced Agent Context Interface
 * Extends the basic ai-lib AgentContext with rich conversation and app context
 */
export interface EnhancedAgentContext {
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
  
  // AI Edit context for selected element information
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
  
  // Visual context from iframe interactions
  visualContext?: {
    page?: string
    scroll_position?: { x: number; y: number }
    active_section?: string
    viewport?: { width: number; height: number }
    timestamp?: number
  }
}

/**
 * Context message types for building rich prompts
 */
export interface ContextMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  type?: 'app_context' | 'ai_edit_context' | 'visual_context' | 'conversation_history'
  insertionOrder?: 'before_history' | 'after_history'
  cachePoint?: { type: 'ephemeral' }
}

/**
 * Configuration for context generation
 */
export interface ContextGenerationConfig {
  includeAppContext: boolean
  includeConversationHistory: boolean
  includeAiEditContext: boolean
  includeVisualContext: boolean
  maxHistoryMessages: number
  maxDirectoryDepth: number
}

/**
 * Default context generation configuration
 */
export const DEFAULT_CONTEXT_CONFIG: ContextGenerationConfig = {
  includeAppContext: true,
  includeConversationHistory: true,
  includeAiEditContext: true,
  includeVisualContext: true,
  maxHistoryMessages: 10,
  maxDirectoryDepth: 3
}
