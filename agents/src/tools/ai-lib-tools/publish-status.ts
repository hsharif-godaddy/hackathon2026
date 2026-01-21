/**
 * Publish Status AI Tool
 *
 * AI-lib wrapper for getting the status of the published app.
 * Allows the develop agent to diagnose production issues when users report problems.
 */

import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js'
import type { PublishStatusResponse } from '../../services/DevSupervisorClient.js'

/**
 * Publish Status tool for AI agents
 *
 * This retrieves the current status of the published app including:
 * - Current version (commit hash) being served
 * - Health status (healthy/unhealthy/starting/disabled)
 * - Process state (running/stopped/error) and uptime
 * - Recent logs for debugging
 *
 * Use this when a user reports issues with their published app.
 */
export const publishStatusAITool: Tool = createTool(
  `Get the status of the published production app.

WHEN TO USE:
- User reports "my published app is not working" or similar production issues
- User asks about the health or status of their published/live site
- Need to diagnose why the published app is broken
- Want to check what version is currently being served in production

RETURNS:
- Current version (commit hash) being served
- Health status of the app
- Process state and uptime
- Recent logs from the published app for debugging`,
  z.object({
    lines: z
      .number()
      .optional()
      .describe('Number of log lines to retrieve (default: 200)'),
    includeLogs: z
      .boolean()
      .optional()
      .describe('Whether to include logs in the response (default: true)'),
  }),
  async (input, context) => {
    // Extract required context
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for checking publish status')
    }

    // Get publish supervisor client
    const publishSupervisor = DevSupervisorClientFactory.createForPublishSupervisor(appId)
    if (!publishSupervisor) {
      return `Unable to check publish status: The publish supervisor is not available for this app.

This could mean:
- The app has not been published yet
- The app is running on a legacy infrastructure that doesn't support this feature
- The publish task is not currently running

Please try publishing the app first, or check if there are any infrastructure issues.`
    }

    // Get publish status
    let status: PublishStatusResponse
    try {
      status = await publishSupervisor.getPublishStatus({
        lines: input.lines ?? 200,
        includeLogs: input.includeLogs ?? true,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to get publish status: ${errorMessage}`)
    }

    // Build response message
    let message = '## Published App Status\n\n'

    // Version
    if (status.version) {
      message += `**Version:** \`${status.version.length > 7 ? status.version.substring(0, 7) : status.version}\` (${status.version})\n`
    } else {
      message += `**Version:** No version published yet\n`
    }

    // Health
    message += `\n### Health\n`
    message += `- **Status:** ${status.health.status}\n`
    if (status.health.message) {
      message += `- **Message:** ${status.health.message}\n`
    }

    // Process
    message += `\n### Process\n`
    message += `- **State:** ${status.process.state}\n`
    if (status.process.pid > 0) {
      message += `- **PID:** ${status.process.pid}\n`
    }
    if (status.process.uptime) {
      message += `- **Uptime:** ${status.process.uptime}\n`
    }

    // Warnings
    if (status.warnings && status.warnings.length > 0) {
      message += `\n### Warnings\n`
      for (const warning of status.warnings) {
        message += `- ${warning}\n`
      }
    }

    // Logs - show all logs returned by the API (respects the 'lines' parameter)
    if (status.logs && status.logs.length > 0) {
      // Show stderr logs first as they're more likely to contain errors
      const stderrLogs = status.logs.filter(log => log.source === 'stderr')
      const stdoutLogs = status.logs.filter(log => log.source === 'stdout')

      if (stderrLogs.length > 0) {
        message += `\n### Recent Error Logs (stderr)\n\`\`\`\n`
        for (const log of stderrLogs) {
          message += `${log.message}\n`
        }
        message += `\`\`\`\n`
      }

      if (stdoutLogs.length > 0) {
        message += `\n### Recent Logs (stdout)\n\`\`\`\n`
        for (const log of stdoutLogs) {
          message += `${log.message}\n`
        }
        message += `\`\`\`\n`
      }
    }

    // Add troubleshooting guidance if unhealthy
    if (status.health.status === 'unhealthy') {
      message += `\n### Troubleshooting\n`
      message += `The published app appears to be unhealthy. Common causes include:\n`
      message += `1. **Build errors** - Check if the app builds successfully with \`npm run build\`\n`
      message += `2. **Missing dependencies** - Ensure all dependencies are installed\n`
    }

    return message
  }
)
