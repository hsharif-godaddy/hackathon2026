import { describe, it, expect, vi, beforeEach } from 'vitest'

// The tool is a thin wrapper over installDesignKitForApp: it forwards (appId, slug),
// maps the structured result to a message, and formats thrown errors. Catalog
// resolution and designKit provenance live in the helper (install.ts) and are
// covered by services/design-system/__tests__/install.test.ts.
describe('installDesignSystem tool', () => {
  beforeEach(() => { vi.resetModules() })

  it('returns error when slug not in catalog', async () => {
    vi.doMock('../../../services/design-system/install.js', () => ({
      installDesignKitForApp: vi.fn().mockResolvedValue({ error: 'slug_not_found' }),
    }))
    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'unknown' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string
    expect(out).toMatch(/not found in catalog/i)
  })

  it('installs and returns success message', async () => {
    const installSpy = vi.fn().mockResolvedValue({
      slug: 'modern-bento',
      written: 7,
      message: "Installed design system `modern-bento` (7 files extracted to docs/ui-kit/). Call `loadUiKit` next to read the design system primitives and components.",
    })
    vi.doMock('../../../services/design-system/install.js', () => ({
      installDesignKitForApp: installSpy,
    }))

    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'modern-bento' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string

    expect(installSpy).toHaveBeenCalledWith('a', 'modern-bento')
    expect(out).toContain('modern-bento')
    expect(out).toContain('loadUiKit')
  })

  it('applies the kit in code + locks tokens and tells the model not to re-apply colors (AIROBUILD-2976)', async () => {
    const installSpy = vi.fn().mockResolvedValue({
      slug: 'aether', written: 5, displayName: 'Aether',
      design: { palette: { primary: '#3b5bdb', background: '#ffffff' } },
      message: 'Installed `aether`. Call loadUiKit next.',
    })
    const applySpy = vi.fn().mockResolvedValue({ appliedColors: true, appliedFonts: true })
    const lockSpy = vi.fn()
    vi.doMock('../../../services/design-system/install.js', () => ({ installDesignKitForApp: installSpy }))
    vi.doMock('../../../services/design-system/apply-kit-design.js', () => ({ applyKitDesignTokens: applySpy }))
    vi.doMock('../../../services/design-system/kit-tokens-locked.js', () => ({ lockKitTokens: lockSpy, kitTokensLocked: vi.fn(() => false) }))

    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute(
      { slug: 'aether' },
      { experimental_context: { metadata: { appId: 'a', customerId: 'c' } } } as any,
    ) as string

    expect(applySpy).toHaveBeenCalledWith(expect.objectContaining({ appId: 'a', customerId: 'c' }))
    expect(lockSpy).toHaveBeenCalledWith('a')
    expect(out).toMatch(/locked/i)
    expect(out).toMatch(/do NOT call colorScheme/i)
    expect(out).toContain('loadUiKit')
  })

  it('does NOT lock when the kit applies neither colors nor fonts', async () => {
    const installSpy = vi.fn().mockResolvedValue({
      slug: 'x', written: 3, displayName: 'X', message: 'Installed `x`. Call loadUiKit next.',
    })
    const applySpy = vi.fn().mockResolvedValue({ appliedColors: false, appliedFonts: false })
    const lockSpy = vi.fn()
    vi.doMock('../../../services/design-system/install.js', () => ({ installDesignKitForApp: installSpy }))
    vi.doMock('../../../services/design-system/apply-kit-design.js', () => ({ applyKitDesignTokens: applySpy }))
    vi.doMock('../../../services/design-system/kit-tokens-locked.js', () => ({ lockKitTokens: lockSpy, kitTokensLocked: vi.fn(() => false) }))

    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute(
      { slug: 'x' },
      { experimental_context: { metadata: { appId: 'a' } } } as any,
    ) as string

    expect(lockSpy).not.toHaveBeenCalled()
    expect(out).toContain('loadUiKit')
  })

  it('returns error when appId missing from context', async () => {
    vi.doMock('../../../services/design-system/install.js', () => ({
      installDesignKitForApp: vi.fn(),
    }))
    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'x' }, {} as any) as string
    expect(out).toMatch(/app id/i)
  })

  it('returns error when workspace is unavailable', async () => {
    vi.doMock('../../../services/design-system/install.js', () => ({
      installDesignKitForApp: vi.fn().mockResolvedValue({ error: 'workspace_unavailable' }),
    }))
    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'x' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string
    expect(out).toMatch(/workspace unavailable/i)
  })

  it('returns formatted error when installDesignKitForApp throws', async () => {
    vi.doMock('../../../services/design-system/install.js', () => ({
      installDesignKitForApp: vi.fn().mockRejectedValue(new Error('design-system hash mismatch for modern-bento')),
    }))
    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'modern-bento' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string
    expect(out).toContain('Error installing design system')
    expect(out).toContain('hash mismatch')
    expect(out).toContain('install')
  })

  it('returns formatted error when catalog fetch throws', async () => {
    vi.doMock('../../../services/design-system/install.js', () => ({
      installDesignKitForApp: vi.fn().mockRejectedValue(new Error('catalog fetch failed')),
    }))
    const { installDesignSystemAITool } = await import('../install-design-system.js')
    const out = await installDesignSystemAITool.execute({ slug: 'modern-bento' }, { experimental_context: { metadata: { appId: 'a' } } } as any) as string
    expect(out).toContain('Error installing design system')
    expect(out).toContain('catalog')
  })
})
