import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { DirectoryListingTool, DirectoryListingNotFoundError, DirectoryListingOptions } from '../directory-listing.js'
import { createForWorkspace } from '../../workspace/index.js'

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

    const workspace = createForWorkspace(appId, 'preview')
    if (!workspace) {
      throw new Error(`Workspace for app '${appId}' is not available`)
    }

    const tool = new DirectoryListingTool(workspace.files)
    try {
      const result = await tool.listDirectory(input as DirectoryListingOptions, { appId })
      return tool.formatAsTree(result)
    } catch (error) {
      if (error instanceof DirectoryListingNotFoundError) {
        return `Directory not found: ${input.path || '.'}`
      }
      throw error
    }
  }
)
