import { describe, expect, it } from 'vitest'
import {
  CELL_PREFIX_REGEX,
  SITE_ID_REGEX,
  TOKEN_REGEX,
  decodeSharePayload,
  encodeSharePayload,
  isEncodableCellPrefix,
  isEncodableSiteId,
  isEncodableToken,
  tokenSuffix,
} from '../codec.js'

describe('share-url codec', () => {
  describe('encodeSharePayload', () => {
    it('produces a base64url string from valid fields', () => {
      const encoded = encodeSharePayload({
        siteId: 'k8bnu24pcq',
        cellPrefix: 'c4',
        token: 'yPBorcyKvnYJ',
      })
      // Decoding back to plaintext confirms the encoding shape without
      // hardcoding a base64 string that's easy to get wrong in review
      expect(Buffer.from(encoded, 'base64url').toString('utf8')).toBe(
        'k8bnu24pcq:c4:yPBorcyKvnYJ',
      )
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('uses URL-safe charset only (no +, /, =)', () => {
      const encoded = encodeSharePayload({
        siteId: 'abc123def4',
        cellPrefix: 'c36',
        token: 'H-NQO5LBt0_H',
      })
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('throws when siteId fails validation (e.g. UUID is too long)', () => {
      expect(() =>
        encodeSharePayload({
          siteId: '550e8400-e29b-41d4-a716-446655440000',
          cellPrefix: 'c4',
          token: 'yPBorcyKvnYJ',
        }),
      ).toThrow(/siteId/)
    })

    it('throws when cellPrefix fails validation', () => {
      expect(() =>
        encodeSharePayload({ siteId: 'k8bnu24pcq', cellPrefix: 'dev', token: 'yPBorcyKvnYJ' }),
      ).toThrow(/cellPrefix/)
    })

    it('throws when given a full cellId instead of a cellPrefix', () => {
      // Real AppInfo.cellId looks like "c4-dev-sxb1-eu-central-1" — the codec
      // only accepts the short prefix form ("c4"). This test documents the
      // contract so a caller passing app.cellId directly fails loudly.
      expect(() =>
        encodeSharePayload({
          siteId: 'k8bnu24pcq',
          cellPrefix: 'c4-dev-sxb1-eu-central-1',
          token: 'yPBorcyKvnYJ',
        }),
      ).toThrow(/cellPrefix/)
    })

    it('throws when token fails validation', () => {
      expect(() =>
        encodeSharePayload({ siteId: 'k8bnu24pcq', cellPrefix: 'c4', token: 'short' }),
      ).toThrow(/token/)
    })
  })

  describe('field-separator invariant', () => {
    it("none of the field charsets allow ':'", () => {
      // If any field could contain ':', decode would split into >3 parts and
      // round-trips would silently fail. Assert the contract explicitly.
      expect(SITE_ID_REGEX.test('k8bnu:24pcq')).toBe(false)
      expect(CELL_PREFIX_REGEX.test('c4:dev')).toBe(false)
      expect(TOKEN_REGEX.test('token:colon')).toBe(false)
    })
  })

  describe('isEncodable* helpers', () => {
    it('isEncodableSiteId rejects UUID-format ids (too long)', () => {
      expect(isEncodableSiteId('550e8400-e29b-41d4-a716-446655440000')).toBe(false)
    })

    it('isEncodableSiteId accepts nanoid- and hyphen-style ids', () => {
      expect(isEncodableSiteId('k8bnu24pcq')).toBe(true)
      expect(isEncodableSiteId('test-app-123')).toBe(true)
      expect(isEncodableSiteId('nxOMNRQOtCBBHG7e3CI8R')).toBe(true)
    })

    it('isEncodableCellPrefix only accepts cN form', () => {
      expect(isEncodableCellPrefix('c4')).toBe(true)
      expect(isEncodableCellPrefix('c36')).toBe(true)
      expect(isEncodableCellPrefix('c4-dev')).toBe(false)
      expect(isEncodableCellPrefix('dev')).toBe(false)
    })

    it('isEncodableToken matches the share-token-generator contract', () => {
      expect(isEncodableToken('yPBorcyKvnYJ')).toBe(true)
      expect(isEncodableToken('H-NQO5LBt0_H')).toBe(true)
      expect(isEncodableToken('short')).toBe(false)
      expect(isEncodableToken('thisistoolongtoken123')).toBe(false)
    })
  })

  describe('decodeSharePayload', () => {
    it('round-trips a valid payload', () => {
      const original = { siteId: 'k8bnu24pcq', cellPrefix: 'c4', token: 'yPBorcyKvnYJ' }
      const decoded = decodeSharePayload(encodeSharePayload(original))
      expect(decoded).toEqual(original)
    })

    it('round-trips with token containing - and _', () => {
      const original = { siteId: 'k8bnu24pcq', cellPrefix: 'c9', token: 'H-NQO5LBt0_H' }
      const decoded = decodeSharePayload(encodeSharePayload(original))
      expect(decoded).toEqual(original)
    })

    it('round-trips with multi-digit cellPrefix', () => {
      const original = { siteId: 'k8bnu24pcq', cellPrefix: 'c36', token: 'yPBorcyKvnYJ' }
      const decoded = decodeSharePayload(encodeSharePayload(original))
      expect(decoded).toEqual(original)
    })

    it('returns null for empty string', () => {
      expect(decodeSharePayload('')).toBeNull()
    })

    it('returns null for non-string input', () => {
      expect(decodeSharePayload(null as unknown as string)).toBeNull()
      expect(decodeSharePayload(undefined as unknown as string)).toBeNull()
      expect(decodeSharePayload(123 as unknown as string)).toBeNull()
    })

    it('returns null for input exceeding length cap', () => {
      const tooLong = 'a'.repeat(129)
      expect(decodeSharePayload(tooLong)).toBeNull()
    })

    it('returns null for malformed base64url', () => {
      // base64url charset is [A-Za-z0-9_-]; spaces and special chars produce
      // garbage but Buffer doesn't throw — caught by field validation below
      const result = decodeSharePayload('not!valid@base64')
      expect(result).toBeNull()
    })

    it('returns null when plaintext has fewer than 3 fields', () => {
      const twoFields = Buffer.from('siteid:c4', 'utf8').toString('base64url')
      expect(decodeSharePayload(twoFields)).toBeNull()
    })

    it('returns null when plaintext has more than 3 fields', () => {
      const fourFields = Buffer.from('siteid:c4:token:extra', 'utf8').toString('base64url')
      expect(decodeSharePayload(fourFields)).toBeNull()
    })

    it('accepts mixed-case nanoid-style siteId', () => {
      const original = { siteId: 'nxOMNRQOtCBBHG7e3CI8R', cellPrefix: 'c4', token: 'yPBorcyKvnYJ' }
      const decoded = decodeSharePayload(encodeSharePayload(original))
      expect(decoded).toEqual(original)
    })

    it('accepts siteId with hyphens', () => {
      const original = { siteId: 'test-app-123', cellPrefix: 'c4', token: 'yPBorcyKvnYJ' }
      const decoded = decodeSharePayload(encodeSharePayload(original))
      expect(decoded).toEqual(original)
    })

    it('returns null when siteId contains a dot (hostname injection attempt)', () => {
      const encoded = Buffer.from('evil.com:c4:yPBorcyKvnYJ', 'utf8').toString('base64url')
      expect(decodeSharePayload(encoded)).toBeNull()
    })

    it('returns null when siteId is too short', () => {
      const encoded = Buffer.from('abc12:c4:yPBorcyKvnYJ', 'utf8').toString('base64url')
      expect(decodeSharePayload(encoded)).toBeNull()
    })

    it('returns null when cellPrefix does not match c\\d+', () => {
      const encoded = Buffer.from('k8bnu24pcq:dev:yPBorcyKvnYJ', 'utf8').toString('base64url')
      expect(decodeSharePayload(encoded)).toBeNull()
    })

    it('returns null when cellPrefix has hyphens (full cellId form is not accepted)', () => {
      const encoded = Buffer.from('k8bnu24pcq:c4-dev:yPBorcyKvnYJ', 'utf8').toString('base64url')
      expect(decodeSharePayload(encoded)).toBeNull()
    })

    it('returns null when token is too short', () => {
      const encoded = Buffer.from('k8bnu24pcq:c4:short', 'utf8').toString('base64url')
      expect(decodeSharePayload(encoded)).toBeNull()
    })

    it('returns null when token is too long', () => {
      const encoded = Buffer.from('k8bnu24pcq:c4:thisistoolongtoken123', 'utf8').toString('base64url')
      expect(decodeSharePayload(encoded)).toBeNull()
    })

    it('returns null when token contains invalid chars', () => {
      const encoded = Buffer.from('k8bnu24pcq:c4:bad+token!!', 'utf8').toString('base64url')
      expect(decodeSharePayload(encoded)).toBeNull()
    })

    it('returns null when any field is empty', () => {
      const encoded = Buffer.from(':c4:yPBorcyKvnYJ', 'utf8').toString('base64url')
      expect(decodeSharePayload(encoded)).toBeNull()
    })
  })

  describe('tokenSuffix', () => {
    it('returns the last 4 chars of a real token', () => {
      expect(tokenSuffix('yPBorcyKvnYJ')).toBe('vnYJ')
    })

    it('returns "****" for null / undefined / non-string input', () => {
      expect(tokenSuffix(null)).toBe('****')
      expect(tokenSuffix(undefined)).toBe('****')
      expect(tokenSuffix(12345 as unknown)).toBe('****')
    })

    it('returns "****" for short strings (len < 8)', () => {
      // Too short to be a real share token; do not leak the whole value.
      expect(tokenSuffix('')).toBe('****')
      expect(tokenSuffix('abc')).toBe('****')
      expect(tokenSuffix('1234567')).toBe('****')
    })

    it('returns the last 4 chars at the 8-char boundary', () => {
      expect(tokenSuffix('abcdefgh')).toBe('efgh')
    })
  })
})
