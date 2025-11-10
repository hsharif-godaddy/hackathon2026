import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { DirectoryListingTool, DirectoryListingOptions } from '../directory-listing.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'

// Initialize tool instances
const directoryTool = new DirectoryListingTool()
const appRepo = new AppRepository()

/**
 * Directory Listing Tool for AI-Lib
 * List directory contents as a tree structure with filtering options
 */
export const directoryListingAITool: Tool = createTool(
  'List directory contents as a tree structure with filtering options. Always limited to the current app\'s directory.',
  z.object({
    path: z.string().default('').describe('Relative path within the app to list (default: root)'),
    directoriesOnly: z.boolean().default(false).describe('Show only directories, not files'),
    pattern: z.string().optional().describe('Pattern to filter entries (supports * wildcard)'),
    search: z.string().optional().describe('Search for entries containing this text'),
    maxDepth: z.number().min(0).optional().describe('Maximum depth to traverse (default: unlimited)'),
    showHidden: z.boolean().default(false).describe('Show hidden files/directories (starting with .)')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for directory listing')
    }

    const app = appRepo.findById(appId)
    if (!app) {
      throw new Error(`App '${appId}' not found`)
    }

    const result = await directoryTool.listDirectory(app.path, input as DirectoryListingOptions, { appId })
    return directoryTool.formatAsTree(result)
  }
)
