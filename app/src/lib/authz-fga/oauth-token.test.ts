import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthzFgaConfig } from '@/lib/authz-fga/config'
import { clearAuthzFgaTokenCacheForTests, getAuthzFgaAccessToken } from '@/lib/authz-fga/oauth-token'

const baseConfig: AuthzFgaConfig = {
  baseUrl: 'https://fga.example.test',
  storeId: 'store-1',
  oauthTokenUrl: 'https://oauth.example.test/token',
  clientId: 'client-abc',
  clientSecret: 'secret-xyz',
}

function tokenResponse(accessToken: string, expiresIn = 3600) {
  return { ok: true, text: async () => JSON.stringify({ access_token: accessToken, expires_in: expiresIn }) }
}

describe('authz-fga/oauth-token', function authzFgaOauthToken() {
  const originalLocalMock = process.env.AUTHZ_FGA_LOCAL_MOCK

  beforeEach(function reset() {
    delete process.env.AUTHZ_FGA_LOCAL_MOCK
    clearAuthzFgaTokenCacheForTests()
  })

  afterEach(function restore() {
    if (originalLocalMock === undefined) {
      delete process.env.AUTHZ_FGA_LOCAL_MOCK
    } else {
      process.env.AUTHZ_FGA_LOCAL_MOCK = originalLocalMock
    }
    clearAuthzFgaTokenCacheForTests()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('POSTs client_credentials to the oauth token url and returns the access token', async function fetchesToken() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse('tok-1')))

    const token = await getAuthzFgaAccessToken(baseConfig)

    expect(token).toBe('tok-1')
    expect(fetch).toHaveBeenCalledWith(
      'https://oauth.example.test/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      })
    )
    const sentBody = vi.mocked(fetch).mock.calls[0]![1]!.body as string
    expect(sentBody).toContain('grant_type=client_credentials')
    expect(sentBody).toContain('client_id=client-abc')
    expect(sentBody).toContain('client_secret=secret-xyz')
  })

  it('serves a cached token on the second call without a second fetch (within TTL)', async function caches() {
    const fetchSpy = vi.fn().mockResolvedValue(tokenResponse('tok-cached'))
    vi.stubGlobal('fetch', fetchSpy)

    const first = await getAuthzFgaAccessToken(baseConfig)
    const second = await getAuthzFgaAccessToken(baseConfig)

    expect(first).toBe('tok-cached')
    expect(second).toBe('tok-cached')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('re-fetches once the cached token enters the expiry skew window', async function expiresWithSkew() {
    vi.useFakeTimers()
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('tok-old', 120)) // expires in 2 min
      .mockResolvedValueOnce(tokenResponse('tok-new', 3600))
    vi.stubGlobal('fetch', fetchSpy)

    expect(await getAuthzFgaAccessToken(baseConfig)).toBe('tok-old')
    // Advance past (ttl - skew): 120s ttl, 60s skew → expired after 60s.
    vi.advanceTimersByTime(70_000)
    expect(await getAuthzFgaAccessToken(baseConfig)).toBe('tok-new')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('throws a status-only error (never leaking the response body) on a non-ok response', async function failureNoLeak() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        // A real OAuth error can echo back the client_secret — must NOT surface.
        text: async () => JSON.stringify({ error: 'invalid_client', client_secret: 'secret-xyz' }),
      })
    )

    await expect(getAuthzFgaAccessToken(baseConfig)).rejects.toThrow('authz-fga.oauth-token failed: 401')
    await expect(getAuthzFgaAccessToken(baseConfig)).rejects.not.toThrow(/secret-xyz/)
  })

  it('throws when the response is ok but missing access_token', async function missingToken() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ expires_in: 3600 }) }))

    await expect(getAuthzFgaAccessToken(baseConfig)).rejects.toThrow(/missing access_token/)
  })

  it('returns the mock signature without any fetch when AUTHZ_FGA_LOCAL_MOCK=true', async function localMock() {
    process.env.AUTHZ_FGA_LOCAL_MOCK = 'true'
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    expect(await getAuthzFgaAccessToken(baseConfig)).toBe('mock-signature')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('dedups concurrent fetches — two in-flight callers share a single OAuth call', async function dedupsConcurrent() {
    let release: (() => void) | undefined
    const fetchSpy = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(tokenResponse('tok-shared'))
      })
    )
    vi.stubGlobal('fetch', fetchSpy)

    const p1 = getAuthzFgaAccessToken(baseConfig)
    const p2 = getAuthzFgaAccessToken(baseConfig)
    release!()
    const [t1, t2] = await Promise.all([p1, p2])

    expect(t1).toBe('tok-shared')
    expect(t2).toBe('tok-shared')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('clears the in-flight slot on failure so the next caller retries', async function retriesAfterFailure() {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(tokenResponse('tok-recovered'))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(getAuthzFgaAccessToken(baseConfig)).rejects.toThrow('network down')
    expect(await getAuthzFgaAccessToken(baseConfig)).toBe('tok-recovered')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
