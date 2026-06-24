import { describe, it, expect, vi, beforeEach } from 'vitest'

const SAMPLE = {
  version: 1,
  generatedAt: '2026-06-24T00:00:00.000Z',
  kits: [
    {
      id: 'id-bold',
      slug: 'bold-studio',
      displayName: 'Bold Studio',
      whenToUse: 'Use for bold brands.',
      tags: ['bold', 'modern'],
      questions: ['Q?'],
      tarball: 'a.tar.gz',
      tarballHash: 'sha256-aaaaaaaaaaaa',
      thumbnail: 'thumbnails/bold.webp',
      design: {
        palette: { primary: '#111', background: '#fff', foreground: '#000', accent: '#f00', muted: '#eee' },
        typography: { display: { family: 'Inter' } },
      },
    },
    {
      id: 'id-soft',
      slug: 'soft-serif',
      displayName: 'Soft Serif',
      whenToUse: 'Use for elegant brands.',
      tags: ['elegant'],
      questions: ['Q?'],
      tarball: 'b.tar.gz',
      tarballHash: 'sha256-bbbbbbbbbbbb',
      images: { thumbnail: 'thumbnails/soft.webp' },
      design: { palette: { primary: '#234', background: '#fafafa' } },
    },
    {
      id: 'id-mono',
      slug: 'mono-minimal',
      displayName: 'Mono Minimal',
      whenToUse: 'Use for minimal brands.',
      tags: [],
      questions: ['Q?'],
      tarball: 'c.tar.gz',
      tarballHash: 'sha256-cccccccccccc',
    },
    {
      id: 'id-abs',
      slug: 'abs-thumb',
      displayName: 'Absolute Thumb',
      whenToUse: 'Use for testing absolute thumbnails.',
      tags: [],
      questions: ['Q?'],
      tarball: 'd.tar.gz',
      tarballHash: 'sha256-dddddddddddd',
      thumbnail: 'https://cdn.example/abs.webp',
    },
  ],
}

function mockCatalog(catalog: unknown = SAMPLE): void {
  vi.doMock('../../../services/design-system/catalog.js', () => ({
    fetchDesignSystemCatalog: vi.fn().mockResolvedValue(catalog),
    resolveDesignSystemAssetUrl: (p: string): string =>
      /^https?:\/\//i.test(p) ? p : `https://blobby.test/brand-kits/${p.replace(/^\/+/, '')}`,
  }))
}

interface SuggestResult {
  success: boolean
  message: string
  kits: Array<{
    slug: string
    displayName: string
    thumbnailUrl: string | null
    tags: string[]
    palette: Record<string, string | undefined>
    displayFont: string | null
  }>
}

describe('suggestDesignKits tool', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns the requested kits, best-first, with resolved thumbnail/palette/font', async () => {
    mockCatalog()
    const { suggestDesignKitsAITool } = await import('../suggest-design-kits.js')
    const out = (await suggestDesignKitsAITool.execute(
      { slugs: ['soft-serif', 'bold-studio'] },
      {} as never
    )) as SuggestResult

    expect(out.success).toBe(true)
    expect(out.kits.map((k) => k.slug)).toEqual(['soft-serif', 'bold-studio'])
    const bold = out.kits[1]
    expect(bold).toEqual({
      slug: 'bold-studio',
      displayName: 'Bold Studio',
      thumbnailUrl: 'https://blobby.test/brand-kits/thumbnails/bold.webp',
      tags: ['bold', 'modern'],
      palette: { primary: '#111', background: '#fff', foreground: '#000', accent: '#f00', muted: '#eee' },
      displayFont: 'Inter',
    })
  })

  it('falls back to images.thumbnail and a null font when display typography is absent', async () => {
    mockCatalog()
    const { suggestDesignKitsAITool } = await import('../suggest-design-kits.js')
    const out = (await suggestDesignKitsAITool.execute({ slugs: ['soft-serif'] }, {} as never)) as SuggestResult

    expect(out.kits[0].thumbnailUrl).toBe('https://blobby.test/brand-kits/thumbnails/soft.webp')
    expect(out.kits[0].displayFont).toBeNull()
  })

  it('returns a null thumbnail when the kit has no thumbnail or images', async () => {
    mockCatalog()
    const { suggestDesignKitsAITool } = await import('../suggest-design-kits.js')
    const out = (await suggestDesignKitsAITool.execute({ slugs: ['mono-minimal'] }, {} as never)) as SuggestResult

    expect(out.kits[0].thumbnailUrl).toBeNull()
    expect(out.kits[0].palette).toEqual({
      primary: undefined,
      background: undefined,
      foreground: undefined,
      accent: undefined,
      muted: undefined,
    })
  })

  it('passes through an already-absolute thumbnail URL', async () => {
    mockCatalog()
    const { suggestDesignKitsAITool } = await import('../suggest-design-kits.js')
    const out = (await suggestDesignKitsAITool.execute({ slugs: ['abs-thumb'] }, {} as never)) as SuggestResult

    expect(out.kits[0].thumbnailUrl).toBe('https://cdn.example/abs.webp')
  })

  it('resolves slugs by id and displayName, case-insensitively', async () => {
    mockCatalog()
    const { suggestDesignKitsAITool } = await import('../suggest-design-kits.js')
    const out = (await suggestDesignKitsAITool.execute(
      { slugs: ['ID-BOLD', 'Soft Serif'] },
      {} as never
    )) as SuggestResult

    expect(out.kits.map((k) => k.slug)).toEqual(['bold-studio', 'soft-serif'])
  })

  it('dedupes when the same kit is referenced more than once', async () => {
    mockCatalog()
    const { suggestDesignKitsAITool } = await import('../suggest-design-kits.js')
    const out = (await suggestDesignKitsAITool.execute(
      { slugs: ['bold-studio', 'id-bold', 'Bold Studio'] },
      {} as never
    )) as SuggestResult

    expect(out.kits).toHaveLength(1)
    expect(out.kits[0].slug).toBe('bold-studio')
  })

  it('skips unknown slugs but returns the resolved ones', async () => {
    mockCatalog()
    const { suggestDesignKitsAITool } = await import('../suggest-design-kits.js')
    const out = (await suggestDesignKitsAITool.execute(
      { slugs: ['nope', 'bold-studio'] },
      {} as never
    )) as SuggestResult

    expect(out.success).toBe(true)
    expect(out.kits.map((k) => k.slug)).toEqual(['bold-studio'])
  })

  it('throws (tool-error) when none of the slugs resolve, so the agent can retry instead of stalling', async () => {
    mockCatalog()
    const { suggestDesignKitsAITool } = await import('../suggest-design-kits.js')

    await expect(
      suggestDesignKitsAITool.execute({ slugs: ['nope', 'also-nope'] }, {} as never)
    ).rejects.toThrow(/none of the requested design kits matched/i)
  })

  it('throws (tool-error) when the catalog is unavailable', async () => {
    vi.doMock('../../../services/design-system/catalog.js', () => ({
      fetchDesignSystemCatalog: vi.fn().mockRejectedValue(new Error('network down')),
      resolveDesignSystemAssetUrl: (p: string): string => p,
    }))
    const { suggestDesignKitsAITool } = await import('../suggest-design-kits.js')

    await expect(
      suggestDesignKitsAITool.execute({ slugs: ['bold-studio'] }, {} as never)
    ).rejects.toThrow(/catalog is currently unavailable/i)
  })
})
