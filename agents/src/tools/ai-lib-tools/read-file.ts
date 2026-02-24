import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { ReadFileTool, ReadFileOptions } from '../read-file.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'

// Initialize tool instances
const readFileTool = new ReadFileTool()
const appRepo = new AppRepository()

/**
 * Read File Tool for AI-Lib
 * Read file contents with line numbers - useful for understanding code structure
 */
export const readFileAITool: Tool = createTool(
  'Read file contents with line numbers for easy reference. Returns content in format "     1|line content". Supports optional line range selection for large files.',
  z.object({
    path: z.string().describe('Path to the file to read (relative to app root)'),
    startLine: z.number().min(1).optional().describe('Starting line number (1-indexed, optional). If omitted, reads from line 1'),
    numLines: z.number().min(1).optional().describe('Number of lines to read from start line (optional). If omitted, reads to end of file')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for file operations')
    }

    const app = appRepo.findById(appId)
    if (!app) {
      throw new Error(`App '${appId}' not found`)
    }

    const result = await readFileTool.readFile(input as ReadFileOptions, app.path)
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to read file')
    }

    // Build response with metadata
    let response = `File: ${result.path}\n`
    if (result.linesRead) {
      response += `Lines ${result.linesRead.start}-${result.linesRead.end} of ${result.totalLines}\n`
    } else {
      response += `Total lines: ${result.totalLines}\n`
    }
    if (result.fileSize) {
      response += `File size: ${result.fileSize} bytes\n`
    }
    response += `\nContent (with line numbers):\n${result.content}`

    return response
  }
)
