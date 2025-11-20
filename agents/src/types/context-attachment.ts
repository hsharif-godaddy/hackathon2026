/**
 * Generic Context Attachment Framework
 * 
 * Provides a flexible, extensible system for attaching various types of context
 * to agent conversations. Supports custom rendering, persistence, and UI display.
 */

/**
 * Common metadata for all context attachments
 */
export interface ContextAttachmentMetadata {
  timestamp?: number
  source?: string
  priority?: number
  [key: string]: unknown
}

/**
 * How to render the context attachment in the LLM prompt
 */
export type RenderStrategy = 
  | 'before_prompt'  // Render before user's message
  | 'after_prompt'   // Render after user's message  
  | 'replace_prompt' // Replace the user's prompt entirely
  | 'hidden'         // Don't render (use for side effects only)

/**
 * Whether to persist the attachment to conversation history
 */
export type PersistenceStrategy = 
  | 'save'      // Save to history for replay
  | 'ephemeral' // Don't save, only for current turn

/**
 * Generic context attachment with strongly typed data
 */
export interface ContextAttachment<T = unknown> {
  type: string
  data: T
  metadata?: ContextAttachmentMetadata
  persistence?: PersistenceStrategy
  /** 
   * Render strategy hint (currently only used by DefaultContextRenderer fallback).
   * Custom renderers control their own insertionOrder directly.
   */
  renderStrategy?: RenderStrategy
}

/**
 * Result of rendering a context attachment
 */
export interface RenderedContext {
  content: string
  userPrompt?: string
  role?: 'user' | 'system'
  insertionOrder?: 'before_history' | 'after_history'
  cachePoint?: { type: 'ephemeral' }
}

/**
 * Context attachment renderer interface
 * 
 * Implement this interface to create custom renderers for specific context types.
 * Renderers can transform data, fetch additional information, or modify the user prompt.
 */
export interface ContextAttachmentRenderer<T = unknown> {
  canHandle(type: string): boolean
  
  render(
    attachment: ContextAttachment<T>, 
    userPrompt: string,
    context?: {
      appId?: string
      appPath?: string
      conversationId?: string
    }
  ): Promise<RenderedContext | null> | RenderedContext | null
  
  shouldPersist?(attachment: ContextAttachment<T>): boolean
}

/**
 * Registry configuration for a context attachment type
 */
export interface ContextAttachmentConfig<T = unknown> {
  type: string
  renderer?: ContextAttachmentRenderer<T>
  defaultPersistence?: PersistenceStrategy
  defaultRenderStrategy?: RenderStrategy
}

/**
 * Helper to create strongly-typed context attachments
 */
export function createContextAttachment<T>(
  type: string,
  data: T,
  options?: {
    metadata?: ContextAttachmentMetadata
    persistence?: PersistenceStrategy
    renderStrategy?: RenderStrategy
  }
): ContextAttachment<T> {
  return {
    type,
    data,
    ...(options?.metadata && { metadata: options.metadata }),
    ...(options?.persistence && { persistence: options.persistence }),
    ...(options?.renderStrategy && { renderStrategy: options.renderStrategy })
  }
}

/**
 * Type guard to check if value is a context attachment
 */
export function isContextAttachment(value: unknown): value is ContextAttachment {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'data' in value &&
    typeof (value as ContextAttachment).type === 'string'
  )
}

/**
 * Type guard to check if array contains context attachments
 */
export function isContextAttachmentArray(value: unknown): value is ContextAttachment[] {
  return Array.isArray(value) && value.every(isContextAttachment)
}
