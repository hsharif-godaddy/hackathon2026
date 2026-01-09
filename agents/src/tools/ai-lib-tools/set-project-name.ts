import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { Logger } from '../../logging/index.js'

const logger = Logger.create({ service: 'set-project-name-tool' })

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

