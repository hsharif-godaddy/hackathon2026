import { createTool } from '@airo/ai-lib'
import { z } from 'zod'
import { ViewLogsTool, DevLogsOptions } from '../view-logs-tool.js'

/**
 * View Logs Tool for AI-Lib
 * Read development server logs for debugging and monitoring
 */
export const viewLogsAITool = createTool(
  'Read development server logs for debugging and monitoring. Provides access to stdout, stderr, and formatted log output from the running development server.',
  z.object({
    lines: z.number().min(1).max(1000).default(50).describe('Number of recent log lines to retrieve (default: 50, max: 1000)'),
    source: z.enum(['stdout', 'stderr']).optional().describe('Filter logs by source: stdout (normal output) or stderr (errors)'),
    since: z.string().optional().describe('Get logs since specific time (ISO 8601 format, e.g., "2024-01-01T10:00:00Z")'),
    summary: z.boolean().default(false).describe('Get log summary with statistics instead of raw logs')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for view logs operation')
    }

    const viewLogsTool = new ViewLogsTool()
    const result = await viewLogsTool.readLogs(appId, input as DevLogsOptions)

    if (!result.success) {
      throw new Error(result.error || 'Failed to read development logs')
    }

    return result.output
  }
)
