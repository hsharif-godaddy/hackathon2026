import { describe, it, expect, vi, beforeEach } from 'vitest'

const ENTRY = {
  slug: 'modern-bento',
  id: '3e4848a8-912b-44e9-81ba-1cfaf058d458',
  displayName: 'Modern Bento',
  whenToUse: 'Use for service businesses.',
  tags: ['modern'],
  questions: ['What accent color?', 'Should it feel playful or restrained?'],
  tarball: 'kit.tar.gz',
  tarballHash: 'sha256-abcdef0123456789abcd',
}

const mockWorkspace = { workspaceId: 'a', variant: 'preview', files: { upload: vi.fn() } }

describe('installDesignSystem tool', () => {
  beforeEach(() => { vi.resetModules() })

  it('returns error when slug not in catalog', async () => {
    vi.doMock('../../../services/design-system/catalog.js', () => ({
      fetchDesignSystemCatalog: vi.fn().mockResolvedValue({ version: 1, generatedAt: '', kits: [ENTRY] }),
      resolveDesignSystemBaseUrl: () => 'http://x/brand-kits',
    }))
    vi.doMock('../../../services/design-system/install.js', () => ({
      installDesignSystem: vi.fn(),
    }))
    vi.doMock('../../../workspace/index.js', () => ({
      createForWorkspace: vi.fn().mockReturnValue(mockWorkspace),
    }))
    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'unknown' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string
    expect(out).toMatch(/not found in catalog/i)
  })

  it('resolves the entry case-insensitively (catalog slug "Terra", input "terra")', async () => {
    const installSpy = vi.fn().mockResolvedValue({ slug: 'Terra', written: 7 })
    const terra = { ...ENTRY, slug: 'Terra', id: 'e3979a61-4a99-4e30-8169-ffe06c73a1bc', displayName: 'Terra' }
    vi.doMock('../../../services/design-system/catalog.js', () => ({
      fetchDesignSystemCatalog: vi.fn().mockResolvedValue({ version: 1, generatedAt: '', kits: [terra] }),
      resolveDesignSystemBaseUrl: () => 'http://x/brand-kits',
    }))
    vi.doMock('../../../services/design-system/install.js', () => ({ installDesignSystem: installSpy }))
    vi.doMock('../../../workspace/index.js', () => ({ createForWorkspace: vi.fn().mockReturnValue(mockWorkspace) }))
    vi.doMock('../../../database/index.js', () => ({ AppMetadataRepository: class { merge = vi.fn() } }))

    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'terra' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string

    expect(installSpy).toHaveBeenCalledWith(expect.objectContaining({ entry: terra }))
    expect(out).toContain('loadUiKit')
  })

  it('resolves by id when the input is the catalog id', async () => {
    const installSpy = vi.fn().mockResolvedValue({ slug: 'modern-bento', written: 7 })
    vi.doMock('../../../services/design-system/catalog.js', () => ({
      fetchDesignSystemCatalog: vi.fn().mockResolvedValue({ version: 1, generatedAt: '', kits: [ENTRY] }),
      resolveDesignSystemBaseUrl: () => 'http://x/brand-kits',
    }))
    vi.doMock('../../../services/design-system/install.js', () => ({ installDesignSystem: installSpy }))
    vi.doMock('../../../workspace/index.js', () => ({ createForWorkspace: vi.fn().mockReturnValue(mockWorkspace) }))
    vi.doMock('../../../database/index.js', () => ({ AppMetadataRepository: class { merge = vi.fn() } }))

    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: ENTRY.id }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string

    expect(installSpy).toHaveBeenCalledWith(expect.objectContaining({ entry: ENTRY }))
    expect(out).toContain('loadUiKit')
  })

  it('resolves by displayName when the input is the human label', async () => {
    const installSpy = vi.fn().mockResolvedValue({ slug: 'modern-bento', written: 7 })
    vi.doMock('../../../services/design-system/catalog.js', () => ({
      fetchDesignSystemCatalog: vi.fn().mockResolvedValue({ version: 1, generatedAt: '', kits: [ENTRY] }),
      resolveDesignSystemBaseUrl: () => 'http://x/brand-kits',
    }))
    vi.doMock('../../../services/design-system/install.js', () => ({ installDesignSystem: installSpy }))
    vi.doMock('../../../workspace/index.js', () => ({ createForWorkspace: vi.fn().mockReturnValue(mockWorkspace) }))
    vi.doMock('../../../database/index.js', () => ({ AppMetadataRepository: class { merge = vi.fn() } }))

    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'modern bento' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string

    expect(installSpy).toHaveBeenCalledWith(expect.objectContaining({ entry: ENTRY }))
    expect(out).toContain('loadUiKit')
  })

  it('installs and returns success message', async () => {
    const installSpy = vi.fn().mockResolvedValue({ slug: 'modern-bento', written: 7 })
    vi.doMock('../../../services/design-system/catalog.js', () => ({
      fetchDesignSystemCatalog: vi.fn().mockResolvedValue({ version: 1, generatedAt: '', kits: [ENTRY] }),
      resolveDesignSystemBaseUrl: () => 'http://x/brand-kits',
    }))
    vi.doMock('../../../services/design-system/install.js', () => ({
      installDesignSystem: installSpy,
    }))
    vi.doMock('../../../workspace/index.js', () => ({
      createForWorkspace: vi.fn().mockReturnValue(mockWorkspace),
    }))
    vi.doMock('../../../database/index.js', () => ({
      AppMetadataRepository: class { merge = vi.fn() },
    }))

    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'modern-bento' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string

    expect(installSpy).toHaveBeenCalledWith(expect.objectContaining({ workspace: mockWorkspace }))
    expect(out).toContain('modern-bento')
    expect(out).toContain('loadUiKit')
  })

  it('stamps the matched entry id + displayName (no kitId when the entry lacks one)', async () => {
    const mergeSpy = vi.fn().mockReturnValue(undefined)
    vi.doMock('../../../services/design-system/catalog.js', () => ({
      fetchDesignSystemCatalog: vi.fn().mockResolvedValue({ version: 1, generatedAt: '', kits: [ENTRY] }),
      resolveDesignSystemBaseUrl: () => 'http://x/brand-kits',
    }))
    vi.doMock('../../../services/design-system/install.js', () => ({
      installDesignSystem: vi.fn().mockResolvedValue({ slug: 'modern-bento', written: 7 }),
    }))
    vi.doMock('../../../workspace/index.js', () => ({
      createForWorkspace: vi.fn().mockReturnValue(mockWorkspace),
    }))
    vi.doMock('../../../database/index.js', () => ({
      AppMetadataRepository: class { merge = mergeSpy },
    }))

    const { installDesignSystemAITool } = await import('../install-design-system.js')
    await installDesignSystemAITool.execute({ slug: 'modern-bento' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string

    expect(mergeSpy).toHaveBeenCalledTimes(1)
    expect(mergeSpy).toHaveBeenCalledWith('a', {
      designKit: { source: 'catalog', id: '3e4848a8-912b-44e9-81ba-1cfaf058d458', displayName: 'Modern Bento' },
    })
  })

  it('stamps kitId too when the matched entry has one', async () => {
    const mergeSpy = vi.fn().mockReturnValue(undefined)
    const entryWithKitId = {
      ...ENTRY,
      slug: 'Bordeaux',
      id: '98f856d5-5851-4d96-ac29-7e4f65273540',
      displayName: 'Bordeaux',
      kitId: '1ad2586d-f5bf-4ef5-8ac6-f7e5f5c5c3d9',
    }
    vi.doMock('../../../services/design-system/catalog.js', () => ({
      fetchDesignSystemCatalog: vi.fn().mockResolvedValue({ version: 1, generatedAt: '', kits: [entryWithKitId] }),
      resolveDesignSystemBaseUrl: () => 'http://x/brand-kits',
    }))
    vi.doMock('../../../services/design-system/install.js', () => ({
      installDesignSystem: vi.fn().mockResolvedValue({ slug: 'Bordeaux', written: 7 }),
    }))
    vi.doMock('../../../workspace/index.js', () => ({
      createForWorkspace: vi.fn().mockReturnValue(mockWorkspace),
    }))
    vi.doMock('../../../database/index.js', () => ({
      AppMetadataRepository: class { merge = mergeSpy },
    }))

    const { installDesignSystemAITool } = await import('../install-design-system.js')
    await installDesignSystemAITool.execute({ slug: 'Bordeaux' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string

    expect(mergeSpy).toHaveBeenCalledWith('a', {
      designKit: {
        source: 'catalog',
        id: '98f856d5-5851-4d96-ac29-7e4f65273540',
        displayName: 'Bordeaux',
        kitId: '1ad2586d-f5bf-4ef5-8ac6-f7e5f5c5c3d9',
      },
    })
  })

  it('still returns success when metadata stamping throws (best-effort)', async () => {
    vi.doMock('../../../services/design-system/catalog.js', () => ({
      fetchDesignSystemCatalog: vi.fn().mockResolvedValue({ version: 1, generatedAt: '', kits: [ENTRY] }),
      resolveDesignSystemBaseUrl: () => 'http://x/brand-kits',
    }))
    vi.doMock('../../../services/design-system/install.js', () => ({
      installDesignSystem: vi.fn().mockResolvedValue({ slug: 'modern-bento', written: 7 }),
    }))
    vi.doMock('../../../workspace/index.js', () => ({
      createForWorkspace: vi.fn().mockReturnValue(mockWorkspace),
    }))
    // merge throws — the stamp is best-effort and must not break the install.
    vi.doMock('../../../database/index.js', () => ({
      AppMetadataRepository: class { merge = vi.fn(() => { throw new Error('db down') }) },
    }))

    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'modern-bento' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string

    expect(out).toContain('modern-bento')
    expect(out).toContain('loadUiKit')
  })

  it('returns error when appId missing from context', async () => {
    vi.doMock('../../../services/design-system/catalog.js', () => ({
      fetchDesignSystemCatalog: vi.fn(),
      resolveDesignSystemBaseUrl: () => 'http://x/brand-kits',
    }))
    vi.doMock('../../../services/design-system/install.js', () => ({ installDesignSystem: vi.fn() }))
    vi.doMock('../../../workspace/index.js', () => ({
      createForWorkspace: vi.fn().mockReturnValue(null),
    }))
    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'x' }, {} as any) as string
    expect(out).toMatch(/app id/i)
  })

  it('returns error when workspace is unavailable', async () => {
    vi.doMock('../../../services/design-system/catalog.js', () => ({
      fetchDesignSystemCatalog: vi.fn(),
      resolveDesignSystemBaseUrl: () => 'http://x/brand-kits',
    }))
    vi.doMock('../../../services/design-system/install.js', () => ({ installDesignSystem: vi.fn() }))
    vi.doMock('../../../workspace/index.js', () => ({
      createForWorkspace: vi.fn().mockReturnValue(null),
    }))
    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'x' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string
    expect(out).toMatch(/workspace unavailable/i)
  })

  it('returns formatted error when installDesignSystem throws', async () => {
    const mergeSpy = vi.fn()
    vi.doMock('../../../services/design-system/catalog.js', () => ({
      fetchDesignSystemCatalog: vi.fn().mockResolvedValue({ version: 1, generatedAt: '', kits: [ENTRY] }),
      resolveDesignSystemBaseUrl: () => 'http://x/brand-kits',
    }))
    vi.doMock('../../../services/design-system/install.js', () => ({
      installDesignSystem: vi.fn().mockRejectedValue(new Error('design-system hash mismatch for modern-bento')),
    }))
    vi.doMock('../../../workspace/index.js', () => ({
      createForWorkspace: vi.fn().mockReturnValue(mockWorkspace),
    }))
    vi.doMock('../../../database/index.js', () => ({
      AppMetadataRepository: class { merge = mergeSpy },
    }))
    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'modern-bento' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string
    expect(out).toContain('Error installing design system')
    expect(out).toContain('hash mismatch')
    expect(out).toContain('install')
    expect(mergeSpy).not.toHaveBeenCalled() // a stamp must never precede a failed install
  })

  it('returns formatted error when catalog fetch throws', async () => {
    vi.doMock('../../../services/design-system/catalog.js', () => ({
      fetchDesignSystemCatalog: vi.fn().mockRejectedValue(new Error('catalog fetch failed')),
      resolveDesignSystemBaseUrl: () => 'http://x/brand-kits',
    }))
    vi.doMock('../../../services/design-system/install.js', () => ({ installDesignSystem: vi.fn() }))
    vi.doMock('../../../workspace/index.js', () => ({
      createForWorkspace: vi.fn().mockReturnValue(mockWorkspace),
    }))
    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'modern-bento' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string
    expect(out).toContain('Error installing design system')
    expect(out).toContain('catalog')
  })
})
