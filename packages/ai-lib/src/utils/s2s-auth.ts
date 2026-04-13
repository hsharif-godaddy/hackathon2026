/**
 * Service-to-Service Authentication utilities
 *
 * Provides S2S authentication using gd-auth-client IamTokenClient.
 * Used by services that need IAM-based JWT tokens (media, logo, knowledge, budget).
 */

/**
 * JWT token cache to avoid fetching new tokens on every request
 */
interface TokenCache {
  jwt: string;
  expiresAt: number;
  config: Required<S2SAuthConfig>;
}

// Normal import - much simpler than dynamic import
// @ts-expect-error - gd-auth-client is a CommonJS module without TypeScript definitions
import { IamTokenClient } from 'gd-auth-client'

import { createLogger } from '@airo/ai-common'

const logger = createLogger('s2s-auth')

let cachedToken: TokenCache | null = null;
let tokenRefreshPromise: Promise<string> | null = null;

/**
 * Configuration for S2S authentication
 */
export interface S2SAuthConfig {
  /** SSO host for authentication (e.g., 'sso.test-godaddy.com') */
  ssoHost?: string;
  /** AWS region for token service */
  region?: string;
  /** GoCode API endpoint override */
  goCodeEndpoint?: string;
}

/**
 * Get default SSO host based on SSO_HOST or NODE_ENV
 */
function getDefaultSsoHost(): string {
  if (process.env.SSO_HOST) {
    return process.env.SSO_HOST;
  }

  const env = process.env.NODE_ENV || 'dev';

  switch (env.toLowerCase()) {
    case 'production':
    case 'prod':
      return 'sso.godaddy.com';
    case 'test':
      return 'sso.test-godaddy.com';
    case 'development':
    case 'dev':
    default:
      return 'sso.dev-godaddy.com';
  }
}

/**
 * Get default GoCode endpoint based on NODE_ENV
 * These endpoints are specifically for S2S authentication with Bearer tokens
 */
function getDefaultGoCodeEndpoint(): string {
  const env = process.env.NODE_ENV || 'dev';

  switch (env.toLowerCase()) {
    case 'production':
    case 'prod':
      return 'https://api.gocode.caas.gdcorp.tools';
    case 'test':
      return 'https://api.gocode.caas.test-gdcorp.tools';
    case 'development':
    case 'dev':
    default:
      return 'https://api.gocode.caas.dev-gdcorp.tools';
  }
}

/**
 * Get default Anthropic proxy endpoint based on NODE_ENV
 * These endpoints use regular API key authentication (x-api-key header)
 */
function getDefaultAnthropicProxyEndpoint(): string {
  const env = process.env.NODE_ENV || 'dev';

  switch (env.toLowerCase()) {
    case 'production':
    case 'prod':
      return 'https://caas-gocode.caas.prod.onkatana.net';
    case 'test':
      return 'https://caas-gocode-test.caas-test.prod.onkatana.net';
    case 'development':
    case 'dev':
    default:
      return 'https://caas-gocode-dev.caas-dev.prod.onkatana.net';
  }
}

/**
 * Get default S2S authentication configuration
 */
function getDefaultS2SConfig(): Required<S2SAuthConfig> {
  return {
    ssoHost: getDefaultSsoHost(),
    region: process.env.AWS_REGION || 'us-west-2',
    // Allow environment override, fallback to environment-specific endpoint
    goCodeEndpoint: process.env.OPENAI_BASE_URL || getDefaultGoCodeEndpoint()
  };
}

/**
 * Check if S2S authentication is enabled via environment variable.
 * Used by unified-provider and other callers to decide whether to use S2S auth paths.
 * Note: getS2SToken() itself does NOT check this — it always attempts to fetch a token.
 */
export function isS2SAuthEnabled(): boolean {
  return process.env.GOCODE_USE_S2S_AUTH === 'true';
}

/**
 * Get the default SSO host for the current environment
 * Based on NODE_ENV: dev -> sso.dev-godaddy.com, test -> sso.test-godaddy.com, prod -> sso.godaddy.com
 */
export { getDefaultSsoHost };

/**
 * Get the default GoCode endpoint for the current environment (S2S Bearer token auth)
 * Based on NODE_ENV: dev -> api.gocode.caas.dev-gdcorp.tools, test -> api.gocode.caas.test-gdcorp.tools, prod -> api.gocode.caas.gdcorp.tools
 */
export { getDefaultGoCodeEndpoint };

/**
 * Get the default Anthropic proxy endpoint for the current environment (API key auth)
 * Based on NODE_ENV: dev -> caas-gocode-dev.caas-dev.prod.onkatana.net, test -> caas-gocode-test.caas-test.prod.onkatana.net, prod -> caas-gocode.caas.prod.onkatana.net
 */
export { getDefaultAnthropicProxyEndpoint };

/**
 * Decode JWT payload without verification (for extracting expiration time)
 */
