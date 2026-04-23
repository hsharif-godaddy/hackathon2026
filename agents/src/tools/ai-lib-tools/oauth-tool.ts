import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { AuthService, AuthRequiredError, MissingOAuthConfigError, OAuthScopes } from '../../services/auth-service.js';

/**
 * OAuth Authorization Tool for AI-Lib
 * Ensures OAuth token is available for the current app
 *
 * Never exposes raw access tokens to the agent.
 * Returns authRequest payload if authentication is needed (successful flow, not error).
 */
export const oauthConnect: Tool = createTool(
  'Ensure OAuth token is available for GoDaddy API actions. If this tool returns authRequired=true, present the OAuth UI and wait for the user to finish authenticating in the popup window. Ask the user to tell you when they have completed authentication. The available scopes are predefined and cannot be customized through this tool. Current scopes: commerce.store:read, commerce.product:read, commerce.product:write, commerce.order:read, commerce.onboarding-application:write, commerce.onboarding-application:read.',
  z.object({}),
  async (input, context) => {
    const appId = context?.metadata?.appId as string;
    if (!appId) {
      throw new Error('App ID is required for OAuth operations');
    }

    try {
      // Try to get access token (may already be cached)
      const result = await AuthService.getAccessToken({
        appId,
      });

      return {
        success: true,
        provider: 'godaddy',
        scopes: OAuthScopes,
        expiresAt: result.expiresAt,
      };
    } catch (err) {
      // If authentication is required, return authRequest
      if (err instanceof AuthRequiredError) {
        return {
          success: true,
          authRequired: true,
          message:
            'Please finish authenticating in the popup window, then tell me when you are done.',
          authRequest: {
            type: 'auth_request',
            provider: 'godaddy',
            scopes: err.scopes,
            redirectUrl: err.redirectUrl,
            state: err.state,
            title: 'Authentication Required',
            description: 'This action requires GoDaddy OAuth permission for:',
          },
        };
      }
      // Throwing causes the SDK to retry the same call, wasting LLM rounds on an
      // unrecoverable error. Returning a result lets the agent inform the user.
      if (err instanceof MissingOAuthConfigError) {
        return {
          success: false,
          error: `OAuth is not configured in this environment. Missing: ${err.missing.join(', ')}. Commerce features requiring OAuth authentication are not available.`,
          recoverable: false,
        };
      }
      throw err;
    }
  }
);
