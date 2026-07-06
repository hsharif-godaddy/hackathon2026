import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js'

const mockUpdateColors = vi.hoisted(() => vi.fn())
const mockUpdateFonts = vi.hoisted(() => vi.fn())
const mockCreateForWorkspace = vi.hoisted(() => vi.fn())
const mockMemSet = vi.hoisted(() => vi.fn())
const mockSyncBrandTokens = vi.hoisted(() => vi.fn())

vi.mock('../../../tools/css-color-tool.js', () => ({ updateCssColorPalette: mockUpdateColors }))
vi.mock('../../../tools/ai-lib-tools/font-theme.js', () => ({ updateCssFontVariables: mockUpdateFonts }))
vi.mock('../../../workspace/index.js', () => ({ createForWorkspace: mockCreateForWorkspace }))
vi.mock('../../../memory/adapters/index.js', () => ({ getKvMemoryStore: () => ({ set: mockMemSet }) }))
vi.mock('../brand-tokens-css.js', () => ({ syncBrandTokensCss: mockSyncBrandTokens }))

import {
  extractFontFamilyName,
  inferFontCategory,
  mapKitPaletteToColorPalette,
  applyKitDesignTokens,
} from '../apply-kit-design.js'

// Obsidian's real catalog design block (the kit the agent kept ignoring).
const OBSIDIAN_DESIGN = {
  palette: {
    background: '#000000', foreground: '#ffffff', primary: '#ffffff',
    accent: '#ffffff', muted: '#8a8a8a', border: '#000000',
    tokens: { '--void-900': '#000000' },
  },
  typography: {
    display: { family: "'Sora', system-ui, sans-serif", weights: ['700'] },
    body: { family: "'Manrope', system-ui, sans-serif", weights: ['400', '700'] },
  },
}

describe('extractFontFamilyName', () => {
  it('strips quotes and fallbacks', () => {
    expect(extractFontFamilyName("'Sora', system-ui, sans-serif")).toBe('Sora')
    expect(extractFontFamilyName('"JetBrains Mono", ui-monospace, monospace')).toBe('JetBrains Mono')
    expect(extractFontFamilyName('Manrope')).toBe('Manrope')
  })
})

describe('inferFontCategory', () => {
  it('classifies by the generic-family fallback hint', () => {
    expect(inferFontCategory("'Sora', system-ui, sans-serif")).toBe('sans-serif')
    expect(inferFontCategory("'Cormorant Garamond', serif")).toBe('serif')
    expect(inferFontCategory("'JetBrains Mono', ui-monospace, monospace")).toBe('monospace')
    // sans-serif must win even though it contains "serif"
    expect(inferFontCategory("'X', sans-serif")).toBe('sans-serif')
    // no hint → default sans-serif
    expect(inferFontCategory('Manrope')).toBe('sans-serif')
  })
})

describe('mapKitPaletteToColorPalette', () => {
  it('maps named hex fields and drops the tokens bag', () => {
    const mapped = mapKitPaletteToColorPalette(OBSIDIAN_DESIGN.palette)
    expect(mapped).toEqual({
      primary: '#ffffff', background: '#000000', foreground: '#ffffff',
      accent: '#ffffff', muted: '#8a8a8a', border: '#000000',
    })
    expect(mapped).not.toHaveProperty('tokens')
  })

  it('returns undefined when there is no primary to anchor on', () => {
    expect(mapKitPaletteToColorPalette({ background: '#000000' })).toBeUndefined()
  })

  it('passes through mutedForeground when the kit supplies it (AIROBUILD-2976)', () => {
    const mapped = mapKitPaletteToColorPalette({ primary: '#3b5bdb', background: '#ffffff', mutedForeground: '#666666' })
    expect(mapped?.mutedForeground).toBe('#666666')
  })

  it('omits mutedForeground when the kit does not supply it (falls back to derivation)', () => {
    const mapped = mapKitPaletteToColorPalette({ primary: '#3b5bdb', background: '#ffffff' })
    expect(mapped).not.toHaveProperty('mutedForeground')
  })
})

