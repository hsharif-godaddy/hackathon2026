import { describe, it, expect, vi, beforeEach } from 'vitest'

const SAMPLE = {
  version: 1,
  generatedAt: '2026-05-18T01:30:31.751Z',
  kits: [
    { slug: 'modern-bento', whenToUse: 'Use for service businesses.', tags: ['modern','bright'], questions: ['Q?'], tarball: 'a.tar.gz', tarballHash: 'sha256-abc' },
    { slug: 'volt', whenToUse: 'Use for athletic brands.', tags: ['bold','dark-first'], questions: ['Q?'], tarball: 'b.tar.gz', tarballHash: 'sha256-def' },
  ],
}

describe('listDesignSystems tool', () => {
  beforeEach(() => { vi.resetModules() })

  it('returns formatted markdown listing slug + whenToUse + tags', async () => {
    vi.doMock('../../../services/design-system/catalog.js', () => ({
      fetchDesignSystemCatalog: vi.fn().mockResolvedValue(SAMPLE),
      resolveDesignSystemBaseUrl: () => 'http://x/brand-kits',
    }))
    const { listDesignSystemsAITool } = await import('../list-design-systems.js')
    const out = await listDesignSystemsAITool.execute({}, {} as any) as string
    expect(out).toContain('modern-bento')
    expect(out).toContain('Use for service businesses.')
    expect(out).toContain('modern')
    expect(out).toContain('volt')
    expect(out).not.toContain('a.tar.gz')
    expect(out).not.toContain('sha256-')
  })

  it('filters by tags when provided', async () => {
    vi.doMock('../../../services/design-system/catalog.js', () => ({
      fetchDesignSystemCatalog: vi.fn().mockResolvedValue(SAMPLE),
      resolveDesignSystemBaseUrl: () => 'http://x/brand-kits',
    }))
    const { listDesignSystemsAITool } = await import('../list-design-systems.js')
    const out = await listDesignSystemsAITool.execute({ tags: ['bold'] }, {} as any) as string
    expect(out).toContain('volt')
    expect(out).not.toContain('modern-bento')
  })
})
