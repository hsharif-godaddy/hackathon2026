import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../database/repositories/index.js', () => ({
  shareTokenRepository: {
    findByAppId: vi.fn(),
  },
}))

import { shareTokenRepository } from '../../database/repositories/index.js'
import { resolveAppBaseUrl } from '../share-token.js'

const mockFindByAppId = vi.mocked(shareTokenRepository.findByAppId)

const PREVIEW_URL = 'https://abc1234567.preview.c40.airoapp.ai'
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
})