describe('applyKitDesignTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateForWorkspace.mockReturnValue({ workspaceId: 'w', variant: 'preview', files: createStubWorkspaceFiles() })
    mockUpdateColors.mockResolvedValue({ success: true, palette: { primary: '#ffffff', background: '#000000' }, message: 'ok' })
    mockUpdateFonts.mockResolvedValue({ success: true, message: 'ok' })
    mockMemSet.mockResolvedValue({ success: true })
    mockSyncBrandTokens.mockResolvedValue(undefined)
  })

  it('no-ops when the kit has no design block', async () => {
    const res = await applyKitDesignTokens({ appId: 'a', design: undefined, displayName: 'X' })
    expect(res).toEqual({ appliedColors: false, appliedFonts: false })
    expect(mockUpdateColors).not.toHaveBeenCalled()
    expect(mockUpdateFonts).not.toHaveBeenCalled()
  })

  it('applies Obsidian colors + fonts verbatim (dark, Sora/Manrope)', async () => {
    const res = await applyKitDesignTokens({ appId: 'a', design: OBSIDIAN_DESIGN, displayName: 'Obsidian' })

    expect(res).toEqual({ appliedColors: true, appliedFonts: true })
    // colors applied with the kit's dark hexes, not anything domain-derived
    expect(mockUpdateColors).toHaveBeenCalledWith(expect.objectContaining({ view: expect.any(Function) }), expect.objectContaining({ primary: '#ffffff', background: '#000000' }))
    // distinct header/body fonts preserved (the tool path would have collapsed them)
    expect(mockUpdateFonts).toHaveBeenCalledWith(
      expect.objectContaining({ view: expect.any(Function) }),
      { name: 'Sora', weights: ['700'], category: 'sans-serif' },
      { name: 'Manrope', weights: ['400', '700'], category: 'sans-serif' },
    )
    // memory written for the brand-data API + brand-tokens sync
    expect(mockMemSet).toHaveBeenCalledWith(expect.objectContaining({ appId: expect.any(String) }), 'brand.colors.palette', expect.objectContaining({ name: 'Obsidian' }))
    expect(mockMemSet).toHaveBeenCalledWith(expect.objectContaining({ appId: expect.any(String) }), 'brand.typography', expect.objectContaining({
      name: 'Obsidian',
      heading: { family: 'Sora', weights: ['700'] },
      body: { family: 'Manrope', weights: ['400', '700'] },
    }))
    expect(mockSyncBrandTokens).toHaveBeenCalledTimes(1)
  })

  it('reuses the single provided font for both header and body', async () => {
    const oneFont = { typography: { body: { family: "'Manrope', sans-serif", weights: ['400'] } } }
    await applyKitDesignTokens({ appId: 'a', design: oneFont, displayName: 'X' })
    expect(mockUpdateFonts).toHaveBeenCalledWith(
      expect.objectContaining({ view: expect.any(Function) }),
      { name: 'Manrope', weights: ['400'], category: 'sans-serif' },
      { name: 'Manrope', weights: ['400'], category: 'sans-serif' },
    )
  })

  it('does not throw and reports false when workspace is unavailable', async () => {
    mockCreateForWorkspace.mockReturnValue(null)
    const res = await applyKitDesignTokens({ appId: 'a', design: OBSIDIAN_DESIGN, displayName: 'Obsidian' })
    expect(res).toEqual({ appliedColors: false, appliedFonts: false })
  })

  it('still applies fonts when color apply fails (independent best-effort)', async () => {
    mockUpdateColors.mockResolvedValue({ success: false, palette: {}, message: 'bad' })
    const res = await applyKitDesignTokens({ appId: 'a', design: OBSIDIAN_DESIGN, displayName: 'Obsidian' })
    expect(res).toEqual({ appliedColors: false, appliedFonts: true })
    expect(mockSyncBrandTokens).toHaveBeenCalledTimes(1)
  })
})
