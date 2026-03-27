'use server'

/**
 * Insights API Authentication Utility
 *
 * Generates SSO JWT tokens for insights GraphQL API using IAM-based authentication.
 * This is a server action that runs server-side only and won't appear in the network tab.
 * Implements token caching to avoid multiple token generation calls.
 */

import { IamTokenClient } from 'gd-auth-client'

import { getInsightsSsoHost } from '@/lib/insights/config'
import { logger } from '@/lib/request-context'

/**
 * Token cache with expiration
 */
interface TokenCache {
  token: string | null
  expiresAt: number | null
}

// In-memory token cache keyed by environment (test vs production)
// This ensures tokens from different environments don't get mixed up
const tokenCacheMap: Map<string, TokenCache> = new Map()

/**
 * Get SSO JWT token for insights API (Server Action)
 *
 * Uses IAM-based authentication via gd-auth-client with AWS credential provider.
 * Implements token caching to avoid multiple token generation calls.
 * Tokens are cached for 30 minutes (tokens typically expire after 1 hour).
 *
 * SSO host is derived from Gasket per-environment config (insightsSsoHost)
 * to guarantee the token always targets the same environment as the API URL.
 *
 * @param _hostname - Deprecated. Ignored — environment is now determined by Gasket config.
 * @returns SSO JWT token with 'sso-jwt' prefix
 * @throws Error if token generation fails
 */
export async function getInsightsAuthToken(_hostname?: string | null): Promise<string> {
  try {
    const ssoHost = getInsightsSsoHost()
    const isProduction = ssoHost === 'sso.godaddy.com'
    const cacheKey = isProduction ? 'production' : 'test'
    const tokenCache = tokenCacheMap.get(cacheKey) || { token: null, expiresAt: null }

    // Check if we have a valid cached token for this environment
    const now = Date.now()
    if (tokenCache.token && tokenCache.expiresAt && now < tokenCache.expiresAt) {
      return tokenCache.token
    }

    // Create IAM token client with Gasket-configured SSO host
    const ssoClient = new IamTokenClient(ssoHost)

    // Listen for primary region failures to capture the real error
    ssoClient.once('background_error', (primaryError: any) => {
      logger.error('insights.auth.token.primaryRegionFailure', {
        message: primaryError.message,
        code: primaryError.code,
        ssoHost,
        primaryRegion: 'us-west-2',
        errorName: primaryError.name
      })
    })

    // Get token from SSO client with error handling
    const token = await ssoClient.getToken()
    // IamTokenClient returns just the token, add 'sso-jwt' prefix
    const fullToken = `sso-jwt ${token}`

    // Cache the token for 30 minutes (tokens typically expire after 1 hour)
    tokenCacheMap.set(cacheKey, {
      token: fullToken,
      expiresAt: now + (30 * 60 * 1000) // 30 minutes in milliseconds
    })

    return fullToken
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to generate SSO JWT token: ${errorMessage}`)
  }
}

