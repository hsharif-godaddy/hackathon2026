import type { ContextAttachment, ContextAttachmentRenderer, RenderedContext } from '../../types/context-attachment.js'
import { logger } from '../../logging/index.js'

/**
 * Default renderer for context attachments
 * 
 * Provides a simple, generic markdown-based rendering for any context type.
 * This renderer acts as a fallback when no custom renderer is registered.
 */
export class DefaultContextRenderer implements ContextAttachmentRenderer {
  canHandle(_type: string): boolean {
    return true
  }

  render(
    attachment: ContextAttachment,
    _userPrompt: string,
    _context?: {
      appId?: string
      appPath?: string
      conversationId?: string
    }
  ): RenderedContext | null {
    try {
      const renderStrategy = attachment.renderStrategy || 'before_prompt'
      
      if (renderStrategy === 'hidden') {
        logger.debug('context.renderer.default.hidden', {
          type: attachment.type,
          message: 'Context marked as hidden, skipping render'
        })
        return null
      }

      const content = this.formatAsMarkdown(attachment)
      
      const role: 'user' | 'system' = this.determineRole(attachment)
      const insertionOrder: 'before_history' | 'after_history' = this.determineInsertionOrder(renderStrategy || 'before_prompt')

      logger.debug('context.renderer.default.rendered', {
        type: attachment.type,
        contentLength: content.length,
        role,
        insertionOrder,
        renderStrategy
      })

      return {
        content,
        role,
        insertionOrder
      }
    } catch (error) {
      logger.error('context.renderer.default.error', {
        type: attachment.type,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  shouldPersist(attachment: ContextAttachment): boolean {
    return attachment.persistence === 'save'
  }

  /**
   * Format attachment data as markdown
   */
  private formatAsMarkdown(attachment: ContextAttachment): string {
    const sections: string[] = []
    
    const title = this.formatTitle(attachment.type)
    sections.push(`[${title}]`)
    sections.push('')

    if (attachment.metadata?.timestamp) {
      const date = new Date(attachment.metadata.timestamp)
      sections.push(`Timestamp: ${date.toISOString()}`)
    }

    if (attachment.metadata?.source) {
      sections.push(`Source: ${attachment.metadata.source}`)
    }

    sections.push('')
    sections.push('Data:')
    sections.push('```json')
    sections.push(JSON.stringify(attachment.data, null, 2))
    sections.push('```')

    return sections.join('\n')
  }

  /**
   * Format context type into a readable title
   */
  private formatTitle(type: string): string {
    return type
      .split(/[_-]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  /**
   * Determine message role based on context type and strategy
   */
  private determineRole(attachment: ContextAttachment): 'user' | 'system' {
    const typePrefix = attachment.type.split('_')[0]?.toLowerCase() || ''
    
    if (typePrefix === 'system' || typePrefix === 'app' || typePrefix === 'template') {
      return 'system'
    }
    
    return 'user'
  }

  /**
   * Determine insertion order based on render strategy
   * 
   * Message assembly order:
   * 1. before_history → contextMessages (template, app context)
   * 2. conversation history
   * 3. after_history → messages (selected element, visual context, etc.)
   * 4. current user prompt
   */
  private determineInsertionOrder(strategy: string): 'before_history' | 'after_history' {
    if (strategy === 'before_prompt') {
      return 'after_history'  // After history, before current user prompt
    }
    
    return 'before_history'  // Default: earliest position (for system/template context)
  }
}
