import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { ReadFileTool, type ReadFileOptions } from '../read-file.js'
import { createForWorkspace } from '../../workspace/index.js'

export const readFileAITool: Tool = createTool(
  'Read file contents. Each line is prefixed by its 1-based file line number and a tab (cat -n format). By default, reads up to 2000 lines starting from the beginning of the file. If blocked, try a different approach — no retries.',
  z.object({
    path: z.string().describe('File path relative to app root'),
    offset: z.number().int().min(0).optional().describe('The line number to start reading from (0-based). Only provide if the file is too large to read at once'),
    limit: z.number().int().min(1).optional().describe('The number of lines to read. Only provide if the file is too large to read at once.')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for file operations')
    }

    const workspace = createForWorkspace(appId, 'preview')
    if (!workspace) {
      throw new Error('App not found')
    }

    const readFileTool = new ReadFileTool(workspace.files)
    const result = await readFileTool.readFile(input as ReadFileOptions)

    if (!result.success) {
      throw new Error(result.error || 'Failed to read file')
    }

    return result.content
  }
)
