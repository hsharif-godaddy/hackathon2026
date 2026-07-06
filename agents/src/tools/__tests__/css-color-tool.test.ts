import { generatePalette, getContrastRatio, getLuminance, updateCssColorPalette } from '../css-color-tool.js'
import { createStubWorkspaceFiles } from '../../workspace/__tests__/test-workspace-files.js'
import { describe, it, expect, vi } from 'vitest'
import type { WorkspaceFiles } from '../../workspace/files.js'

/** Minimal WorkspaceFiles stub for the color writer (only view/write are used). */
function fakeFiles(content: string): WorkspaceFiles {
  return createStubWorkspaceFiles({
    view: vi.fn().mockResolvedValue({ content }),
    readText: vi.fn().mockResolvedValue(content),
    write: vi.fn().mockResolvedValue(undefined),
  })
}

describe('css-color-tool', function packageTests() {
  describe('#generatePalette', function generateTests() {
    it('should generate complete palette from black primary', function generateBlack() {
      const result = generatePalette({ primary: '#000000' })
      
      expect(result.primary).toBe('#000000')
      expect(result.secondary).toBeTypeOf('string')
      expect(result.secondary).not.toBe('#000000')
      expect(result.primaryForeground).toBeTypeOf('string')
      expect(result.secondaryForeground).toBeTypeOf('string')
      expect(result.displayColors).toHaveLength(5)
    })

    it('should generate distinct secondary from dark primary', function generateDark() {
      const result = generatePalette({ primary: '#1a1a1a' })
      
      expect(result.secondary).not.toBe(result.primary)
      expect(result.secondary).not.toBe('#1a1a1a')
    })

    it('should include foreground colors for all display colors', function generateForegrounds() {
      const result = generatePalette({ primary: '#3B82F6' })
      
      expect(result.primaryForeground).toBeTypeOf('string')
      expect(result.secondaryForeground).toBeTypeOf('string')
      expect(result.accentForeground).toBeTypeOf('string')
      expect(result.mutedForeground).toBeTypeOf('string')
      expect(result.successForeground).toBeTypeOf('string')
      expect(result.destructiveForeground).toBeTypeOf('string')
    })

    it('should generate proper contrast for dark colors', function generateContrast() {
      const result = generatePalette({ primary: '#1a1a1a' })
      
      expect(result.primaryForeground).toBeTypeOf('string')
      expect(result.primaryForeground).not.toBe('#000000')
      expect(result.primaryForeground).not.toBe('#1a1a1a')
    })

    it('should use default background and foreground', function generateDefaults() {
      const result = generatePalette({ primary: '#3B82F6' })
      
      expect(result.background).toBe('#FFFFFF')
      expect(result.foreground).toBe('#0A0A0A')
    })

    it('should respect provided secondary and accent colors', function generateProvided() {
      const result = generatePalette({
        primary: '#3B82F6',
        secondary: '#10B981',
        accent: '#F59E0B'
      })
      
      expect(result.primary).toBe('#3B82F6')
      expect(result.secondary).toBe('#10B981')
      expect(result.accent).toBe('#F59E0B')
    })

    it('should generate semantic colors by default', function generateSemantic() {
      const result = generatePalette({ primary: '#3B82F6' })
      
      expect(result.destructive).toBe('#EF4444')
      expect(result.success).toBe('#10B981')
      expect(result.warning).toBe('#F59E0B')
    })

    it('should include all required display colors', function generateDisplay() {
      const result = generatePalette({ primary: '#3B82F6' })
      
      expect(result.displayColors).toHaveLength(5)

      const colorNames = result.displayColors.map(function mapName(c) { return c.name })
      expect(colorNames).toContain('Base')
      expect(colorNames).toContain('Primary')
      expect(colorNames).toContain('Secondary')
      expect(colorNames).toContain('Accent')
      expect(colorNames).toContain('Muted')
    })

    it('should include hex and role for each display color', function generateMetadata() {
      const result = generatePalette({ primary: '#3B82F6' })
      
      result.displayColors.forEach(function checkColor(color) {
        expect(color.name).toBeTypeOf('string')
        expect(color.hex).toBeTypeOf('string')
        expect(color.hex).toMatch(/^#[0-9A-Fa-f]{6}$/)
        expect(color.role).toBeTypeOf('string')
      })
    })
  })
})

// AIROBUILD-2976 — the color-contrast fix. generatePalette must be deterministic
// (no Math.random) and derive low-emphasis text that meets WCAG AA against the
// surface it actually renders on (background/card), not against the muted fill.
describe('css-color-tool — AIROBUILD-2976 determinism', function determinismTests() {
  it('generates identical muted + border across 10 calls (light theme)', function lightDeterminism() {
    const input = { primary: '#3B82F6', background: '#FFFFFF' }
    const muteds = new Set(Array.from({ length: 10 }, () => generatePalette(input).muted))
    const borders = new Set(Array.from({ length: 10 }, () => generatePalette(input).border))
    expect(muteds.size).toBe(1)
    expect(borders.size).toBe(1)
  })

  it('generates identical muted + border across 10 calls (dark theme)', function darkDeterminism() {
    const input = { primary: '#3B82F6', background: '#0A0A0A' }
    const muteds = new Set(Array.from({ length: 10 }, () => generatePalette(input).muted))
    const borders = new Set(Array.from({ length: 10 }, () => generatePalette(input).border))
    expect(muteds.size).toBe(1)
    expect(borders.size).toBe(1)
  })

  it('generates identical chart colors across calls', function chartDeterminism() {
    const input = { primary: '#9333EA', background: '#FFFFFF' }
    const a = generatePalette(input)
    const b = generatePalette(input)
    expect([a.chart1, a.chart2, a.chart3, a.chart4, a.chart5])
      .toEqual([b.chart1, b.chart2, b.chart3, b.chart4, b.chart5])
  })
})

describe('css-color-tool — AIROBUILD-2976 mutedForeground contrast', function contrastTests() {
  it('mutedForeground meets AA (>=4.5) vs background on a white page', function vsBackground() {
    const r = generatePalette({ primary: '#3B82F6', background: '#FFFFFF' })
    expect(getContrastRatio(r.mutedForeground, r.background)).toBeGreaterThanOrEqual(4.5)
  })

  it('mutedForeground meets AA vs card when card differs from background', function vsCard() {
    const r = generatePalette({ primary: '#3B82F6', background: '#FFFFFF', card: '#F0F0F0' })
    expect(getContrastRatio(r.mutedForeground, r.card)).toBeGreaterThanOrEqual(4.5)
  })

  it('mutedForeground meets AA vs the DARKER of background/card (worst case)', function vsDarker() {
    const r = generatePalette({ primary: '#3B82F6', background: '#FFFFFF', card: '#E0E0E0' })
    const darker = getLuminance(r.background) <= getLuminance(r.card) ? r.background : r.card
    expect(getContrastRatio(r.mutedForeground, darker)).toBeGreaterThanOrEqual(4.5)
  })

  it('mutedForeground meets AA on a dark theme', function darkTheme() {
    const r = generatePalette({ primary: '#3B82F6', background: '#0A0A0A' })
    expect(getContrastRatio(r.mutedForeground, r.background)).toBeGreaterThanOrEqual(4.5)
  })

  it('mutedForeground meets AA vs the LIGHTER of background/card on a dark theme (worst case)', function darkVsLighter() {
    const r = generatePalette({ primary: '#3B82F6', background: '#0A0A0A', card: '#2A2A2A' })
    expect(getContrastRatio(r.mutedForeground, r.background)).toBeGreaterThanOrEqual(4.5)
    expect(getContrastRatio(r.mutedForeground, r.card)).toBeGreaterThanOrEqual(4.5)
  })

  it('respects an explicit mutedForeground (kit source of truth)', function explicit() {
    const r = generatePalette({ primary: '#3B82F6', background: '#FFFFFF', mutedForeground: '#777777' })
    expect(r.mutedForeground).toBe('#777777')
  })

  it('keeps muted (fill) distinct from mutedForeground (text)', function distinct() {
    const r = generatePalette({ primary: '#3B82F6', background: '#FFFFFF' })
    expect(r.muted).not.toBe(r.mutedForeground)
  })
})

describe('css-color-tool — AIROBUILD-2976 contrast edge cases', function edgeTests() {
  it('low-saturation/grey primary still yields AA muted text', function greyPrimary() {
    const r = generatePalette({ primary: '#808080', background: '#FFFFFF' })
    expect(getContrastRatio(r.mutedForeground, r.background)).toBeGreaterThanOrEqual(4.5)
  })

  it('pure-black background yields AA muted text', function blackBg() {
    const r = generatePalette({ primary: '#FF0000', background: '#000000' })
    expect(getContrastRatio(r.mutedForeground, r.background)).toBeGreaterThanOrEqual(4.5)
  })

  it('derives an AA muted text when the kit omits muted', function omitMuted() {
    const r = generatePalette({ primary: '#3B82F6', background: '#FFFFFF' })
    expect(r.muted).toBeTypeOf('string')
    expect(getContrastRatio(r.mutedForeground, r.background)).toBeGreaterThanOrEqual(4.5)
  })
})

// AIROBUILD-2976 — "show me more color schemes" use case. colorScheme `suggest`
// mode runs every LLM-proposed {primary, background} through generatePalette
// before showing the grid, so this is the EXACT derivation the customer is offered
// to pick from. Every suggested scheme must yield AA-safe muted text on its own
// surfaces (background AND card), the set must stay varied, and each scheme must
// render identically on repeat (no more Math.random()).
describe('css-color-tool — AIROBUILD-2976 suggested color schemes are AA-safe', function suggestMode() {
  const suggested: Array<{ name: string; primary: string; background: string; card?: string }> = [
    { name: 'Vibrant Purple Light', primary: '#7C3AED', background: '#FFFFFF' },
    { name: 'Deep Ocean Dark', primary: '#0EA5E9', background: '#0A0A0A', card: '#1F2937' },
    { name: 'Forest Calm Light', primary: '#16A34A', background: '#F8FAF8' },
    { name: 'Sunset Coral Light', primary: '#F97316', background: '#FFFDF8' },
    { name: 'Midnight Indigo Dark', primary: '#6366F1', background: '#0B1020', card: '#222B45' },
    { name: 'Rose Boutique Light', primary: '#E11D48', background: '#FFFFFF' },
    { name: 'Slate Pro Light', primary: '#334155', background: '#F5F6F8' },
    { name: 'Gold Luxe Dark', primary: '#D4AF37', background: '#111111', card: '#2A2A2A' },
    { name: 'Teal Minimal Light', primary: '#0D9488', background: '#FFFFFF' },
    { name: 'Crimson Bold Light', primary: '#DC2626', background: '#FAFAFA' },
  ]

  for (const opt of suggested) {
    it(`${opt.name}: muted text meets AA on background and card`, function aaSafe() {
      const r = generatePalette({ primary: opt.primary, background: opt.background, ...(opt.card ? { card: opt.card } : {}) })
      expect(getContrastRatio(r.mutedForeground, r.background)).toBeGreaterThanOrEqual(4.5)
      expect(getContrastRatio(r.mutedForeground, r.card)).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('offers a varied set — distinct muted fills across all suggested palettes', function variety() {
    const muteds = new Set(suggested.map((o) => generatePalette({ primary: o.primary, background: o.background }).muted))
    expect(muteds.size).toBe(suggested.length)
  })

  // Joshua's concern: removing Math.random() must NOT collapse same-hue-family
  // options into duplicates. Asking for several "green primary" options (distinct
  // shades) must still yield distinct palettes — variety comes from the primary
  // the model varies per option, not from the (now-deterministic) muted/border.
  it('returns distinct palettes for several options in one hue family (e.g. greens)', function sameHueFamily() {
    const greens: string[] = ['#10B981', '#166534', '#65A30D', '#059669', '#4ADE80', '#15803D']
    const palettes = greens.map((primary) => JSON.stringify(generatePalette({ primary, background: '#FFFFFF' })))
    expect(new Set(palettes).size).toBe(greens.length)
  })

  it('renders each suggested scheme identically on repeat (deterministic, no Math.random)', function deterministic() {
    for (const opt of suggested) {
      const a = generatePalette({ primary: opt.primary, background: opt.background, ...(opt.card ? { card: opt.card } : {}) })
      const b = generatePalette({ primary: opt.primary, background: opt.background, ...(opt.card ? { card: opt.card } : {}) })
      expect(a).toEqual(b)
    }
  })
})

describe('css-color-tool — AIROBUILD-2075 colour-write hardening', function hardeningTests() {
  it('accepts 3-digit shorthand hex without throwing', function shorthandHex() {
    // The old 6-digit-only hexToRgb threw on `#abc`, which upstream blanked the palette.
    const result = generatePalette({ primary: '#abc' })
    expect(result.primary).toBe('#abc')
    expect(result.chart1).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('updateCssColorPalette fills a "complete" palette that is missing fields', async function fillsGaps() {
    // primaryForeground + theme flip isCompletePalette true, but charts/foregrounds are
    // absent — the old shortcut passed this straight to the writer and threw on undefined.
    const partialComplete = {
      primary: '#3b5bdb', background: '#ffffff', primaryForeground: '#ffffff', theme: 'light',
    } as unknown as Parameters<typeof updateCssColorPalette>[1]
    const result = await updateCssColorPalette(fakeFiles(':root{--primary: 0 0% 0%;}'), partialComplete)
    expect(result.success).toBe(true)
    expect(result.palette.chart1).toMatch(/^#[0-9a-f]{6}$/i)
    expect(result.palette.cardForeground).toBeTypeOf('string')
  })

  it('updateCssColors skips an invalid hex var instead of throwing the whole write', async function skipsInvalid() {
    const withBadBorder = {
      primary: '#3b5bdb', background: '#ffffff', primaryForeground: '#ffffff', theme: 'light', border: 'var(--unresolved-token)',
    } as unknown as Parameters<typeof updateCssColorPalette>[1]
    const result = await updateCssColorPalette(fakeFiles(':root{--primary: 0 0% 0%;--border: 0 0% 0%;}'), withBadBorder)
    expect(result.success).toBe(true)
  })
})

