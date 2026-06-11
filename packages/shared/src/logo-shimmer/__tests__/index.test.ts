import { describe, it, expect } from 'vitest'
import { buildLogoShimmerBackdropSvg, buildLogoShimmerSvg, type ShimmerOrientation } from '../index.js'

const ORIENTATIONS: ShimmerOrientation[] = ['square', 'horizontal', 'vertical']

describe('buildLogoShimmerSvg', () => {
  it('produces a self-contained animated SVG for every orientation', () => {
    for (const o of ORIENTATIONS) {
      const svg = buildLogoShimmerSvg(o, 'p')
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg).toContain('</svg>')
      // embedded CSS animation (not SMIL) + reduced-motion fallback
      expect(svg).toContain('<style>')
      expect(svg).toContain('@keyframes pfg')
      expect(svg).toContain('prefers-reduced-motion')
      // the self-drawing bloom: stroke-dashoffset draw paths
      expect(svg).toContain('stroke-dashoffset')
    }
  })

  it('uses the correct viewBox aspect per orientation', () => {
    expect(buildLogoShimmerSvg('square', 'p')).toContain('viewBox="0 0 240 240"')
    expect(buildLogoShimmerSvg('horizontal', 'p')).toContain('viewBox="0 0 360 150"')
    expect(buildLogoShimmerSvg('vertical', 'p')).toContain('viewBox="0 0 200 280"')
  })

  it('adds a faux wordmark only for horizontal/vertical lockups', () => {
    // wordmark bars reference the text gradient; square has none
    expect(buildLogoShimmerSvg('square', 'p')).not.toContain('url(#ptxt)')
    expect(buildLogoShimmerSvg('horizontal', 'p')).toContain('url(#ptxt)')
    expect(buildLogoShimmerSvg('vertical', 'p')).toContain('url(#ptxt)')
  })

  it('namespaces ids/classes by prefix so instances do not collide', () => {
    const a = buildLogoShimmerSvg('square', 'aaa')
    const b = buildLogoShimmerSvg('square', 'bbb')
    expect(a).toContain('id="aaacp"')
    expect(b).toContain('id="bbbcp"')
    expect(a).not.toContain('bbb')
  })

  it('applies a negative animation-delay only when elapsedMs is given (for re-mount continuity)', () => {
    expect(buildLogoShimmerSvg('square', 'p')).not.toContain('animation-delay')
    expect(buildLogoShimmerSvg('square', 'p', { elapsedMs: 0 })).not.toContain('animation-delay')
    const resumed = buildLogoShimmerSvg('square', 'p', { elapsedMs: 7300 })
    expect(resumed).toContain('animation-delay:-7.300s')
  })

  it('exposes an accessible label by default and hides it when decorative (full)', () => {
    expect(buildLogoShimmerSvg('square', 'p')).toContain('role="img"')
    expect(buildLogoShimmerSvg('square', 'p', { ariaLabel: 'Making logo' })).toContain('aria-label="Making logo"')
    const decorative = buildLogoShimmerSvg('square', 'p', { decorative: true })
    expect(decorative).toContain('aria-hidden="true"')
    expect(decorative).not.toContain('role="img"')
  })

  it('escapes the aria-label so it cannot break out of the attribute', () => {
    const svg = buildLogoShimmerSvg('square', 'p', { ariaLabel: 'Logo "<x>" & co' })
    expect(svg).toContain('aria-label="Logo &quot;&lt;x&gt;&quot; &amp; co"')
    expect(svg).not.toContain('aria-label="Logo "<x>"')
  })
})

describe('buildLogoShimmerBackdropSvg', () => {
  it('emits only the drifting blobs — no bloom, wordmark, ink base, or border', () => {
    const svg = buildLogoShimmerBackdropSvg('p')
    // drifting blobs present
    expect(svg).toContain('@keyframes pb1')
    expect(svg).toContain('url(#pq1)')
    // none of the foreground/backdrop chrome from the full shimmer
    expect(svg).not.toContain('url(#ppetal)') // no bloom
    expect(svg).not.toContain('url(#ptxt)') // no wordmark
    expect(svg).not.toContain('pbase') // no opaque ink base
    expect(svg).not.toContain('stroke-dashoffset') // no self-drawing strokes
  })

  it('is transparent/decorative and stretches to fill (overlay use)', () => {
    const svg = buildLogoShimmerBackdropSvg('p')
    expect(svg).toContain('aria-hidden="true"')
    expect(svg).toContain('preserveAspectRatio="none"')
    expect(svg).not.toContain('role="img"')
  })

  it('honours reduced motion and the re-mount continuity delay', () => {
    const svg = buildLogoShimmerBackdropSvg('p', { elapsedMs: 4200 })
    expect(svg).toContain('prefers-reduced-motion')
    expect(svg).toContain('animation-delay:-4.200s')
  })
})
