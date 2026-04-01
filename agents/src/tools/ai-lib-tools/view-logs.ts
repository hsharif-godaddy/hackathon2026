import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { ViewLogsTool, DevLogsOptions } from '../view-logs-tool.js'

/**
 * View Logs Tool for AI-Lib
 * Read logs from preview or publish apps for debugging and monitoring
 */
export const viewLogsAITool: Tool = createTool(
  'Read runtime logs from the preview or publish app. Use target "preview" to see logs from the live development server visible in the iframe. Use target "publish" to see logs from the deployed production site. Helpful for debugging runtime errors, failed page loads, or server-side issues.',
  z.object({
    target: z.enum(['preview', 'publish']).default('preview').describe('Which app to read logs from: "preview" (development server in iframe) or "publish" (deployed production site)'),
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
