/**
 * TestPilot Configuration
 *
 * Centralized configuration for TestPilot API and authentication.
 * Only essential environment variables are exposed.
 */

/**
 * TestPilot configuration interface
 */
export interface TestPilotConfig {
  apiEndpoint: string;
  clientCert: string;
  clientKey: string;
  ssoEndpoint: string;
  ssoRealm: string;
  apiTimeout: number;
  polling: {
    maxAttempts: number;
    intervalMs: number;
  };
}

/**
 * Get TestPilot configuration from environment variables
 *
 * Required environment variables:
 * - TESTPILOT_CLIENT_CERT
 * - TESTPILOT_CLIENT_KEY
 *
 * Optional environment variables:
 * - TESTPILOT_API_ENDPOINT (default: production endpoint)
 *
 * @returns TestPilot configuration object
 *
 * @throws {Error} If required environment variables are not set
 */
export function getTestPilotConfig(): TestPilotConfig {
  const clientCert = process.env.TESTPILOT_CLIENT_CERT;
  const clientKey = process.env.TESTPILOT_CLIENT_KEY;

  if (!clientCert || !clientKey) {
    throw new Error('TESTPILOT_CLIENT_CERT and TESTPILOT_CLIENT_KEY environment variables are required');
  }

  return {
    apiEndpoint: process.env.TESTPILOT_API_ENDPOINT || 'https://testpilotai.api.ta.dev-godaddy.com/api/tests/ai-run',
    clientCert,
    clientKey,
    ssoEndpoint: process.env.TESTPILOT_SSO_ENDPOINT || 'https://sso.test-godaddy.com/v1/secure/api/token',
    ssoRealm: 'cert',
    apiTimeout: 60000,
    polling: {
      maxAttempts: 10,
      intervalMs: 5000,
    },
  };
}

