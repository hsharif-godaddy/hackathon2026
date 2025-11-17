import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { AuthService, AuthRequiredError } from '../../services/auth-service.js'

/**
 * OAuth Authorization Tool for AI-Lib
 * Ensures OAuth token is available for the current app
 * 
 * Never exposes raw access tokens to the agent.
 * Returns authRequest payload if authentication is needed (successful flow, not error).
 */
export const oauthConnect: Tool = createTool(
  'Ensure OAuth token is available for GoDaddy API actions. Call with required scopes. The UI handles authentication automatically if needed. Available scopes: commerce.product:read, commerce.product:write, commerce.checkout:write, domains:read, domains:write.',
  z.object({
    scopes: z.array(z.string()).describe('Array of OAuth scopes required (e.g., ["commerce.product:write"])')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for OAuth operations')
    }

    try {
      // Try to get access token (may already be cached)
      const result = await AuthService.getAccessToken({
        appId,
        scopes: input.scopes,
      })

      return {
        success: true,
        provider: 'godaddy',
        scopes: input.scopes,
        expiresAt: result.expiresAt,
        message: `OAuth authorized. API tools can now be used.`
      }
    } catch (err) {
      // If authentication is required, return authRequest
      if (err instanceof AuthRequiredError) {
        return {
          success: true,
          authRequired: true,
          message: 'Authentication required. API tools will work after user authenticates.',
          authRequest: {
            type: 'auth_request',
            provider: 'godaddy',
            scopes: err.scopes,
            redirectUrl: err.redirectUrl,
            state: err.state,
            title: 'Authentication Required',
            description: 'This action requires GoDaddy OAuth permission for:'
          }
        }
      }
      // Unexpected errors still throw
      throw err
    }
  }
)
