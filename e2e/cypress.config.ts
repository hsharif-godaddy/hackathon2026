import { defineConfig } from 'cypress';
import { baseConfig } from './cypress/config/base';
import * as path from 'path';
import fetch from 'node-fetch';

// Load .env file for local development
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

/**
 * Environment configuration for Cypress tests
 * Set CYPRESS_ENV to 'dev', 'test', or 'prod' (default: 'prod')
 */
type Environment = 'dev' | 'test' | 'prod';

interface EnvironmentConfig {
  baseUrl: string;
  usernameVar: string;
  passwordVar: string;
}

const environments: Record<Environment, EnvironmentConfig> = {
  dev: {
    baseUrl: 'https://airo-builder.dev-godaddy.com',
    usernameVar: 'DEV_USERNAME',
    passwordVar: 'DEV_PASSWORD',
  },
  test: {
    baseUrl: 'https://airo-builder.test-godaddy.com',
    usernameVar: 'TEST_USERNAME',
    passwordVar: 'TEST_PASSWORD',
  },
  prod: {
    baseUrl: 'https://airo-builder.godaddy.com',
    usernameVar: 'PROD_USERNAME',
    passwordVar: 'PROD_PASSWORD',
  },
};

// Determine environment from CYPRESS_ENV, default to 'prod'
const env = (process.env.CYPRESS_ENV as Environment) || 'prod';
const envConfig = environments[env] || environments.prod;

// Get credentials - try environment-specific vars first, then fall back to generic
const username = process.env[envConfig.usernameVar] || process.env.USERNAME;
const password = process.env[envConfig.passwordVar] || process.env.PASSWORD;

/**
 * Clean up apps created by a spec file after it completes
 * This runs in Node.js context (outside browser) so it executes even if:
 * - Tests fail
 * - Browser crashes
 * - User interrupts with Ctrl+C
 * - Tests are retried
 */
async function cleanupSpecApps(spec: any, config: any) {
  const specName = spec.name.replace('.cy.ts', '').replace('.cy.js', '');
  const specPrefix = `[e2e:${specName}]`;
  const baseUrl = config.env.baseUrl;

  try {
    const env = config.env.environment || 'prod';
    const username = config.env[`${env.toUpperCase()}_USERNAME`];
    const password = config.env[`${env.toUpperCase()}_PASSWORD`];

    if (!username || !password) {
      return;
    }

    const authTask = require('@gd-cypress/auth').task;
    const token = await authTask['auth:getIDPToken']({ env, username, password });

    const response = await fetch(`${baseUrl}/api/sites`, {
      headers: {
        'Cookie': `auth_idp=${token}`,
      },
    });

    if (!response.ok) {
      return;
    }

    const apps = await response.json();
    const toDelete = apps.filter((app: any) =>
      app.initial_prompt?.startsWith(specPrefix) || app.name?.includes(specPrefix)
    );

    if (toDelete.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      toDelete.map(async (app: any) => {
        const response = await fetch(`${baseUrl}/api/sites/${app.id}`, {
          method: 'DELETE',
          headers: { 'Cookie': `auth_idp=${token}` },
        });

        if (!response.ok) {
          throw new Error(`Delete failed: ${response.status}`);
        }

        const data = await response.json();
        if (!data.success) {
          throw new Error(`Delete failed: ${data.error || 'Unknown error'}`);
        }

        return { success: true, appId: app.id, name: app.name };
      })
    );

    const deleted = results.filter((r: any) => r.status === 'fulfilled' && r.value?.success).length;
    const failed = results.filter((r: any) => r.status === 'rejected');
    
    if (failed.length > 0) {
      console.error(`Failed to delete ${failed.length} app(s)`);
      failed.forEach((r: any) => console.log(`   - ${r.reason}`));
    }
    
    console.log(`✓ Deleted ${deleted}/${toDelete.length} apps for ${specPrefix}`);

  } catch (error: any) {
    console.error('Cleanup failed for spec:', specPrefix, '-', error.message);
  }
}

export default defineConfig({
  e2e: {
    ...baseConfig,
    supportFile: 'cypress/support/e2e.ts',
    baseUrl: envConfig.baseUrl,

    // Retry failed tests - helps with AI processing timing variations
    retries: {
      runMode: 1,    // Retry up to 1 time in CI (cypress run)
      openMode: 0,   // No retries in interactive mode (cypress open)
    },

    env: {
      environment: env,
      baseUrl: envConfig.baseUrl,
      [`${env.toUpperCase()}_USERNAME`]: username,
      [`${env.toUpperCase()}_PASSWORD`]: password,
    },
    setupNodeEvents(on, config) {
      // Register auth task from @gd-cypress/auth
      on('task', require('@gd-cypress/auth').task);

      // Cleanup apps after each spec completes (even on failure)
      on('after:spec', async (spec, results) => {
        await cleanupSpecApps(spec, config);
      });

      return config;
    },
  },
});