function decodeJWTPayload(jwt: string): any {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format: expected 3 parts separated by dots');
    }

    const payload = parts[1];
    if (!payload) {
      throw new Error('Invalid JWT: missing payload section');
    }

    return JSON.parse(Buffer.from(payload, 'base64').toString());
  } catch (error) {
    throw new Error(`Failed to decode JWT payload: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check if cached token is valid and matches the current config
 */
function isCachedTokenValid(config: Required<S2SAuthConfig>): boolean {
  if (!cachedToken) {
    return false;
  }

  // Check if config matches (different configs need different tokens)
  const configMatches =
    cachedToken.config.ssoHost === config.ssoHost &&
    cachedToken.config.region === config.region &&
    cachedToken.config.goCodeEndpoint === config.goCodeEndpoint;

  if (!configMatches) {
    return false;
  }

  // Check if token is not expired (with 60 second buffer)
  const now = Date.now();
  const bufferMs = 60 * 1000; // 60 seconds
  return now < (cachedToken.expiresAt - bufferMs);
}

/**
 * Clear the cached token (useful for testing or manual refresh)
 */
export function clearTokenCache(): void {
  cachedToken = null;
  tokenRefreshPromise = null;
}

/**
 * Get cached token info for debugging
 */
export function getTokenCacheInfo(): {
  hasCachedToken: boolean;
  expiresAt?: Date;
  isExpired?: boolean;
  timeUntilExpiration?: number;
} {
  if (!cachedToken) {
    return { hasCachedToken: false };
  }

  const expiresAt = new Date(cachedToken.expiresAt);
  const now = Date.now();
  const isExpired = now >= cachedToken.expiresAt;
  const timeUntilExpiration = Math.max(0, cachedToken.expiresAt - now);

  return {
    hasCachedToken: true,
    expiresAt,
    isExpired,
    timeUntilExpiration
  };
}

/**
 * Get JWT token for S2S authentication using AWS IAM credentials
 * Uses caching to avoid fetching new tokens on every request
 * Thread-safe: prevents concurrent token refresh attempts
 *
 * @param config - Optional S2S authentication configuration
 * @returns Promise that resolves to JWT token string
 * @throws Error if token retrieval fails
 */
export async function getS2SToken(config?: S2SAuthConfig): Promise<string> {
  const finalConfig = { ...getDefaultS2SConfig(), ...config };

  // Check if we have a valid cached token
  if (isCachedTokenValid(finalConfig)) {
    return cachedToken!.jwt;
  }

  // If a refresh is already in progress, wait for it
  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }

  // Fetch new token with mutex
  tokenRefreshPromise = (async () => {
    try {
      const client = new IamTokenClient(finalConfig.ssoHost);

      // Listen for primary region failures to capture the real error
      client.once('background_error', (primaryError: any) => {
        logger.error('s2s.auth.token.primary_region_failure', {
          message: primaryError.message,
          code: primaryError.code,
          ssoHost: finalConfig.ssoHost,
          primaryRegion: 'us-west-2',
          errorName: primaryError.name
        });
      });

      const token = await client.getToken();

      // Cache the token with its expiration time
      const payload = decodeJWTPayload(token);

      cachedToken = {
        jwt: token,
        expiresAt: payload.exp ? payload.exp * 1000 : (payload.iat + 30 * 60) * 1000,
        config: finalConfig
      };

      return token;
    } catch (error) {
      throw new Error(`Failed to retrieve S2S token: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      tokenRefreshPromise = null;
    }
  })();

  return tokenRefreshPromise;
}

/**
 * Force refresh of S2S token, bypassing cache
 * Useful for manual recovery or when token is known to be invalid
 *
 * @param config - Optional S2S authentication configuration
 * @returns Promise that resolves to new JWT token string
 * @throws Error if token retrieval fails
 */
export async function refreshS2SToken(config?: S2SAuthConfig): Promise<string> {
  // Clear cache to force refresh
  clearTokenCache();

  // Fetch new token
  return getS2SToken(config);
}

/**
 * Get S2S configuration for OpenAI provider
 * Returns null if S2S is not enabled, otherwise returns the config WITHOUT JWT token
 * (token will be injected by the fetch wrapper on each request)
 *
 * @param s2sConfig - Optional S2S authentication configuration
 * @returns Promise that resolves to S2S config, or null if S2S not enabled
 */
export async function getS2SProviderConfig(s2sConfig?: S2SAuthConfig): Promise<{
  baseURL: string;
  apiKey: string;
} | null> {
  if (!isS2SAuthEnabled()) {
    return null;
  }

  const finalConfig = { ...getDefaultS2SConfig(), ...s2sConfig };
  return {
    baseURL: finalConfig.goCodeEndpoint,
    apiKey: 'gocode-s2s-placeholder' // Placeholder API key since auth is via Bearer token
  };
}
