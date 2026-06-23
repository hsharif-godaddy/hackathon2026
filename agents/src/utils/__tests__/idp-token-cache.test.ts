import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLoggerWarn } = vi.hoisted(() => ({ mockLoggerWarn: vi.fn() }))
vi.mock('../../logging/index.js', () => ({ logger: { warn: mockLoggerWarn } }))

import { __clearIdpTokenCache, cacheIdpToken, getIdpToken, idpTokenCacheKey } from '../idp-token-cache.js'

// Must match IDP_TOKEN_MAX_AGE_MS in the module under test
const TTL_MS = 5 * 60 * 1000

// Fake time epoch in seconds — matches vi.setSystemTime below
const NOW_S = 1767225600

function makeToken(payload: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${b64}.signature`
}

describe('idp-token-cache', function idpTokenCacheTests() {
  beforeEach(function useFakeTime() {
    __clearIdpTokenCache()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    vi.clearAllMocks()
  })

  afterEach(function realTime() {
    vi.useRealTimers()
  })

  describe('idpTokenCacheKey', function keyTests() {
    it('formats key as conversationId:auth_idp', function keyFormat() {
      expect(idpTokenCacheKey('conv-abc')).toBe('conv-abc:auth_idp')
    })
  })

  describe('getIdpToken', function getTests() {
    it('returns null when nothing is cached', function cacheMiss() {
      expect(getIdpToken('never-cached-conv-001')).toBeNull()
    })

    it('returns token immediately after caching', function freshHit() {
      cacheIdpToken('conv-fresh-001', 'sso-token-fresh')
      expect(getIdpToken('conv-fresh-001')).toBe('sso-token-fresh')
    })

    it('returns null after TTL has elapsed', function expired() {
      cacheIdpToken('conv-expire-001', 'sso-token-expire')
      vi.advanceTimersByTime(TTL_MS + 1)
      expect(getIdpToken('conv-expire-001')).toBeNull()
      expect(mockLoggerWarn).toHaveBeenCalledWith('care.idp_token_cache.ttl_evicted', { conversationId: 'conv-expire-001' })
    })

    it('returns token at exactly TTL_MS (strict > check — boundary is still fresh)', function atBoundary() {
      cacheIdpToken('conv-boundary-001', 'sso-token-boundary')
      vi.advanceTimersByTime(TTL_MS)
      // Date.now() - cachedAt === TTL_MS, which is NOT > TTL_MS → still fresh
      expect(getIdpToken('conv-boundary-001')).toBe('sso-token-boundary')
    })

    it('returns null one ms after boundary', function oneAfterBoundary() {
      cacheIdpToken('conv-boundary-002', 'sso-token-past')
      vi.advanceTimersByTime(TTL_MS + 1)
      // Date.now() - cachedAt === TTL_MS + 1, which IS > TTL_MS → expired
      expect(getIdpToken('conv-boundary-002')).toBeNull()
    })

    it('deletes the expired entry so a second call still returns null', function expiryDelete() {
      cacheIdpToken('conv-del-001', 'sso-token-del')
      vi.advanceTimersByTime(TTL_MS + 1)
      expect(getIdpToken('conv-del-001')).toBeNull()
      // Entry was deleted on first call, not just skipped
      expect(getIdpToken('conv-del-001')).toBeNull()
    })

    it('different conversationIds are independent', function isolation() {
      cacheIdpToken('conv-iso-a', 'token-a')
      cacheIdpToken('conv-iso-b', 'token-b')
      expect(getIdpToken('conv-iso-a')).toBe('token-a')
      expect(getIdpToken('conv-iso-b')).toBe('token-b')
    })

    it('expiring one conversationId does not affect another', function isolatedExpiry() {
      cacheIdpToken('conv-iso-expire-a', 'token-exp-a')
      cacheIdpToken('conv-iso-expire-b', 'token-exp-b')
      vi.advanceTimersByTime(TTL_MS + 1)
      expect(getIdpToken('conv-iso-expire-a')).toBeNull()
      expect(getIdpToken('conv-iso-expire-b')).toBeNull()
    })
  })

  describe('cacheIdpToken', function cacheTests() {
    it('overwrites an existing entry with a new token', function overwrite() {
      cacheIdpToken('conv-overwrite-001', 'old-token')
      expect(cacheIdpToken('conv-overwrite-001', 'new-token')).toBe(true)
      expect(getIdpToken('conv-overwrite-001')).toBe('new-token')
    })

    it('re-caching resets the TTL', function ttlReset() {
      cacheIdpToken('conv-reset-001', 'token-v1')
      // Advance to just before expiry
      vi.advanceTimersByTime(TTL_MS - 1)
      // Re-cache resets cachedAt to now
      expect(cacheIdpToken('conv-reset-001', 'token-v2')).toBe(true)
      // Advance by TTL_MS - 1 again (just before the new expiry)
      vi.advanceTimersByTime(TTL_MS - 1)
      expect(getIdpToken('conv-reset-001')).toBe('token-v2')
    })

    it('returns false and does not cache a token whose exp is in the past', function expExpiredOnCache() {
      const token = makeToken({ exp: NOW_S - 1 })
      expect(cacheIdpToken('conv-exp-past-001', token)).toBe(false)
      expect(getIdpToken('conv-exp-past-001')).toBeNull()
      expect(mockLoggerWarn).toHaveBeenCalledWith('care.idp_token_cache.expired_on_cache', { conversationId: 'conv-exp-past-001' })
    })

    it('returns true and caches a token whose exp is in the future', function expFutureOnCache() {
      const token = makeToken({ exp: NOW_S + 3600 })
      expect(cacheIdpToken('conv-exp-future-001', token)).toBe(true)
      expect(getIdpToken('conv-exp-future-001')).toBe(token)
    })

    it('returns true and caches a token with no exp but valid iat (falls back to iat + 30min)', function noExpIatOnCache() {
      const token = makeToken({ iat: NOW_S })
      // iat + 1800s is in the future, so it gets cached
      expect(cacheIdpToken('conv-no-exp-001', token)).toBe(true)
      expect(getIdpToken('conv-no-exp-001')).toBe(token)
    })

    it('returns true for a malformed token with no JWT structure (decodeJwtExp returns null → no expiry check)', function malformedOnCache() {
      expect(cacheIdpToken('conv-malformed-001', 'not-a-jwt')).toBe(true)
      expect(getIdpToken('conv-malformed-001')).toBe('not-a-jwt')
    })
  })

  describe('getIdpToken jwt expiry', function jwtExpGetTests() {
    it('evicts and returns null when exp passes within the TTL window', function expExpiresWithinTtl() {
      const expInTwoSeconds = NOW_S + 2
      const token = makeToken({ exp: expInTwoSeconds })
      cacheIdpToken('conv-exp-evict-001', token)
      expect(getIdpToken('conv-exp-evict-001')).toBe(token)
      vi.advanceTimersByTime(2001)
      expect(getIdpToken('conv-exp-evict-001')).toBeNull()
      expect(mockLoggerWarn).toHaveBeenCalledWith('care.idp_token_cache.jwt_expired_on_read', { conversationId: 'conv-exp-evict-001' })
    })

    it('entry is deleted after exp eviction so second call also returns null', function expEvictDelete() {
      const token = makeToken({ exp: NOW_S + 1 })
      cacheIdpToken('conv-exp-del-001', token)
      vi.advanceTimersByTime(1001)
      expect(getIdpToken('conv-exp-del-001')).toBeNull()
      expect(getIdpToken('conv-exp-del-001')).toBeNull()
    })

    it('returns token when exp is still in the future', function expStillValid() {
      const token = makeToken({ exp: NOW_S + 3600 })
      cacheIdpToken('conv-exp-valid-001', token)
      vi.advanceTimersByTime(TTL_MS - 1)
      expect(getIdpToken('conv-exp-valid-001')).toBe(token)
    })

    it('iat-only token is TTL-evicted before the 30-min iat-based expiry is reached', function iatFallbackTtlEvicted() {
      // TTL_MS (5 min) < iat + 30min, so the TTL check always fires first at read time.
      // The iat + 30min guard is enforced at cache time (cacheIdpToken rejects expired iat tokens).
      const token = makeToken({ iat: NOW_S })
      cacheIdpToken('conv-iat-fallback-001', token)
      expect(getIdpToken('conv-iat-fallback-001')).toBe(token)
      vi.advanceTimersByTime(TTL_MS + 1)
      expect(getIdpToken('conv-iat-fallback-001')).toBeNull()
      expect(mockLoggerWarn).toHaveBeenCalledWith('care.idp_token_cache.ttl_evicted', { conversationId: 'conv-iat-fallback-001' })
    })

    it('returns token when cached entry is unparseable (TTL is sole guard)', function malformedOnGet() {
      cacheIdpToken('conv-malformed-get-001', 'not-a-jwt')
      expect(getIdpToken('conv-malformed-get-001')).toBe('not-a-jwt')
    })
  })
})
