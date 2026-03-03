import type { ContextAttachment, ContextAttachmentRenderer, RenderedContext } from '@airo/shared/context-attachment'
import { logger } from '../../logging/index.js'

/**
 * AI Edit Context data structure
 */
export interface AiEditContextData {
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
  screenshot?: string | null
}

/**
 * Renderer for AI Edit context attachments
 * 
 * Renders selected element information for targeted editing.
 * This context should be persisted to history.
 */
export class AiEditContextRenderer implements ContextAttachmentRenderer<AiEditContextData> {
  canHandle(type: string): boolean {
    return type === 'ai_edit_context'
  }

  render(
    attachment: ContextAttachment<AiEditContextData>,
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
        logger.warn('context.renderer.ai_edit.no_data', {
          type: attachment.type
        })
        return null
      }

      const elementInfo = data.elementInfo || {}
      const devContext = data.devContext || {}

      // Check if we have a known element - if tag is unknown and we have no dev context, skip rendering
      const hasKnownElement = elementInfo.tagName || devContext.fileName || devContext.componentName
      
      if (!hasKnownElement) {
        logger.debug('context.renderer.ai_edit.skipped', {
          type: attachment.type,
          reason: 'No known element information'
        })
        return null
      }

      const sanitizedContext = {
        element: {
          tag: String(elementInfo.tagName || 'unknown').replace(/[<>]/g, ''),
          classes: String(elementInfo.className || 'none').substring(0, 200),
          id: String(elementInfo.id || 'none').substring(0, 100),
          textContent: String(elementInfo.textContent || 'none').substring(0, 300),
          selector: String(data.selector || 'unknown').substring(0, 200)
        },
        source: {
          fileName: String(devContext.fileName || 'unknown').substring(0, 200),
          componentName: String(devContext.componentName || 'unknown').substring(0, 100),
          lineNumber: Number.isInteger(devContext.lineNumber) ? devContext.lineNumber : 'unknown'
        }
      }

      const content = `[AI Edit Context - Selected Element]

Element Details:
- Tag: ${sanitizedContext.element.tag}
- Classes: ${sanitizedContext.element.classes}
- ID: ${sanitizedContext.element.id}
- Text Content: "${sanitizedContext.element.textContent}"
- CSS Selector: ${sanitizedContext.element.selector}

Source Code Location:
- File: ${sanitizedContext.source.fileName}
- Component: ${sanitizedContext.source.componentName}
- Line: ${sanitizedContext.source.lineNumber}

Instructions: The following user message refers to changes for this specific selected element. Focus your edits on the code at the specified file and location.`

      logger.debug('context.renderer.ai_edit.success', {
        type: attachment.type,
        hasElementInfo: !!data.elementInfo,
        hasDevContext: !!data.devContext,
        contentLength: content.length
      })

      return {
        content,
        role: 'user',
        insertionOrder: 'after_history'
      }
    } catch (error) {
      logger.error('context.renderer.ai_edit.error', {
        type: attachment.type,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  shouldPersist(attachment: ContextAttachment<AiEditContextData>): boolean {
    return attachment.persistence !== 'ephemeral'
  }
}
