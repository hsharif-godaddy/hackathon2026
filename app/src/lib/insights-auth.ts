'use server'

/**
 * Insights API Authentication Utility
 *
 * Generates SSO JWT tokens for insights GraphQL API using IAM-based authentication.
 * This is a server action that runs server-side only and won't appear in the network tab.
 * Implements token caching to avoid multiple token generation calls.
 */

import { IamTokenClient } from 'gd-auth-client'

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
 * Tokens are cached for 50 minutes (tokens typically expire after 1 hour).
 *
 * Automatically detects environment (test vs production) based on hostname:
 * - If hostname is provided, uses it to determine environment
 * - If hostname is not provided, attempts to get it from Next.js request headers
 * - Falls back to environment variables if hostname is unavailable
 *
 * @param hostname - Optional hostname to determine environment (test/dev vs production).
 *                   If not provided, will attempt to get from request headers.
 * @returns SSO JWT token with 'sso-jwt' prefix
 * @throws Error if token generation fails
 *
 * @example
 * ```typescript
 * // With explicit hostname
 * const token = await getInsightsAuthToken('airo-builder.test-godaddy.com')
 *
 * // Automatic detection from request headers
 * const token = await getInsightsAuthToken()
 * // Returns: "sso-jwt eyJhbGciOiAiUlMyNTYiLCAia2lkIjogIlRkYUh6T2ZrMkEifQ..."
 * ```
 */
export async function getInsightsAuthToken(hostname?: string | null): Promise<string> {
  try {
    // Get hostname from request headers if not provided
    if (!hostname) {
      try {
        const { headers } = await import('next/headers')
        const headersList = await headers()
        const host = headersList.get('host') || ''
        hostname = host.split(':')[0] // Remove port if present
      } catch {
        // Headers not available (e.g., not in Next.js request context)
        hostname = null
      }
    }

    // Determine if we should use test or production SSO host
    // Priority: hostname check > environment variables > NODE_ENV
    // localhost is always treated as test environment
    let isProduction = false

    if (hostname) {
      // localhost is always test environment
      const isLocalhost = hostname === 'localhost' ||
                         hostname === '127.0.0.1' ||
                         hostname.startsWith('localhost:') ||
                         hostname.startsWith('127.0.0.1:')

      if (isLocalhost) {
        isProduction = false
      } else {
        // Check hostname for test/dev prefixes
        isProduction = !hostname.includes('test-') && !hostname.includes('dev-')
      }
    } else {
      // Fall back to environment-based detection
      isProduction =
        process.env.NODE_ENV === 'production' ||
        !!process.env.MYSQL_DB_USERNAME ||
        !!process.env.AWS_REGION_NOMAD ||
        !!process.env.PRODUCTION_DOMAIN
    }

    // Use environment as cache key to prevent mixing tokens from different environments
    const cacheKey = isProduction ? 'production' : 'test'
    const tokenCache = tokenCacheMap.get(cacheKey) || { token: null, expiresAt: null }

    // Check if we have a valid cached token for this environment
    const now = Date.now()
    if (tokenCache.token && tokenCache.expiresAt && now < tokenCache.expiresAt) {
      return tokenCache.token
    }

    const ssoHost = isProduction ? 'sso.godaddy.com' : 'sso.test-godaddy.com'

    // Create IAM token client with AWS credential provider
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

