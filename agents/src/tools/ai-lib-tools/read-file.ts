import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { ReadFileTool, type ReadFileOptions } from '../read-file.js'
import { createForWorkspace } from '../../workspace/index.js'

export const readFileAITool: Tool = createTool(
  'Read file contents with line numbers (format: "     1|line content"). Supports line range selection for large files. If blocked, try a different approach — no retries.',
  z.object({
    path: z.string().describe('File path relative to app root'),
    startLine: z.number().min(1).optional().describe('Start line (1-indexed). Omit to read from line 1'),
    numLines: z.number().min(1).optional().describe('Line count from startLine. Omit to read to end')
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

    let response = `${result.path}`
    if (result.linesRead) {
      response += ` [${result.linesRead.start}-${result.linesRead.end} of ${result.totalLines}]`
    } else {
      response += ` [${result.totalLines} lines]`
    }
    if (result.truncated) {
      response += ' (truncated — use startLine/numLines to read remaining)'
    }
    response += `\n${result.content}`

    return response
  }
)
