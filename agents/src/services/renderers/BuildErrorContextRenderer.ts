import type { ContextAttachment, ContextAttachmentRenderer, RenderedContext } from '@airo/shared/context-attachment'
import { logger } from '../../logging/index.js'

interface BuildErrorData {
  error: string
  details: string
  exitCode?: number
}

export class BuildErrorContextRenderer implements ContextAttachmentRenderer<BuildErrorData> {
  canHandle(type: string): boolean {
    return type === 'build_error'
  }

  async render(
    attachment: ContextAttachment<BuildErrorData>,
    _userPrompt: string
  ): Promise<RenderedContext | null> {
    try {
      const { error, details, exitCode } = attachment.data

      if (!error && !details) {
        return null
      }

      const exitCodeInfo = exitCode !== undefined ? `\n- Exit Code: ${exitCode}` : ''

      const content = `### Build Error Occurred

**Error:** ${error}

**Details:**
\`\`\`
${details}
\`\`\`${exitCodeInfo}

The user encountered the above build/publish error and needs help fixing it.`

      return {
        role: 'user',
        content,
        insertionOrder: 'after_history'
      }
    } catch (error) {
      logger.error('context.attachment.render.build_error.error', {
        error: error instanceof Error ? error.message : String(error),
        attachmentType: attachment.type
      })
      return null
    }
  }

  shouldPersist(attachment: ContextAttachment<BuildErrorData>): boolean {
    return attachment.persistence === 'save'
  }
}
