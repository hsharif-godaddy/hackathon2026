import { describe, it, expect, vi, beforeEach } from 'vitest'

const ENTRY = {
  slug: 'modern-bento',
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

    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'modern-bento' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string

    expect(installSpy).toHaveBeenCalledWith(expect.objectContaining({ workspace: mockWorkspace }))
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
    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'modern-bento' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string
    expect(out).toContain('Error installing design system')
    expect(out).toContain('hash mismatch')
    expect(out).toContain('install')
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
