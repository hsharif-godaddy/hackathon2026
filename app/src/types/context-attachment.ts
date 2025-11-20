/**
 * Generic Context Attachment Framework (Frontend types)
 * 
 * Mirrors the backend types for context attachments.
 * These are defined separately to avoid coupling but should match the backend.
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
  renderStrategy?: RenderStrategy
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
    metadata: options?.metadata,
    persistence: options?.persistence,
    renderStrategy: options?.renderStrategy
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
