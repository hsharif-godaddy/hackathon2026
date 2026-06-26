import { describe, it, expect } from 'vitest'
import { buildBrandTokensCss } from '../brand-tokens-css.js'
import { extractKitTokens } from '../kit-tokens.js'

/**
 * AIROBUILD-2976 reproduction + fix characterization (deterministic, no LLM/browser).
 *
 * Real data from the live catalog kit "Aether"
 * (https://blobby.wsimg.com/brand-kits/catalog.json + its tarball anchor.json).
 *
 * The kit ships a complete token system (radius / spacing / type scale / label
 * casing) in anchor.json. `buildBrandTokensCss` is the color/font carrier and emits
 * only colors + font-family vars. RADIUS is now applied separately to
 * src/styles/globals.css via `updateCssRadius` (radius-css.ts) — the AIROBUILD-2976
 * fix (guarded by radius-css.test.ts). SPACING and the type scale remain unapplied
 * and are tracked as a separate follow-up.
 */

// --- The catalog `design` palette fed to applyKitDesignTokens (colors) ---
const AETHER_PALETTE = {
  background: '#dfe4e6', foreground: '#0f0f10', primary: '#1f3fc4',
  accent: '#1f3fc4', muted: '#8a9095', border: '#c5cbce',
  tokens: { '--canvas': '#dfe4e6', '--ink-primary': '#0f0f10' },
}

// --- The memory `brand.typography` shape syncBrandTokensCss feeds buildBrandTokensCss
//     (applyKitDesignTokens normalizes the catalog display/body → heading/body). ---
const AETHER_TYPOGRAPHY = {
  heading: { family: 'Inter Tight', weights: ['400', '500'] },
  body: { family: 'Inter Tight', weights: ['400'] },
}

// --- The kit's anchor.json (the rich token system that is NOT applied) ---
const AETHER_ANCHOR = {
  radius: { sm: 12, base: 18, card: 28, scene: 36, pill: 9999 },
  spacing: {
    scale: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160, 200],
    sectionDesktop: 160, sectionMobile: 80, gutterDesktop: 16,
  },
  typography: { scale: { labelCase: 'lowercase' } },
}

describe('AIROBUILD-2976 — design-kit CSS fidelity (radius fixed; spacing pending)', () => {
  const css = buildBrandTokensCss(AETHER_PALETTE, AETHER_TYPOGRAPHY)

  it('DOES apply color vars deterministically', () => {
    expect(css).toContain('--primary:')
    expect(css).toContain('--background:')
    expect(css).toContain('--foreground:')
  })

  it('DOES apply font-family vars deterministically', () => {
    expect(css).toContain('--font-heading:')
    expect(css).toContain('--font-sans:')
    expect(css).toContain('Inter Tight')
  })

  it('radius is NOT in brand-tokens.css — it is applied to globals.css via updateCssRadius (the fix)', () => {
    // brand-tokens.css stays the color/font carrier; the kit's radius now reaches
    // the app through updateCssRadius writing --radius in globals.css (radius-css.ts,
    // guarded by radius-css.test.ts). So brand-tokens.css legitimately carries none.
    expect(css).not.toContain('--radius')
  })

  it('GAP (still open, separate PR): spacing tokens never reach the generated CSS', () => {
    expect(css).not.toContain('--space')
    expect(css).not.toContain('--gutter')
  })

  it('GAP: type scale / tracking / leading never reach the generated CSS', () => {
    expect(css).not.toContain('--size-')
    expect(css).not.toContain('--tracking-')
    expect(css).not.toContain('--leading-')
  })

  it('extractKitTokens reads the kit radius (now consumed by updateCssRadius → --radius)', () => {
    const tokens = extractKitTokens(AETHER_ANCHOR)
    expect(tokens).toBeDefined()
    expect(tokens!.radiusBase).toBe(18)
  })

  it('EVIDENCE: kit spec wants lowercase labels, but no code enforces it (LLM emits all-caps eyebrows)', () => {
    expect(AETHER_ANCHOR.typography.scale.labelCase).toBe('lowercase')
    // nothing in the generated CSS encodes label casing:
    expect(css).not.toContain('lowercase')
    expect(css).not.toContain('text-transform')
  })
})
