import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetMcpTokenCacheForTests,
  exchangeCustomerJwtForOAuthToken,
  TokenExchangeError,
} from '../token-exchange'

const ORIGINAL_ENV = { ...process.env }

function mockTokenResponse(body: Record<string, unknown>, init: { status?: number } = {}) {
  const status = init.status ?? 200
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('exchangeCustomerJwtForOAuthToken', () => {
  beforeEach(() => {
    __resetMcpTokenCacheForTests()
    process.env = {
      ...ORIGINAL_ENV,
      GODADDY_API_BASE_URL: 'https://api.dev-godaddy.com',
      AIRO_APP_BUILDER_CLIENT_ID: 'client-abc',
      AIRO_APP_BUILDER_CLIENT_SECRET: 'secret-xyz',
    }
    vi.restoreAllMocks()
  })

  afterEach(() => {
    __resetMcpTokenCacheForTests()
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('POSTs to the derived token endpoint with jwt-bearer grant', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockTokenResponse({ access_token: 'oauth-1', token_type: 'Bearer', expires_in: 300 }),
      )

    const result = await exchangeCustomerJwtForOAuthToken({
      customerJwt: 'jwt-value',
      customerId: 'cust-1',
      serverId: 'commerce',
      scopes: ['commerce.product:read'],
    })

    expect(result.accessToken).toBe('oauth-1')
    expect(result.cached).toBe(false)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://api.dev-godaddy.com/v2/oauth2/token')
    const body = (init?.body as URLSearchParams).toString()
    expect(body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer')
    expect(body).toContain('assertion=jwt-value')
    expect(body).toContain('client_id=client-abc')
    expect(body).toContain('client_secret=secret-xyz')
    expect(body).toContain('scope=commerce.product%3Aread')
  })

  it('caches by (customerId, serverId, scopeSet)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        mockTokenResponse({ access_token: 'oauth-cached', token_type: 'Bearer', expires_in: 300 }),
      )

    const a = await exchangeCustomerJwtForOAuthToken({
      customerJwt: 'jwt',
      customerId: 'cust-1',
      serverId: 'commerce',
      scopes: ['openid'],
    })
    const b = await exchangeCustomerJwtForOAuthToken({
      customerJwt: 'jwt',
      customerId: 'cust-1',
      serverId: 'commerce',
      scopes: ['openid'],
    })

    expect(a.cached).toBe(false)
    expect(b.cached).toBe(true)
    expect(b.accessToken).toBe('oauth-cached')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('cache key is insensitive to scope order and case', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        mockTokenResponse({ access_token: 't', token_type: 'Bearer', expires_in: 300 }),
      )
    await exchangeCustomerJwtForOAuthToken({
      customerJwt: 'jwt',
      customerId: 'cust-1',
      serverId: 'commerce',
      scopes: ['commerce.store:read', 'openid'],
    })
    await exchangeCustomerJwtForOAuthToken({
      customerJwt: 'jwt',
      customerId: 'cust-1',
      serverId: 'commerce',
      scopes: ['OPENID', 'commerce.store:read'],
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('forceRefresh bypasses cache', async () => {
    // Each call needs a fresh Response — fetch body streams are
    // one-shot, so a single shared Response object would throw
    // "Body is unusable" on the second .json() read.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        mockTokenResponse({ access_token: 't', token_type: 'Bearer', expires_in: 300 }),
      )
    await exchangeCustomerJwtForOAuthToken({
      customerJwt: 'jwt',
      customerId: 'cust-1',
      serverId: 'commerce',
      scopes: ['openid'],
    })
    await exchangeCustomerJwtForOAuthToken({
      customerJwt: 'jwt',
      customerId: 'cust-1',
      serverId: 'commerce',
      scopes: ['openid'],
      forceRefresh: true,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('throws TokenExchangeError with upstream status on 400', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(
      exchangeCustomerJwtForOAuthToken({
        customerJwt: 'bad',
        customerId: 'cust-1',
        serverId: 'commerce',
        scopes: ['openid'],
      }),
    ).rejects.toBeInstanceOf(TokenExchangeError)
  })

  it('throws when OAuth response lacks access_token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockTokenResponse({ token_type: 'Bearer', expires_in: 300 } as Record<string, unknown>),
    )
    await expect(
      exchangeCustomerJwtForOAuthToken({
        customerJwt: 'jwt',
        customerId: 'cust-1',
        serverId: 'commerce',
        scopes: ['openid'],
      }),
    ).rejects.toBeInstanceOf(TokenExchangeError)
  })

  it('falls back and still caches when OAuth response omits expires_in', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockTokenResponse({ access_token: 'oauth-no-exp', token_type: 'Bearer' }),
    )
    const result = await exchangeCustomerJwtForOAuthToken({
      customerJwt: 'jwt',
      customerId: 'cust-1',
      serverId: 'commerce',
      scopes: ['openid'],
    })
    expect(result.accessToken).toBe('oauth-no-exp')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid expires_in values', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockTokenResponse({ access_token: 'oauth-bad-exp', token_type: 'Bearer', expires_in: '300' }),
    )
    await expect(
      exchangeCustomerJwtForOAuthToken({
        customerJwt: 'jwt',
        customerId: 'cust-1',
        serverId: 'commerce',
        scopes: ['openid'],
      }),
    ).rejects.toBeInstanceOf(TokenExchangeError)
  })

  it('throws when client credentials are missing', async () => {
    delete process.env.AIRO_APP_BUILDER_CLIENT_ID
    await expect(
      exchangeCustomerJwtForOAuthToken({
        customerJwt: 'jwt',
        customerId: 'cust-1',
        serverId: 'commerce',
        scopes: ['openid'],
      }),
    ).rejects.toThrow(/CLIENT_ID|CLIENT_SECRET/)
  })
})
