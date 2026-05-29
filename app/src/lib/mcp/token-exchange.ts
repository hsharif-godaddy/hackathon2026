/**
 * MCP OAuth Token Exchange
 *
 * Exchanges the logged-in customer's JWT for a short-lived GoDaddy OAuth
 * access token suitable for calling an MCP server. The customer JWT never
 * leaves the BFF; only the resulting OAuth bearer token is forwarded.
 *
 * Grant:
 *   urn:ietf:params:oauth:grant-type:jwt-bearer
 *
 * The customer's auth_idp SSO JWT is passed as `assertion`. Note that this
 * grant is NOT advertised in openid-configuration metadata but is supported
 * by the GoDaddy OAuth token endpoint (verified against a working Bruno
 * script; do not switch to RFC 8693 token-exchange without re-testing).
 *
 * Client auth:
 *   client_id + client_secret via application/x-www-form-urlencoded body
 *   (token_endpoint_auth_method = client_secret_post).
 *
 * Cache key:
 *   (customerId, serverId, normalized scope set)
 *
 * Cache policy:
 *   - in-memory per process (fine for Phase 1; upgrade to Redis later if needed)
 *   - respect expires_in with a 60s safety skew
 */

import { logger } from '@/lib/request-context'
import { resolveGoDaddyApiBaseUrl } from './godaddy-api'
import { normalizeScopeSet } from './policy'

interface CachedToken {
  accessToken: string
  expiresAt: number // epoch ms
}

const tokenCache = new Map<string, CachedToken>()

/** Safety margin before a token's advertised expiry. */
const EXPIRY_SKEW_MS = 60_000

function cacheKey(customerId: string, serverId: string, scopes: readonly string[]): string {
  return `${customerId}::${serverId}::${normalizeScopeSet(scopes).join(' ')}`
}

function getCached(key: string): string | undefined {
  const hit = tokenCache.get(key)
  if (!hit) return undefined
  if (hit.expiresAt - EXPIRY_SKEW_MS <= Date.now()) {
    tokenCache.delete(key)
    return undefined
  }
  return hit.accessToken
}

interface OAuthTokenResponse {
  access_token: string
  token_type: string
  expires_in?: number
  scope?: string
}

/**
 * Base URL for GoDaddy OAuth token endpoint. Derived from
 * GODADDY_API_BASE_URL so dev/test/prod all resolve automatically.
 */
function resolveTokenEndpoint(): string {
  const override = process.env.GODADDY_OAUTH_TOKEN_ENDPOINT_URL
  if (override) return override

  const apiBaseUrl = resolveGoDaddyApiBaseUrl()
  return `${apiBaseUrl}/v2/oauth2/token`
}

function resolveClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.AIRO_APP_BUILDER_CLIENT_ID
  const clientSecret = process.env.AIRO_APP_BUILDER_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error(
      'MCP token exchange requires AIRO_APP_BUILDER_CLIENT_ID and AIRO_APP_BUILDER_CLIENT_SECRET',
    )
  }
  return { clientId, clientSecret }
}

export interface ExchangeTokenParams {
  /** Logged-in customer JWT from auth_idp cookie / sso-jwt header. */
  customerJwt: string
  /** Stable customer identifier (from gd-auth payload). */
  customerId: string
  /** MCP server id (used for cache keying only). */
  serverId: string
  /** Requested OAuth scopes. Caller must have already validated against ceiling. */
  scopes: readonly string[]
  /** Force a new token exchange, bypassing cache. */
  forceRefresh?: boolean
}

export interface ExchangeTokenResult {
  accessToken: string
  /** True when the token was returned from cache. */
  cached: boolean
}

/**
 * Exchange the customer's JWT for a short-lived OAuth access token,
 * caching by (customerId, serverId, scopeSet).
 */
export async function exchangeCustomerJwtForOAuthToken(
  params: ExchangeTokenParams,
): Promise<ExchangeTokenResult> {
  const { customerJwt, customerId, serverId, scopes, forceRefresh } = params

  if (!customerJwt) throw new Error('customerJwt is required')
  if (!customerId) throw new Error('customerId is required')
  if (!scopes || scopes.length === 0) throw new Error('scopes must be non-empty')

  const key = cacheKey(customerId, serverId, scopes)
  if (!forceRefresh) {
    const hit = getCached(key)
    if (hit) {
      return { accessToken: hit, cached: true }
    }
  }

  const { clientId, clientSecret } = resolveClientCredentials()
  const tokenEndpoint = resolveTokenEndpoint()

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: customerJwt,
    client_id: clientId,
    client_secret: clientSecret,
    scope: normalizeScopeSet(scopes).join(' '),
  })

  const started = Date.now()
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    // Parse out OAuth error/error_description for logs — RFC 6749 spec for
    // error responses is a JSON body with `error` and `error_description`.
    let oauthError: string | undefined
    let oauthErrorDescription: string | undefined
    try {
      const parsed = JSON.parse(text) as {
        error?: string
        error_description?: string
      }
      oauthError = parsed?.error
      oauthErrorDescription = parsed?.error_description
    } catch {
      // non-JSON body; fall through to raw text
    }
    logger.error('mcp.token_exchange.error', {
      status: response.status,
      statusText: response.statusText,
      serverId,
      customerId,
      scopeCount: scopes.length,
      latencyMs: Date.now() - started,
      oauthError,
      oauthErrorDescription,
      rawBody: text.slice(0, 1000),
      tokenEndpoint,
    })
    const detail = oauthErrorDescription ?? oauthError ?? text.slice(0, 200)
    throw new TokenExchangeError(
      `OAuth token exchange failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
      response.status,
      text.slice(0, 1000),
    )
  }

  const json = (await response.json()) as OAuthTokenResponse
  if (!json.access_token) {
    logger.error('mcp.token_exchange.missing_access_token', {
      serverId,
      customerId,
    })
    throw new TokenExchangeError('OAuth token exchange returned no access_token', 502)
  }

  let expiresInSec = 300
  if (json.expires_in === undefined) {
    logger.warn('mcp.token_exchange.expires_in_missing', {
      serverId,
      customerId,
      fallbackExpiresInSec: expiresInSec,
    })
  } else if (typeof json.expires_in !== 'number' || !Number.isFinite(json.expires_in) || json.expires_in <= 0) {
    logger.error('mcp.token_exchange.invalid_expires_in', {
      serverId,
      customerId,
      expiresIn: json.expires_in,
    })
    throw new TokenExchangeError('OAuth token exchange returned invalid expires_in', 502)
  } else {
    expiresInSec = json.expires_in
  }

  const expiresInMs = expiresInSec * 1000
  tokenCache.set(key, {
    accessToken: json.access_token,
    expiresAt: Date.now() + expiresInMs,
  })

  logger.info('mcp.token_exchange.success', {
    serverId,
    customerId,
    scopes: normalizeScopeSet(scopes),
    expiresInSec,
    latencyMs: Date.now() - started,
  })

  return { accessToken: json.access_token, cached: false }
}

export class TokenExchangeError extends Error {
  readonly status: number
  readonly detail?: string
  constructor(message: string, status: number, detail?: string) {
    super(message)
    this.name = 'TokenExchangeError'
    this.status = status
    this.detail = detail
  }
}

/** Test-only helper to reset the in-memory cache between cases. */
export function __resetMcpTokenCacheForTests(): void {
  tokenCache.clear()
}
