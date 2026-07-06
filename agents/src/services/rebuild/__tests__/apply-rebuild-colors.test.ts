import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyRebuildColors } from '../apply-rebuild-colors.js'
import { generatePalette, updateCssColors } from '../../../tools/css-color-tool.js'
import { createForWorkspace } from '../../../workspace/index.js'
import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js'

const { kitTokensLockedMock } = vi.hoisted(() => ({ kitTokensLockedMock: vi.fn(() => false) }))

vi.mock('../../../tools/css-color-tool.js', () => ({
  generatePalette: vi.fn(() => ({})),
  updateCssColors: vi.fn(async () => undefined),
}))

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}))

vi.mock('../../design-system/kit-tokens-locked.js', () => ({ kitTokensLocked: kitTokensLockedMock }))

function metadataWith(primary: string[]) {
  return { colorPalette: { primary, secondary: [], accent: [] } } as any
}

describe('applyRebuildColors', () => {
  beforeEach(() => {
    vi.mocked(createForWorkspace).mockReturnValue({ files: createStubWorkspaceFiles() } as any)
    vi.mocked(updateCssColors).mockResolvedValue(undefined)
    kitTokensLockedMock.mockReturnValue(false)
  })

  it('skips when colorPreference is not keep-original', async () => {
    const res = await applyRebuildColors('app123', metadataWith(['#123456']), { colorPreference: 'suggest-new' } as any, true)
    expect(res.applied).toBe(false)
  })
  it('skips when no source palette exists', async () => {
    const res = await applyRebuildColors('app123', metadataWith([]), { colorPreference: 'keep-original' } as any, true)
    expect(res.applied).toBe(false)
  })
  it('applies when keep-original and a palette exists', async () => {
    const res = await applyRebuildColors('app123', metadataWith(['#123456']), { colorPreference: 'keep-original' } as any, true)
    expect(res.applied).toBe(true)
    expect(vi.mocked(updateCssColors)).toHaveBeenCalled()
  })
  it('resolves to { applied: false } when updateCssColors throws', async () => {
    vi.mocked(updateCssColors).mockRejectedValueOnce(new Error('write failed'))
    const res = await applyRebuildColors('app123', metadataWith(['#123456']), { colorPreference: 'keep-original' } as any, true)
    expect(res.applied).toBe(false)
  })
  it('resolves to { applied: false } when workspace is unavailable, without calling updateCssColors', async () => {
    vi.mocked(createForWorkspace).mockReturnValueOnce(null as any)
    const res = await applyRebuildColors('app1', metadataWith(['#abcdef']), { colorPreference: 'keep-original' } as any, true)
    expect(res.applied).toBe(false)
    expect(vi.mocked(updateCssColors)).not.toHaveBeenCalled()
  })
  it('skips when isFirstPage is false, even with keep-original and a palette', async () => {
    const res = await applyRebuildColors('app123', metadataWith(['#123456']), { colorPreference: 'keep-original' } as any, false)
    expect(res.applied).toBe(false)
    expect(vi.mocked(updateCssColors)).not.toHaveBeenCalled()
  })
  it('skips (no-op) when the kit palette is locked, without re-deriving (AIROBUILD-2976)', async () => {
    kitTokensLockedMock.mockReturnValue(true)
    const res = await applyRebuildColors('app123', metadataWith(['#123456']), { colorPreference: 'keep-original' } as any, true)
    expect(res.applied).toBe(false)
    expect(vi.mocked(generatePalette)).not.toHaveBeenCalled()
    expect(vi.mocked(updateCssColors)).not.toHaveBeenCalled()
  })
})
