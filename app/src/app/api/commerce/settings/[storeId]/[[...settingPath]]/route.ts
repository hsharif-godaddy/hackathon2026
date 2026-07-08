import { NextRequest, NextResponse } from 'next/server'

import {
  type CustomerAuthContext,
  withCustomerAuth,
} from '@/lib/customer-auth'
import { resolveGoDaddyApiBaseUrl } from '@/lib/mcp/godaddy-api'
import {
  exchangeCustomerJwtForOAuthToken,
  TokenExchangeError,
} from '@/lib/mcp/token-exchange'
import { logger } from '@/lib/request-context'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{
    storeId: string
    settingPath?: string[]
  }>
}

const SETTINGS_API_SERVER_ID = 'commerce-settings-api'
const LOCAL_SETTINGS_API_TEST_TOKEN = 'settings-api-local-test-token'
const LOCAL_SETTINGS_API_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const READ_SCOPES = ['commerce.product:read', 'commerce.store:read'] as const
const WRITE_SCOPES = ['commerce.product:write', 'commerce.store:read'] as const

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

function resolveSettingsApiBaseUrl(): string {
  const override =
    process.env.COMMERCE_SETTINGS_API_BASE_URL ??
    process.env.SETTINGS_API_BASE_URL

  if (override) return normalizeBaseUrl(override)

  const apiBaseUrl = resolveGoDaddyApiBaseUrl()
  const host = new URL(apiBaseUrl).host
  return `https://settings.commerce.${host}`
}

function pathSegmentsAreSafe(segments: string[]): boolean {
  return segments.every((segment) =>
    segment.length > 0 &&
    segment !== '.' &&
    segment !== '..' &&
    !segment.includes('/'),
  )
}

function buildSettingsPath(segments: string[] | undefined): string[] {
  return segments && segments.length > 0 ? segments : ['surface']
}

function settingsApiUrl(baseUrl: string, storeId: string, settingPath: string[]): string {
  const encodedStoreId = encodeURIComponent(storeId)
  const encodedPath = settingPath.map(encodeURIComponent).join('/')
  return `${baseUrl}/v2/commerce/stores/${encodedStoreId}/settings/${encodedPath}`
}

function isLocalSettingsApiUrl(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl)
    return LOCAL_SETTINGS_API_HOSTS.has(hostname)
  } catch {
    return false
  }
}

function resolveLocalSettingsApiAccessToken(baseUrl: string): string | undefined {
  if (process.env.NODE_ENV === 'production') return undefined
  if (process.env.COMMERCE_SETTINGS_API_LOCAL_TEST_AUTH !== 'true') return undefined
  if (!isLocalSettingsApiUrl(baseUrl)) return undefined

  return process.env.COMMERCE_SETTINGS_API_LOCAL_TEST_TOKEN ?? LOCAL_SETTINGS_API_TEST_TOKEN
}

function proxyHeaders(request: NextRequest, accessToken: string): Headers {
  const headers = new Headers({
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  })

  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('Content-Type', contentType)

  const idempotencyKey = request.headers.get('idempotency-key')
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey)

  const ifMatch = request.headers.get('if-match')
  if (ifMatch) headers.set('If-Match', ifMatch)

  const requestId = request.headers.get('x-request-id')
  if (requestId) headers.set('X-Request-Id', requestId)

  const fixtureScenario = request.nextUrl.searchParams.get('settingsFixtureScenario')
  if (fixtureScenario) headers.set('X-Settings-Fixture-Scenario', fixtureScenario)

  return headers
}

async function proxySettingsApi(
  request: NextRequest,
  authContext: CustomerAuthContext,
  context: RouteContext,
  method: 'GET' | 'PATCH' | 'POST',
): Promise<NextResponse> {
  const { storeId, settingPath: rawSettingPath } = await context.params
  const settingPath = buildSettingsPath(rawSettingPath)

  if (!storeId) {
    return NextResponse.json(
      { error: 'commerce_settings: storeId is required' },
      { status: 400 },
    )
  }

  if (!pathSegmentsAreSafe(settingPath)) {
    return NextResponse.json(
      { error: 'commerce_settings: invalid setting path' },
      { status: 400 },
    )
  }

  const baseUrl = resolveSettingsApiBaseUrl()
  const localAccessToken = resolveLocalSettingsApiAccessToken(baseUrl)

  if (!localAccessToken && !authContext.jwt) {
    return NextResponse.json(
      { error: 'commerce_settings: missing customer JWT' },
      { status: 401 },
    )
  }

  let accessToken: string
  if (localAccessToken) {
    accessToken = localAccessToken
  } else {
    try {
      const token = await exchangeCustomerJwtForOAuthToken({
        customerJwt: authContext.jwt as string,
        customerId: authContext.user.customerId,
        serverId: SETTINGS_API_SERVER_ID,
        scopes: method === 'GET' ? READ_SCOPES : WRITE_SCOPES,
      })
      accessToken = token.accessToken
    } catch (err) {
      if (err instanceof TokenExchangeError) {
        logger.warn('commerce.settings.token_exchange.failed', {
          storeId,
          settingPath: settingPath.join('/'),
          status: err.status,
          message: err.message,
        })
        return NextResponse.json(
          { error: `commerce_settings: token exchange failed: ${err.message}` },
          { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
        )
      }

      const message = err instanceof Error ? err.message : String(err)
      logger.error('commerce.settings.token_exchange.unexpected_error', {
        storeId,
        settingPath: settingPath.join('/'),
        error: message,
      })
      return NextResponse.json(
        { error: `commerce_settings: token exchange failed before response: ${message}` },
        { status: 502 },
      )
    }
  }

  const upstreamUrl = settingsApiUrl(baseUrl, storeId, settingPath)
  const body = method === 'GET' ? undefined : await request.text()

  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, {
      method,
      headers: proxyHeaders(request, accessToken),
      body: body || undefined,
      cache: 'no-store',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('commerce.settings.upstream.network_error', {
      storeId,
      settingPath: settingPath.join('/'),
      method,
      error: message,
    })
    return NextResponse.json(
      { error: `commerce_settings: upstream request failed: ${message}` },
      { status: 502 },
    )
  }

  const responseText = await upstream.text()
  return new NextResponse(responseText, {
    status: upstream.status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    },
  })
}

export const GET = withCustomerAuth(
  (request: NextRequest, authContext: CustomerAuthContext, context: RouteContext) =>
    proxySettingsApi(request, authContext, context, 'GET'),
)

export const PATCH = withCustomerAuth(
  (request: NextRequest, authContext: CustomerAuthContext, context: RouteContext) =>
    proxySettingsApi(request, authContext, context, 'PATCH'),
  { level: 3 },
)

export const POST = withCustomerAuth(
  (request: NextRequest, authContext: CustomerAuthContext, context: RouteContext) =>
    proxySettingsApi(request, authContext, context, 'POST'),
  { level: 3 },
)
