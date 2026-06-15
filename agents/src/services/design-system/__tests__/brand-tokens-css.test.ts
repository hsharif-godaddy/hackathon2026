import { describe, it, expect } from 'vitest'
import { buildBrandTokensCss } from '../brand-tokens-css.js'

describe('buildBrandTokensCss', () => {
  it('emits :root HSL color vars and a font @import', () => {
    const css = buildBrandTokensCss(
      { primary: '#3b5bdb', background: '#ffffff', foreground: '#111111' },
      { heading: { family: 'Oswald', weights: ['600', '700'] }, body: { family: 'Inter', weights: ['400'] } },
    )
    // Google Fonts import for both families
    expect(css).toContain("@import url('https://fonts.googleapis.com/css2?family=Oswald")
    expect(css).toContain('family=Inter')
    // HSL conversion (space-separated, no leading #)
    expect(css).toContain('--background: 0 0% 100%;')
    expect(css).toMatch(/--primary: \d+ \d+% \d+%;/)
    // Font vars reference the families
    expect(css).toContain('--font-heading: "Oswald"')
    expect(css).toContain('--font-sans: "Inter"')
  })

  it('omits color vars that are absent', () => {
    const css = buildBrandTokensCss({ primary: '#000000' }, {})
    expect(css).toContain('--primary:')
    expect(css).not.toContain('--secondary:')
  })

  it('converts a mid-saturation hex to the shadcn HSL token format', () => {
    // #3b5bdb -> "228 69% 55%" in the "H S% L%" shadcn format (matches the
    // template preview listener's hexToHsl rounding).
    const css = buildBrandTokensCss({ primary: '#3b5bdb' }, undefined)
    expect(css).toContain('--primary: 228 69% 55%;')
  })

  it('emits pure black/white as 0% saturation', () => {
    const css = buildBrandTokensCss({ background: '#ffffff', foreground: '#000000' }, undefined)
    expect(css).toContain('--background: 0 0% 100%;')
    expect(css).toContain('--foreground: 0 0% 0%;')
  })

  it('maps a single palette key onto every aliased CSS var (primary -> --primary and --ring)', () => {
    const css = buildBrandTokensCss({ primary: '#3b5bdb', border: '#cccccc' }, undefined)
    // primary maps to both --primary and --ring
    expect(css).toContain('--primary:')
    expect(css).toContain('--ring:')
    // border maps to both --border and --input
    expect(css).toContain('--border:')
    expect(css).toContain('--input:')
  })

  it('skips palette values that are not 6-digit hex strings', () => {
    const css = buildBrandTokensCss(
      // primary is a valid hex; the others are invalid shapes that must be omitted
      { primary: '#123456', background: 'rgb(0,0,0)', foreground: '#fff', card: 12345 } as Record<string, unknown>,
      undefined,
    )
    expect(css).toContain('--primary:')
    expect(css).not.toContain('--background:')
    expect(css).not.toContain('--foreground:')
    expect(css).not.toContain('--card:')
  })

  it('accepts hex values without a leading #', () => {
    const css = buildBrandTokensCss({ background: 'ffffff' }, undefined)
    expect(css).toContain('--background: 0 0% 100%;')
  })

  it('omits the @import entirely when no typography families are provided', () => {
    const css = buildBrandTokensCss({ primary: '#000000' }, undefined)
    expect(css).not.toContain('@import')
    expect(css).not.toContain('--font-heading')
    expect(css).not.toContain('--font-sans')
    // :root block still emitted
    expect(css).toContain(':root {')
  })

  it('defaults heading/body font weights when not specified', () => {
    const css = buildBrandTokensCss(undefined, {
      heading: { family: 'Oswald' },
      body: { family: 'Inter' },
    })
    // default heading weights 400;700, default body weight 400
    expect(css).toContain('Oswald:wght@400;700')
    expect(css).toContain('Inter:wght@400')
  })

  it('emits only a heading font var when body family is absent', () => {
    const css = buildBrandTokensCss(undefined, { heading: { family: 'Oswald', weights: ['700'] } })
    expect(css).toContain('--font-heading: "Oswald"')
    expect(css).not.toContain('--font-sans:')
    expect(css).toContain("@import url('https://fonts.googleapis.com/css2?family=Oswald")
  })

  it('produces an empty :root block when both palette and typography are absent', () => {
    const css = buildBrandTokensCss(undefined, undefined)
    expect(css).not.toContain('@import')
    expect(css).toContain(':root {')
    expect(css).toContain('}')
    expect(css).not.toMatch(/--[a-z]/)
  })
})
