import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindByAppId } = vi.hoisted(() => ({
  mockFindByAppId: vi.fn(),
}))

vi.mock('../../database/repositories/ShareTokenRepository.js', () => ({
  ShareTokenRepository: class MockShareTokenRepository {
    findByAppId = mockFindByAppId
  },
}))

import { resolveAppBaseUrl, stripShareToken } from '../share-token.js'

const PREVIEW_URL = 'https://abc1234567.preview.c40.airoapp.ai/'
const APP_ID = 'abc1234567'
const TOKEN = 'testtoken1234'

function makeToken(overrides: { token?: string; expiresAt?: number } = {}) {
  return {
    token: overrides.token ?? TOKEN,
    appId: APP_ID,
    expiresAt: overrides.expiresAt ?? Date.now() + 86400_000,
    purpose: 'user' as const,
    createdAt: new Date(),
    firstUsedAt: null,
  }
}

describe('resolveAppBaseUrl', function resolveTests() {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appends airoShareToken when an active user token exists', function active() {
    mockFindByAppId.mockReturnValue([makeToken()])

    expect(resolveAppBaseUrl(PREVIEW_URL, APP_ID))
      .toBe(`${PREVIEW_URL}?airoShareToken=${TOKEN}`)
  })

  it('passes appId and purpose=user to the repository', function repoArgs() {
    mockFindByAppId.mockReturnValue([])

    resolveAppBaseUrl(PREVIEW_URL, APP_ID)

    expect(mockFindByAppId).toHaveBeenCalledWith(APP_ID, 'user')
  })

  it('returns bare previewUrl when no tokens exist', function noTokens() {
    mockFindByAppId.mockReturnValue([])

    expect(resolveAppBaseUrl(PREVIEW_URL, APP_ID)).toBe(PREVIEW_URL)
  })

  it('returns bare previewUrl when all tokens are expired', function expired() {
    mockFindByAppId.mockReturnValue([makeToken({ expiresAt: Date.now() - 1 })])

    expect(resolveAppBaseUrl(PREVIEW_URL, APP_ID)).toBe(PREVIEW_URL)
  })

  it('returns bare previewUrl when the DB throws', function dbError() {
    mockFindByAppId.mockImplementation(() => { throw new Error('SQLITE_ERROR') })

    expect(resolveAppBaseUrl(PREVIEW_URL, APP_ID)).toBe(PREVIEW_URL)
  })

  it('picks the active token when expired and active tokens are mixed', function mixed() {
    const activeToken = makeToken({ token: 'activetoken12' })
    const expiredToken = makeToken({ token: 'expiredtoken1', expiresAt: Date.now() - 1 })
    mockFindByAppId.mockReturnValue([expiredToken, activeToken])

    expect(resolveAppBaseUrl(PREVIEW_URL, APP_ID))
      .toBe(`${PREVIEW_URL}?airoShareToken=activetoken12`)
  })

  it('prepends https:// when previewUrl has no protocol', function noProtocol() {
    mockFindByAppId.mockReturnValue([makeToken()])

    const result = resolveAppBaseUrl('abc1234567.preview.c40.airoapp.ai/', APP_ID)
    expect(result).toContain('https://')
    expect(result).toContain(`airoShareToken=${TOKEN}`)
  })

  it('replaces an existing airoShareToken instead of duplicating it', function dedup() {
    const staleUrl = `${PREVIEW_URL}?airoShareToken=oldtoken`
    mockFindByAppId.mockReturnValue([makeToken({ token: 'newtoken' })])

    const result = resolveAppBaseUrl(staleUrl, APP_ID)
    expect(result).toContain('airoShareToken=newtoken')
    expect(result).not.toContain('oldtoken')
    expect((result.match(/airoShareToken/g) ?? []).length).toBe(1)
  })
})

describe('stripShareToken', function stripTests() {
  it('removes airoShareToken from a URL', function removes() {
    const url = 'https://abc.preview.c40.airoapp.ai/?airoShareToken=xyz123'
    expect(stripShareToken(url)).toBe('https://abc.preview.c40.airoapp.ai/')
  })

  it('returns the URL unchanged when no token is present', function unchanged() {
    const url = 'https://abc.preview.c40.airoapp.ai/'
    expect(stripShareToken(url)).toBe(url)
  })

  it('preserves other query params', function preserves() {
    const url = 'https://abc.preview.c40.airoapp.ai/?foo=bar&airoShareToken=xyz&baz=qux'
    const result = stripShareToken(url)
    expect(result).toContain('foo=bar')
    expect(result).toContain('baz=qux')
    expect(result).not.toContain('airoShareToken')
  })

  it('returns hostname-only input unchanged when no token', function hostnameOnly() {
    const url = 'abc.preview.c40.airoapp.ai'
    expect(stripShareToken(url)).toBe(url)
  })

  it('returns invalid/empty input unchanged', function invalid() {
    expect(stripShareToken('')).toBe('')
  })

  it('handles local dev URLs with ports', function localDev() {
    const url = 'https://local.gasket.dev-godaddy.com:5001/?airoShareToken=ZuNQV-5im52f'
    const result = stripShareToken(url)
    expect(result).toBe('https://local.gasket.dev-godaddy.com:5001/')
    expect(result).not.toContain('airoShareToken')
  })
})
