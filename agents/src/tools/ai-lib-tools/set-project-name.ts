import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { FileEditTool } from '../file-edit.js'
import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'set-project-name-tool' })

/**
 * Escape HTML special characters to prevent XSS when inserting into HTML
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Set Project Name Tool for AI-Lib
 * Allows the initial agent to set the project name after gathering information
 */
export const setProjectNameAITool: Tool = createTool(
  'Set the project name after gathering necessary information from the user.',
  z.object({
    name: z.string().min(1).max(100).describe('The project name to set (1-100 characters)')
  }),
  async (input, context) => {
    try {
      const appId = context?.metadata?.appId as string | undefined

      if (!appId) {
        throw new Error('No app ID available in context')
      }

      const appRepo = new AppRepository()
      const existingApp = appRepo.findById(appId)

      if (!existingApp) {
        throw new Error(`App not found: ${appId}`)
      }

      // Update the app name
      const updatedApp = appRepo.update(appId, { name: input.name })

      if (!updatedApp) {
        throw new Error('Failed to update app name')
      }

      logger.info('set-project-name.success', {
        appId,
        oldName: existingApp.name,
        newName: input.name
      })

      // Update index.html title if it still has the default value
      if (existingApp.path) {
        try {
          const defaultTitle = '<title>App Template</title>'
          // Escape HTML to prevent XSS from malicious project names
          const safeTitle = escapeHtml(input.name)
          const newTitle = `<title>${safeTitle}</title>`

          const fileEditTool = new FileEditTool()
          const result = await fileEditTool.editFile(existingApp.path, {
            path: 'index.html',
            mode: 'edit',
            edits: [{ old: defaultTitle, new: newTitle }],
            autoCommit: true,
            commitMessage: `Set page title to "${input.name}"`
          }, { appId })

          if (result.success) {
            logger.info('set-project-name.title-updated', { appId, title: input.name })
          } else if (result.error?.includes('not found in file')) {
            // Title was already customized - the default title string wasn't found
            logger.info('set-project-name.title-skipped', { appId, reason: 'already-customized' })
          } else {
            logger.warn('set-project-name.title-update-failed', {
              appId,
              error: result.error || 'Unknown error'
            })
          }
        } catch (err) {
          logger.warn('set-project-name.title-update-failed', {
            appId,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      }

      return `**Project Name Set**\n\nProject name updated to: **${input.name}**`
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      logger.error('set-project-name.error', {
        error: errorMessage
      })

      return `**Error Setting Project Name**\n\n${errorMessage}`
    }
  }
)

