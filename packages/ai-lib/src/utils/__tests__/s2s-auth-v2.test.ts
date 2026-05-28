import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetToken = vi.fn()

vi.mock('gd-auth-client', () => ({
  IamTokenClient: vi.fn().mockImplementation(() => ({
    getToken: mockGetToken,
    once: vi.fn(),
  })),
}))

vi.mock('@aws-sdk/credential-providers', () => ({
  fromIni: vi.fn().mockReturnValue(() => Promise.resolve({
    accessKeyId: 'AKIA-FAKE',
    secretAccessKey: 'fake-secret',
    sessionToken: 'fake-session',
  })),
}))

import {
  getS2STokenV2,
  refreshS2STokenV2,
  clearTokenCacheV2,
  isS2SAuthV2Enabled,
} from '../s2s-auth-v2.js'

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64')
  return `${header}.${body}.fake-sig`
}

describe('s2s-auth-v2', () => {
  const config = { awsProfile: 'test-profile', ssoHost: 'sso.test-godaddy.com' }

  beforeEach(() => {
    clearTokenCacheV2()
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.USE_S2S_AUTH
  })

  describe('#isS2SAuthV2Enabled', () => {
    it('returns true when USE_S2S_AUTH=true', () => {
      process.env.USE_S2S_AUTH = 'true'
      expect(isS2SAuthV2Enabled()).toBe(true)
    })

    it('returns false when USE_S2S_AUTH is unset', () => {
      delete process.env.USE_S2S_AUTH
      expect(isS2SAuthV2Enabled()).toBe(false)
    })

    it('returns false for non-true values', () => {
      process.env.USE_S2S_AUTH = 'yes'
      expect(isS2SAuthV2Enabled()).toBe(false)
    })
  })

  describe('#getS2STokenV2', () => {
    it('fetches and caches a token', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600
      mockGetToken.mockResolvedValue(makeJwt({ exp, sub: 'arn:aws:iam::role/test' }))

      const token1 = await getS2STokenV2(config)
      const token2 = await getS2STokenV2(config)

      expect(mockGetToken).toHaveBeenCalledTimes(1)
      expect(token1).toBe(token2)
    })

    it('re-fetches when the cached token is expired', async () => {
      const pastExp = Math.floor(Date.now() / 1000) - 10
      const futureExp = Math.floor(Date.now() / 1000) + 3600
      mockGetToken
        .mockResolvedValueOnce(makeJwt({ exp: pastExp, sub: 'r1' }))
        .mockResolvedValueOnce(makeJwt({ exp: futureExp, sub: 'r2' }))

      await getS2STokenV2(config)
      const token2 = await getS2STokenV2(config)

      expect(mockGetToken).toHaveBeenCalledTimes(2)
      const payload = JSON.parse(Buffer.from(token2.split('.')[1], 'base64').toString())
      expect(payload.sub).toBe('r2')
    })

    it('coalesces concurrent calls into a single fetch', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600
      mockGetToken.mockResolvedValue(makeJwt({ exp, sub: 'r' }))

      const [t1, t2, t3] = await Promise.all([
        getS2STokenV2(config),
        getS2STokenV2(config),
        getS2STokenV2(config),
      ])

      expect(mockGetToken).toHaveBeenCalledTimes(1)
      expect(t1).toBe(t2)
      expect(t2).toBe(t3)
    })
  })

  describe('multi-profile isolation', () => {
    it('caches tokens independently per awsProfile', async () => {
      const expA = Math.floor(Date.now() / 1000) + 3600
      const expB = Math.floor(Date.now() / 1000) + 3600
      mockGetToken
        .mockResolvedValueOnce(makeJwt({ exp: expA, sub: 'profile-a' }))
        .mockResolvedValueOnce(makeJwt({ exp: expB, sub: 'profile-b' }))

      const configA = { awsProfile: 'alpha', ssoHost: 'sso.test-godaddy.com' }
      const configB = { awsProfile: 'beta', ssoHost: 'sso.test-godaddy.com' }

      const tokenA = await getS2STokenV2(configA)
      const tokenB = await getS2STokenV2(configB)

      expect(mockGetToken).toHaveBeenCalledTimes(2)
      expect(tokenA).not.toBe(tokenB)

      const subA = JSON.parse(Buffer.from(tokenA.split('.')[1], 'base64').toString()).sub
      const subB = JSON.parse(Buffer.from(tokenB.split('.')[1], 'base64').toString()).sub
      expect(subA).toBe('profile-a')
      expect(subB).toBe('profile-b')
    })
  })

  describe('#clearTokenCacheV2', () => {
    it('clears a specific profile without affecting others', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600
      mockGetToken.mockResolvedValue(makeJwt({ exp, sub: 'r' }))

      const configA = { awsProfile: 'alpha', ssoHost: 'sso.test-godaddy.com' }
      const configB = { awsProfile: 'beta', ssoHost: 'sso.test-godaddy.com' }
      await getS2STokenV2(configA)
      await getS2STokenV2(configB)
      expect(mockGetToken).toHaveBeenCalledTimes(2)

      clearTokenCacheV2(configA)
      mockGetToken.mockResolvedValueOnce(makeJwt({ exp, sub: 'alpha-new' }))

      await getS2STokenV2(configA)
      await getS2STokenV2(configB)

      // alpha re-fetched, beta used cache
      expect(mockGetToken).toHaveBeenCalledTimes(3)
    })

    it('flushes all profiles when called without argument', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600
      mockGetToken.mockResolvedValue(makeJwt({ exp, sub: 'r' }))

      await getS2STokenV2({ awsProfile: 'a', ssoHost: 's' })
      await getS2STokenV2({ awsProfile: 'b', ssoHost: 's' })
      expect(mockGetToken).toHaveBeenCalledTimes(2)

      clearTokenCacheV2()

      await getS2STokenV2({ awsProfile: 'a', ssoHost: 's' })
      await getS2STokenV2({ awsProfile: 'b', ssoHost: 's' })
      expect(mockGetToken).toHaveBeenCalledTimes(4)
    })
  })

  describe('#refreshS2STokenV2', () => {
    it('bypasses cache and fetches a fresh token', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600
      mockGetToken
        .mockResolvedValueOnce(makeJwt({ exp, sub: 'old' }))
        .mockResolvedValueOnce(makeJwt({ exp, sub: 'new' }))

      await getS2STokenV2(config)
      const refreshed = await refreshS2STokenV2(config)

      expect(mockGetToken).toHaveBeenCalledTimes(2)
      const sub = JSON.parse(Buffer.from(refreshed.split('.')[1], 'base64').toString()).sub
      expect(sub).toBe('new')
    })
  })

  describe('JWT exp / iat fallback', () => {
    it('uses iat + 30min when exp is missing', async () => {
      const iat = Math.floor(Date.now() / 1000) + 100
      mockGetToken.mockResolvedValue(makeJwt({ iat, sub: 'r' }))

      const token = await getS2STokenV2(config)
      expect(token).toBeTruthy()

      // Second call should hit cache (iat+30min is well in the future)
      await getS2STokenV2(config)
      expect(mockGetToken).toHaveBeenCalledTimes(1)
    })

    it('falls back to 30min from now when neither exp nor iat is present', async () => {
      mockGetToken.mockResolvedValue(makeJwt({ sub: 'no-times' }))

      const token = await getS2STokenV2(config)
      expect(token).toBeTruthy()

      // Should still cache (30min from now) — not NaN-disabled
      await getS2STokenV2(config)
      expect(mockGetToken).toHaveBeenCalledTimes(1)
    })

    it('does not produce NaN expiry when iat is a string', async () => {
      mockGetToken.mockResolvedValue(makeJwt({ iat: 'not-a-number', sub: 'r' }))

      const token = await getS2STokenV2(config)
      expect(token).toBeTruthy()

      // Cache should work (fallback to 30min from now), not NaN-disable
      await getS2STokenV2(config)
      expect(mockGetToken).toHaveBeenCalledTimes(1)
    })
  })
})
