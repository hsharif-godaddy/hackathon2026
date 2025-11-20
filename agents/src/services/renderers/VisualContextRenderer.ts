import type { ContextAttachment, ContextAttachmentRenderer, RenderedContext } from '../../types/context-attachment.js'
import { logger } from '../../logging/index.js'

/**
 * Visual Context data structure
 */
export interface VisualContextData {
  page?: string
  scroll_position?: { x: number; y: number }
  active_section?: string
  viewport?: { width: number; height: number }
  timestamp?: number
}

/**
 * Renderer for Visual context attachments
 * 
 * Renders the user's current view state in the preview iframe.
 * This context is ephemeral and should not be persisted to history.
 */
export class VisualContextRenderer implements ContextAttachmentRenderer<VisualContextData> {
  canHandle(type: string): boolean {
    return type === 'visual_context'
  }

  private validateNumber(value: unknown, defaultValue = 0): number {
    const num = typeof value === 'number' && !isNaN(value) ? value : defaultValue
    return Math.round(num)
  }

  render(
    attachment: ContextAttachment<VisualContextData>,
    _userPrompt: string,
    _context?: {
      appId?: string
      appPath?: string
      conversationId?: string
    }
  ): RenderedContext | null {
    try {
      const data = attachment.data
      
      if (!data) {
        logger.warn('context.renderer.visual.no_data', {
          type: attachment.type
        })
        return null
      }

      const sanitizedContext = {
        page: String(data.page || '/').substring(0, 200),
        scroll_position: {
          x: this.validateNumber(data.scroll_position?.x),
          y: this.validateNumber(data.scroll_position?.y)
        },
        active_section: data.active_section ? String(data.active_section).substring(0, 100) : 'unknown',
        viewport: {
          width: this.validateNumber(data.viewport?.width),
          height: this.validateNumber(data.viewport?.height)
        },
        timestamp: data.timestamp || Date.now()
      }

      // Don't render anything if we don't have valid position data
      if (sanitizedContext.active_section === 'dev-tools-initializing' ||
          sanitizedContext.active_section === 'iframe-blocked' ||
          sanitizedContext.active_section === 'no-iframe' ||
          sanitizedContext.active_section === 'unknown') {
        logger.debug('context.renderer.visual.skipped', {
          type: attachment.type,
          reason: sanitizedContext.active_section
        })
        return null
      }

      const activePageSection = `The user is currently viewing the "${sanitizedContext.active_section}" section.`
      const contextNotes = `The user's message refers to content visible at their current scroll position (${sanitizedContext.scroll_position.y}px from top). When they say "this" or "here", they likely mean elements visible in the "${sanitizedContext.active_section}" section around this scroll position.`

      const content = `[User's Current Visual Context]

Page Information:
- Current Page: ${sanitizedContext.page}
- ${activePageSection}

Scroll Position:
- Horizontal: ${sanitizedContext.scroll_position.x}px
- Vertical: ${sanitizedContext.scroll_position.y}px

Viewport Size:
- Width: ${sanitizedContext.viewport.width}px
- Height: ${sanitizedContext.viewport.height}px

Context Notes: ${contextNotes}`

      logger.debug('context.renderer.visual.success', {
        type: attachment.type,
        page: sanitizedContext.page,
        activeSection: sanitizedContext.active_section,
        contentLength: content.length
      })

      return {
        content,
        role: 'user',
        insertionOrder: 'after_history'
      }
    } catch (error) {
      logger.error('context.renderer.visual.error', {
        type: attachment.type,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  shouldPersist(_attachment: ContextAttachment<VisualContextData>): boolean {
    return false
  }
}
