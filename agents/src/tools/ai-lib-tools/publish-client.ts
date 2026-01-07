/**
 * Publish Client AI Tool
 *
 * AI-lib wrapper for the publish client tool.
 * Allows agents to trigger publishing through the client (browser).
 */

import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { executePublish } from '../publish-client-tool.js'
import { getClientActionService } from '../../server/ai-lib-websocket-server.js'

/**
 * Publish tool for AI agents
 *
 * This triggers the full publish workflow through the client:
 * 1. Client calls /api/apps/:id/publish with user JWT
 * 2. Control plane validates auth and calls agents service
 * 3. Agents service creates git archive
 * 4. Control plane notifies mgmt-airo to start deployment
 * 5. Deployment proceeds to production
 */
export const publishClientAITool: Tool = createTool(
  `Publish the app to production.

WHEN TO USE:
- User explicitly requests to publish ("publish my site", "deploy to production")
- Changes are committed and build is passing
- App is ready for production deployment`,
  z.object({
    commitHash: z
      .string()
      .optional()
      .describe('Optional specific commit hash to publish (defaults to current HEAD)'),
  }),
  async (input, context) => {
    // Extract required context
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for publishing')
    }

    // Get socketId from context with validation
    // Note: ai-lib sets socketId on context during tool execution, but it's not in types
    const socketId = (context as any)?.socketId
    if (!socketId || typeof socketId !== 'string') {
      throw new Error('Socket ID not available in context - tool must be called via WebSocket')
    }

    // Get client action service from global registry
    const clientActionService = getClientActionService(socketId)
    if (!clientActionService) {
      throw new Error('Client action service not available - cannot execute publish')
    }

    // Execute publish via client
    const publishOptions: { appId: string; commitHash?: string } = { appId }
    if (input.commitHash) {
      publishOptions.commitHash = input.commitHash
    }
    const result = await executePublish(publishOptions, clientActionService)

    // If publish failed, throw error to inform agent
    if (!result.success) {
      throw new Error(result.error || 'Publish failed')
    }

    // Build success message
    const commitInfo = result.commitHash ? result.commitHash.substring(0, 7) : 'HEAD'
    let message = `Successfully published commit ${commitInfo}`

    if (result.deploymentId) {
      message += `\n\nDeployment ID: ${result.deploymentId}`
      if (result.deploymentStatus) {
        message += `\nStatus: ${result.deploymentStatus}`
      }
      if (result.deploymentMessage) {
        message += `\n${result.deploymentMessage}`
      }
      message += '\n\nThe site will be live shortly. You can monitor deployment progress in the History tab.'
    } else {
      message += '\n\nArchive created successfully.'
      if (result.archivePath) {
        message += `\nArchive path: ${result.archivePath}`
      }
    }

    return message
  }
)
