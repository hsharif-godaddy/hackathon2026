import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stable mocks for the memory store + media manifest (the brand tool's two backends).
const { mockGet, mockSet, mockGetManifest, mockMetadataGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
  mockGetManifest: vi.fn(),
  mockMetadataGet: vi.fn(),
}))

vi.mock('../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: () => ({ get: mockGet, set: mockSet }),
}))
vi.mock('../../../memory/interfaces/scope.js', () => ({
  workspaceScopeFromAppId: vi.fn(() => ({ scope: 'test' })),
  customerIdFromContext: vi.fn(() => undefined),
}))
vi.mock('../../../services/MediaManifestService.js', () => ({
  mediaManifestService: { getManifest: mockGetManifest },
}))
vi.mock('../../../logging/index.js', () => ({
  Logger: { create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))
vi.mock('../../../database/index.js', () => ({
  AppMetadataRepository: class { get = mockMetadataGet },
}))

import { brandAITool } from '../brand.js'

const ctx = { experimental_context: { metadata: { appId: 'app-1' } } } as never

beforeEach(() => {
  vi.clearAllMocks()
  mockGet.mockResolvedValue({ success: true, exists: false })
  mockSet.mockResolvedValue({ success: true })
  mockGetManifest.mockResolvedValue({ success: false })
  mockMetadataGet.mockReturnValue({})
})

describe('brand tool', () => {
  it('set: writes identity (merged), imagery keyword, and summary in one call', async () => {
    const out = (await brandAITool.execute({
      mode: 'set',
      voice: { weAre: ['bold'], weAreNot: ['stuffy'] },
      tagline: 'Make it real',
      imageryKeywords: 'warm minimal lifestyle, soft light',
      summary: 'A bold, modern brand.',
    }, ctx)) as string

    expect(mockSet).toHaveBeenCalledWith(expect.anything(), 'brand.identity', expect.objectContaining({
      voice: { weAre: ['bold'], weAreNot: ['stuffy'] },
      tagline: 'Make it real',
    }))
    expect(mockSet).toHaveBeenCalledWith(expect.anything(), 'brand.imagery', { keyword: 'warm minimal lifestyle, soft light' })
    expect(mockSet).toHaveBeenCalledWith(expect.anything(), 'brand.summary', { text: 'A bold, modern brand.' })
    expect(out).toContain('identity')
    expect(out).toContain('imagery')
    expect(out).toContain('summary')
  })

  it('set: only writes the fields provided', async () => {
    await brandAITool.execute({ mode: 'set', summary: 'Just a summary.' }, ctx)

    const keys = mockSet.mock.calls.map((c) => c[1])
    expect(keys).toEqual(['brand.summary'])
  })

  it('get: returns the whole brand in one read, with mood images from the manifest', async () => {
    mockGet.mockImplementation(async (_scope: unknown, key: string) => {
      switch (key) {
        case 'brand.identity': return { success: true, exists: true, value: { brandName: 'Acme', tagline: 'Go' } }
        case 'brand.summary': return { success: true, exists: true, value: { text: 'Summary here' } }
        case 'brand.imagery': return { success: true, exists: true, value: { keyword: 'warm' } }
        case 'brand.colors.palette': return { success: true, exists: true, value: { name: 'Indigo' } }
        case 'brand.typography': return { success: true, exists: true, value: { name: 'Modern Professional' } }
        default: return { success: true, exists: false }
      }
    })
    // The chosen kit now comes from app metadata (designKit), not brand.kit memory.
    mockMetadataGet.mockReturnValue({ designKit: { source: 'catalog', id: 'kit-1', displayName: 'Volt' } })
    mockGetManifest.mockResolvedValue({
      success: true,
      manifest: {
        'brand/mood-2': { currentUrl: 'https://cdn/2' },
        'brand/mood-1': { currentUrl: 'https://cdn/1' },
        'pages/home/hero': { currentUrl: 'https://cdn/hero' }, // not a brand/mood slot → excluded
      },
    })

    const out = (await brandAITool.execute({ mode: 'get' }, ctx)) as string

    expect(out).toContain('Acme')
    expect(out).toContain('Summary here')
    expect(out).toContain('Modern Professional')
    expect(out).toContain('Volt')
    // Mood images surface (sorted numerically) and non-brand slots are excluded.
    expect(out).toContain('brand/mood-1')
    expect(out).toContain('brand/mood-2')
    expect(out).not.toContain('pages/home/hero')
    expect(out.indexOf('brand/mood-1')).toBeLessThan(out.indexOf('brand/mood-2'))
  })

  it('returns an error when appId is missing', async () => {
    const out = (await brandAITool.execute({ mode: 'get' }, {} as never)) as string
    expect(out).toMatch(/app id/i)
  })
})
