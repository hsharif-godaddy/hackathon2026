/**
 * IAM S2S Token Service
 *
 * Provides cached IAM JWT tokens for service-to-service authentication.
 * Returns raw JWT (no prefix) -- callers add `Bearer` or `sso-jwt` as needed.
 *
 * Uses IamTokenClient from gd-auth-client with a mutex to prevent
 * concurrent token refresh storms.
 */

import { IamTokenClient } from 'gd-auth-client'

import { getSsoHostSync } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'

interface TokenCache {
  jwt: string
  expiresAt: number
}

const TOKEN_TTL_MS = 30 * 60 * 1000 // 30 minutes

let cachedToken: TokenCache | null = null
let refreshPromise: Promise<string> | null = null

/**
 * Get IAM S2S JWT for service-to-service auth.
 * Cached for 30min with mutex to prevent concurrent refresh.
 */
export async function getIamToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.jwt
  }

  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const ssoHost = getSsoHostSync()
      const client = new IamTokenClient(ssoHost)

      client.once('background_error', (primaryError: { message?: string; code?: string }) => {
        logger.error('iam.token.primaryRegionFailure', {
          message: primaryError.message,
          code: primaryError.code,
          ssoHost,
        })
      })

      const jwt: string = await client.getToken()
      cachedToken = { jwt, expiresAt: Date.now() + TOKEN_TTL_MS }
      return jwt
    } catch (error) {
      throw new Error(
        `Failed to retrieve IAM S2S token: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

/** Clear cached token (for testing). */
export function clearIamTokenCache(): void {
  cachedToken = null
  refreshPromise = null
}
