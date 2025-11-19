import { createTool } from '@airo/ai-lib';
import { z } from 'zod';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { logger } from '../../logging/index.js';

const appRepo = new AppRepository();

/**
 * Commerce Credentials Structure
 * Matches the format expected by the generated app's create-checkout-session endpoint
 */
interface CommerceCredentials {
  CLIENT_ID: string;
  CLIENT_SECRET: string;
  STORE_ID: string;
  API_BASE_URL: string;
  CHECKOUT_API_BASE_URL: string;
  CHANNEL_ID: string;
}

/**
 * Write Commerce Credentials Tool
 *
 * Writes commerce credentials to src/config/commerce-credentials.json in the generated app.
 * This file is read by the checkout session endpoint alongside /alloc/config.json.
 *
 * In production, credentials come from /alloc/config.json (control plane managed).
 * In sandbox, this tool writes to src/config/commerce-credentials.json for testing.
 *
 * The getCommerceConfig() function in the app reads from both locations, with
 * /alloc/config.json taking precedence.
 *
 * OAuth CLIENT_ID and CLIENT_SECRET are read from environment variables (GODADDY_OAUTH_CLIENT_ID,
 * GODADDY_OAUTH_CLIENT_SECRET). The agent only needs to provide the storeId and channelId.
 */
export const writeCommerceCredentials = createTool(
  `Write commerce credentials to src/config/commerce-credentials.json in the generated app.

Use this after successful OAuth to configure checkout session credentials for local sandbox testing.

The credentials will be written to src/config/commerce-credentials.json and will be used
by the checkout session creator when /alloc/config.json is not available or incomplete.

Required fields:
- storeId: Commerce store ID (from getStore or setupStore result)
- channelId: Commerce channel ID for checkout sessions

The OAuth CLIENT_ID, CLIENT_SECRET, and API URLs are automatically read from the agent's
environment configuration.`,
  z.object({
    storeId: z.string().describe('Commerce store ID from getStore or setupStore'),
    channelId: z.string().describe('Commerce channel ID for checkout sessions'),
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string;

    if (!appId) {
      throw new Error('App ID is required in context.metadata.appId');
    }

    // Get app info
    const app = appRepo.findById(appId);
    if (!app) {
      throw new Error(`App '${appId}' not found`);
    }

    // Read OAuth credentials from environment
    const clientId = process.env.GODADDY_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GODADDY_OAUTH_CLIENT_SECRET;
    const apiBaseUrl = process.env.GODADDY_API_BASE_URL || 'https://api.dev-godaddy.com';
    const checkoutApiBaseUrl = process.env.GODADDY_COMMERCE_CHECKOUT_API_URL || 'https://checkout.commerce.api.dev-godaddy.com';

    if (!clientId || !clientSecret) {
      throw new Error('OAuth credentials not configured. Set GODADDY_OAUTH_CLIENT_ID and GODADDY_OAUTH_CLIENT_SECRET environment variables.');
    }

    // Construct path to src/config/commerce-credentials.json
    const configDir = resolve(app.path, 'src', 'config');
    const credentialsPath = resolve(configDir, 'commerce-credentials.json');

    logger.info('commerce.credentials.write.begin', {
      appId,
      appPath: app.path,
      configDir,
      credentialsPath,
      storeId: input.storeId,
      channelId: input.channelId,
    });

    try {
      // Ensure src/config directory exists
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
        logger.info('commerce.credentials.config_dir.created', {
          appId,
          configDir,
        });
      }

      // Build credentials object matching expected format
      const credentials: CommerceCredentials = {
        CLIENT_ID: clientId,
        CLIENT_SECRET: clientSecret,
        STORE_ID: input.storeId,
        API_BASE_URL: apiBaseUrl,
        CHECKOUT_API_BASE_URL: checkoutApiBaseUrl,
        CHANNEL_ID: input.channelId,
      };

      // Write credentials file
      const jsonContent = JSON.stringify(credentials, null, 2);
      writeFileSync(credentialsPath, jsonContent, {
        encoding: 'utf-8',
        mode: 0o600, // Owner read/write only
      });

      logger.info('commerce.credentials.write.success', {
        appId,
        credentialsPath,
        storeId: input.storeId,
        fileSize: jsonContent.length,
      });

      return JSON.stringify({
        success: true,
        message: `Commerce credentials written to ${credentialsPath}`,
        path: credentialsPath,
        storeId: input.storeId,
        note: 'Credentials will be used by checkout session creator. /alloc/config.json takes precedence if present.',
      }, null, 2);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('commerce.credentials.write.failure', {
        appId,
        credentialsPath,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw new Error(`Failed to write commerce credentials: ${errorMessage}`);
    }
  }
);
