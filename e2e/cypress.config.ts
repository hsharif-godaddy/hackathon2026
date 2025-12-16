import { defineConfig } from 'cypress';
import { baseConfig } from './cypress/config/base';
import * as path from 'path';

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

export default defineConfig({
  e2e: {
    ...baseConfig,
    supportFile: 'cypress/support/e2e.ts',
    baseUrl: envConfig.baseUrl,

    // Retry failed tests - helps with AI processing timing variations
    retries: {
      runMode: 2,    // Retry up to 2 times in CI (cypress run)
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

      return config;
    },
  },
});
