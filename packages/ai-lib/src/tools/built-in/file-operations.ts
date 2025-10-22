import { z } from 'zod'
import { promises as fs } from 'fs'
import { BaseTool } from '../base-tool.js'
import type { AgentContext } from '../../core/types.js'

/**
 * File read tool
 */
export class ReadFileTool extends BaseTool {
  readonly name = 'read_file'
  readonly description = 'Read the contents of a file'
  readonly inputSchema = z.object({
    path: z.string().describe('Path to the file to read'),
    encoding: z.enum(['utf8', 'base64']).optional().default('utf8').describe('File encoding')
  })

  async execute(
    input: z.infer<typeof this.inputSchema>,
    _context?: AgentContext
  ): Promise<{ content: string; size: number }> {
    const { path, encoding } = this.validateInput<z.infer<typeof this.inputSchema>>(input)

    try {
      const content = await fs.readFile(path, encoding)
      const stats = await fs.stat(path)

      return {
        content: content.toString(),
        size: stats.size
      }
    } catch (error) {
      this.handleError(error)
    }
  }
}

/**
 * File write tool
 */
export class WriteFileTool extends BaseTool {
  readonly name = 'write_file'
  readonly description = 'Write content to a file'
  readonly inputSchema = z.object({
    path: z.string().describe('Path to the file to write'),
    content: z.string().describe('Content to write to the file'),
    encoding: z.enum(['utf8', 'base64']).optional().default('utf8').describe('File encoding')
  })

  async execute(
    input: z.infer<typeof this.inputSchema>,
    _context?: AgentContext
  ): Promise<{ success: boolean; bytesWritten: number }> {
    const { path, content, encoding } = this.validateInput<z.infer<typeof this.inputSchema>>(input)

    try {
      await fs.writeFile(path, content, encoding)
      const stats = await fs.stat(path)

      return {
        success: true,
        bytesWritten: stats.size
      }
    } catch (error) {
      this.handleError(error)
    }
  }
}

/**
 * Directory listing tool
 */
export class ListDirectoryTool extends BaseTool {
  readonly name = 'list_directory'
  readonly description = 'List files and directories in a path'
  readonly inputSchema = z.object({
    path: z.string().describe('Path to the directory to list'),
    includeHidden: z.boolean().optional().default(false).describe('Include hidden files')
  })

  async execute(
    input: z.infer<typeof this.inputSchema>,
    _context?: AgentContext
  ): Promise<{
    files: Array<{
      name: string
      type: 'file' | 'directory'
      size: number
      modified: string
    }>
  }> {
    const { path, includeHidden } = this.validateInput<z.infer<typeof this.inputSchema>>(input)

    try {
      const entries = await fs.readdir(path, { withFileTypes: true })
      const files = []

      for (const entry of entries) {
        // Skip hidden files unless requested
        if (!includeHidden && entry.name.startsWith('.')) {
          continue
        }

        const fullPath = `${path}/${entry.name}`
        const stats = await fs.stat(fullPath)

        files.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' as const : 'file' as const,
          size: stats.size,
          modified: stats.mtime.toISOString()
        })
      }

      return { files }
    } catch (error) {
      this.handleError(error)
    }
  }
}

/**
 * Create file operation tools
 */
export function createFileOperationTools() {
  return {
    readFile: new ReadFileTool(),
    writeFile: new WriteFileTool(),
    listDirectory: new ListDirectoryTool()
  }
}
