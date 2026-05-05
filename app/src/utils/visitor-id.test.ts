/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'

import { getVisitorIdFromCookie, visitorIdFromVisitorCookieRaw } from '@/utils/visitor-id'

function clearVisitorCookie() {
  document.cookie = 'visitor=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/'
}

describe('visitorIdFromVisitorCookieRaw', () => {
  it('returns vid from visitor-style string', function rawVid() {
    expect(visitorIdFromVisitorCookieRaw('vid=abc&market=us')).toBe('abc')
  })

  it('returns vid after cookie-layer decode (query string form)', function decodedPayload() {
    expect(visitorIdFromVisitorCookieRaw('vid=encoded-id&market=us')).toBe('encoded-id')
  })

  it('returns undefined when missing', function rawMissing() {
    expect(visitorIdFromVisitorCookieRaw(undefined)).toBeUndefined()
    expect(visitorIdFromVisitorCookieRaw('market=us')).toBeUndefined()
  })
})

describe('getVisitorIdFromCookie', () => {
  afterEach(() => {
    clearVisitorCookie()
  })

  it('returns vid from visitor cookie', function visitorCookie() {
    document.cookie = 'visitor=vid%3Dabc-visitor-id; path=/'
    expect(getVisitorIdFromCookie()).toBe('abc-visitor-id')
  })

  it('returns undefined when visitor cookie has no vid', function visitorNoVid() {
    document.cookie = 'visitor=other%3D1; path=/'
    expect(getVisitorIdFromCookie()).toBeUndefined()
  })

  it('returns undefined when vid is empty (encoded vid%3D)', function visitorEmptyVidEncoded() {
    document.cookie = 'visitor=vid%3D; path=/'
    expect(getVisitorIdFromCookie()).toBeUndefined()
  })

  it('returns undefined when vid is empty (unencoded vid=)', function visitorEmptyVidUnencoded() {
    document.cookie = 'visitor=vid=; path=/'
    expect(getVisitorIdFromCookie()).toBeUndefined()
  })

  it('returns undefined when visitor cookie is absent', function noVisitor() {
    expect(getVisitorIdFromCookie()).toBeUndefined()
  })
})
