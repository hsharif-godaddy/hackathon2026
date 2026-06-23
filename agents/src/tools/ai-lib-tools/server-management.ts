import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { ServerManagementTool, RestartServerOptions } from '../server-management-tool.js'

// Initialize tool instances
const serverTool = new ServerManagementTool()

/**
 * Server Restart Tool for AI-Lib
 * Restart the development server for the current app
 */
export const serverRestartAITool: Tool = createTool(
  'Restart the development server ONLY when absolutely necessary: database schema migrations, new backend dependencies, or server config changes. Vite HMR handles code changes automatically - restarts are rarely needed.',
  z.object({
    reason: z.string().optional().describe('Optional reason for the restart (for logging purposes)')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for server restart - ensure agent is running in app context')
    }

    const result = await serverTool.restartServer(input as RestartServerOptions, appId)
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to restart server')
    }

    return result.message
  }
)

/**
 * Server Status Tool for AI-Lib
 * Check the current status of the development server
 */
export const serverStatusAITool: Tool = createTool(
  'Check the current status of the development server for the current app. Returns whether the server is running, stopped, or in an error state.',
  z.object({}),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for server status check - ensure agent is running in app context')
    }

    const result = await serverTool.checkServerStatus(appId)
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to check server status')
    }

    let response = `Server Status for App ${appId}: ${result.status.toUpperCase()}`
    
    if (result.message) {
      response += `\n${result.message}`
    }

    return response
  }
)
