import { describe, expect, it } from 'vitest'

import { assembleDesignKitSpec } from '../design-kit-spec.js'
import type { BrandKitTokens } from '../types.js'

describe('assembleDesignKitSpec', () => {
  it('returns a bare spec (only kitId) when nothing else is supplied', () => {
    expect(assembleDesignKitSpec({ kitId: 'k1' })).toEqual({ kitId: 'k1' })
  })

  it('flattens palette roles into a name->hex map and derives colorTokens from its keys', () => {
    const spec = assembleDesignKitSpec({
      kitId: 'k1',
      palette: {
        background: '#fff',
        foreground: '#111',
        primary: '#3b5',
        // undefined roles are skipped, not emitted as keys
        border: undefined,
      },
    })
    expect(spec.palette).toEqual({ background: '#fff', foreground: '#111', primary: '#3b5' })
    expect(spec.colorTokens).toEqual(['background', 'foreground', 'primary'])
  })

  it('merges the palette.tokens map into palette + colorTokens', () => {
    const spec = assembleDesignKitSpec({
      kitId: 'k1',
      palette: { primary: '#3b5', tokens: { ring: '#abc', highlight: '#def' } },
    })
    expect(spec.palette).toEqual({ primary: '#3b5', ring: '#abc', highlight: '#def' })
    expect(spec.colorTokens).toEqual(['primary', 'ring', 'highlight'])
  })

  it('lets an explicit token override a colliding palette role (kit token wins)', () => {
    const spec = assembleDesignKitSpec({
      kitId: 'k1',
      palette: { primary: '#123', tokens: { primary: '#456' } },
    })
    expect(spec.palette).toEqual({ primary: '#456' })
    expect(spec.colorTokens).toEqual(['primary'])
  })

  it('omits palette/colorTokens entirely when the palette has no usable values', () => {
    const spec = assembleDesignKitSpec({ kitId: 'k1', palette: { primary: undefined } })
    expect(spec.palette).toBeUndefined()
    expect(spec.colorTokens).toBeUndefined()
  })

  it('copies typography families/weights (only entries that carry a family)', () => {
    const spec = assembleDesignKitSpec({
      kitId: 'k1',
      typography: {
        display: { family: 'DM Serif', weights: ['400', '700'] },
        body: { family: 'Inter' },
      },
    })
    expect(spec.typography).toEqual({
      display: { family: 'DM Serif', weights: ['400', '700'] },
      body: { family: 'Inter' },
    })
  })

  it('carries radius/flat/uppercase/tracking straight from BrandKitTokens', () => {
    const tokens: BrandKitTokens = {
      radiusBase: 12,
      radiusButton: 4,
      flat: true,
      uppercase: true,
      tracking: '0.12em',
    }
    const spec = assembleDesignKitSpec({ kitId: 'haven', tokens })
    expect(spec).toMatchObject({
      kitId: 'haven',
      radiusBase: 12,
      radiusButton: 4,
      flat: true,
      uppercase: true,
      tracking: '0.12em',
    })
  })

  it('does NOT invent a casing signal when tokens omit uppercase (the ~26 no-signal kits / Aether)', () => {
    const spec = assembleDesignKitSpec({ kitId: 'aether', tokens: { radiusBase: 2 } })
    expect(spec.radiusBase).toBe(2)
    expect(spec.uppercase).toBeUndefined()
    expect('uppercase' in spec).toBe(false)
  })

  it('leaves deferred fields (spacingScale, logoVariantRule) unset — never guessed', () => {
    const spec = assembleDesignKitSpec({
      kitId: 'k1',
      palette: { primary: '#3b5' },
      tokens: { uppercase: true },
    })
    expect(spec.spacingScale).toBeUndefined()
    expect(spec.logoVariantRule).toBeUndefined()
  })

  it('is pure — does not mutate the input palette.tokens or tokens objects', () => {
    const palette = { primary: '#3b5', tokens: { ring: '#abc' } }
    const tokens: BrandKitTokens = { uppercase: true }
    const paletteCopy = structuredClone(palette)
    const tokensCopy = structuredClone(tokens)
    assembleDesignKitSpec({ kitId: 'k1', palette, tokens })
    expect(palette).toEqual(paletteCopy)
    expect(tokens).toEqual(tokensCopy)
  })
})
