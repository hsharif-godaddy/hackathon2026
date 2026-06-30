import { describe, it, expect, vi, beforeEach } from 'vitest'

// AIROBUILD-2665 / Fix B — kitTokensLocked(appId) is the forced-install-only
// signal that locks colorScheme/fontTheme when a kit's tokens were applied
// DETERMINISTICALLY IN CODE. It is a synchronous, in-process SQLite read via
// AppMetadataRepository().get(appId).designKitTokensLocked, best-effort (any
// read error → false so a metadata hiccup never blocks a tool).
const mockGet = vi.hoisted(() => vi.fn())
const mockMerge = vi.hoisted(() => vi.fn())
const mockWarn = vi.hoisted(() => vi.fn())

vi.mock('../../../database/index.js', () => ({
  AppMetadataRepository: vi.fn().mockImplementation(function () {
    return { get: mockGet, merge: mockMerge }
  }),
}))

vi.mock('../../../logging/index.js', () => ({
  logger: { warn: mockWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe('kitTokensLocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when the designKitTokensLocked marker is true', async () => {
    mockGet.mockReturnValue({ designKitTokensLocked: true })
    const { kitTokensLocked } = await import('../kit-tokens-locked.js')
    expect(kitTokensLocked('test-app')).toBe(true)
  })

  it('returns false when the designKitTokensLocked marker is absent', async () => {
    mockGet.mockReturnValue({})
    const { kitTokensLocked } = await import('../kit-tokens-locked.js')
    expect(kitTokensLocked('test-app')).toBe(false)
  })

  it('returns false when the designKitTokensLocked marker is explicitly false', async () => {
    mockGet.mockReturnValue({ designKitTokensLocked: false })
    const { kitTokensLocked } = await import('../kit-tokens-locked.js')
    expect(kitTokensLocked('test-app')).toBe(false)
  })

  // Strict === true check: a truthy-but-non-true value must NOT lock the tools.
  it('returns false when the marker is truthy but not strictly true', async () => {
    mockGet.mockReturnValue({ designKitTokensLocked: 'yes' })
    const { kitTokensLocked } = await import('../kit-tokens-locked.js')
    expect(kitTokensLocked('test-app')).toBe(false)
  })

  it('returns false (best-effort) when the metadata read throws', async () => {
    mockGet.mockImplementation(() => {
      throw new Error('db locked')
    })
    const { kitTokensLocked } = await import('../kit-tokens-locked.js')
    expect(kitTokensLocked('test-app')).toBe(false)
  })
})

describe('lockKitTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not throw and logs a diagnostic when the metadata write fails', async () => {
    mockMerge.mockImplementation(() => {
      throw new Error('db locked')
    })
    const { lockKitTokens } = await import('../kit-tokens-locked.js')
    expect(() => lockKitTokens('test-app')).not.toThrow()
    expect(mockWarn).toHaveBeenCalledWith(
      'design_kit.lock_tokens.failed',
      expect.objectContaining({ appId: 'test-app' }),
    )
  })
})
