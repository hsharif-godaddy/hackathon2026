import { describe, expect, it } from 'vitest'

import { extractKitTokens } from '../kit-tokens.js'

describe('extractKitTokens', () => {
  it('parses radius, flatness, casing and tracking from a legacy anchor (radius.subtle + prose)', () => {
    const anchor = {
      radius: { base: 0, subtle: 2, philosophy: 'Zero is the governing value…' },
      shadow: { rest: 'none', philosophy: 'Flatness is the default…' },
      buttons: {
        primary: 'Coral fill (#FF6B4A) with burgundy-900 text. DM Sans 700, UPPERCASE, 0.12em tracking. 14px padding vertical, 40px horizontal. 2px radius.',
      },
    }
    expect(extractKitTokens(anchor)).toEqual({
      radiusBase: 0,
      radiusButton: 2,
      flat: true,
      uppercase: true,
      tracking: '0.12em',
    })
  })

  it('prefers a schema-enforced numeric radius.button over shape/prose (Mosaic contract)', () => {
    // Future Mosaic contract: a numeric radius.button wins over any free-form
    // shape/prose (which may be stale or absent).
    const anchor = {
      radius: { base: 18, pill: 9999, button: 0 },
      components: { buttonPrimary: { shape: 'pill' } },
    }
    expect(extractKitTokens(anchor)).toMatchObject({ radiusBase: 18, radiusButton: 0 })
  })

  it('derives the button radius from components.buttonPrimary.shape against the radius scale (real anchor)', () => {
    // Real Mosaic anchors (e.g. Aether) have NO radius.subtle; the button radius
    // is the primary button's shape resolved against the scale — pill => 9999px.
    const anchor = {
      radius: { sm: 12, base: 18, card: 28, scene: 36, pill: 9999 },
      components: { buttonPrimary: { shape: 'pill', fill: '#1f3fc4' } },
    }
    expect(extractKitTokens(anchor)).toMatchObject({ radiusBase: 18, radiusButton: 9999 })
  })

  it('resolves sharp => 0, rounded => base, subtle => sm', () => {
    expect(extractKitTokens({ radius: { base: 18, pill: 9999 }, components: { buttonPrimary: { shape: 'sharp' } } }))
      .toMatchObject({ radiusButton: 0 })
    expect(extractKitTokens({ radius: { sm: 8, base: 18 }, components: { buttonPrimary: { shape: 'rounded' } } }))
      .toMatchObject({ radiusButton: 18 })
    expect(extractKitTokens({ radius: { sm: 8, base: 18 }, components: { buttonPrimary: { shape: 'subtle' } } }))
      .toMatchObject({ radiusButton: 8 })
  })

  it('prefers the shape over a legacy numeric radius.subtle when both exist', () => {
    const tokens = extractKitTokens({
      radius: { base: 18, pill: 9999, subtle: 4 },
      components: { buttonPrimary: { shape: 'pill' } },
    })
    expect(tokens).toMatchObject({ radiusButton: 9999 }) // shape wins, not subtle=4
  })

  it('falls back to legacy radius.subtle when the shape is unknown', () => {
    expect(extractKitTokens({ radius: { base: 18, subtle: 4 }, components: { buttonPrimary: { shape: 'weird-shape' } } }))
      .toMatchObject({ radiusButton: 4 })
  })

  it('reads button radius from prose in components.button (Pulse-style: no shape field)', () => {
    const anchor = {
      radius: { base: 28, card: 32, pill: 9999 },
      components: { button: 'Pill-shaped primary CTA. Radius 9999px. Bold label.' },
    }
    expect(extractKitTokens(anchor)).toMatchObject({ radiusBase: 28, radiusButton: 9999 })
  })

  it('reads an explicit px radius from button prose (px beats the rounded keyword)', () => {
    expect(extractKitTokens({ radius: { base: 12 }, components: { button: 'Soft rounded button, 8px radius.' } }))
      .toMatchObject({ radiusButton: 8 })
  })

  it('reads sharp/square button prose as 0 (string button node)', () => {
    expect(extractKitTokens({ radius: { base: 0, pill: 9999 }, components: { buttonPrimary: 'Sharp, square-edged buttons.' } }))
      .toMatchObject({ radiusButton: 0 })
  })

  it('reads the button node under the plural `components.buttons` key (Terra-style)', () => {
    const anchor = {
      radius: { base: 32, large: 48, pill: 9999 },
      components: { buttons: { style: 'soft pill and blob buttons', rules: ['tactile, rounded'] } },
    }
    expect(extractKitTokens(anchor)).toMatchObject({ radiusButton: 9999 })
  })

  it('leaves radiusButton undefined when the anchor states no button radius (Obsidian-style)', () => {
    const tokens = extractKitTokens({ radius: { base: 0, pill: 9999 }, components: {}, guidance: 'Minimal dark UI.' })
    expect(tokens?.radiusBase).toBe(0)
    expect(tokens?.radiusButton).toBeUndefined()
  })

  it('marks non-"none" resting shadows as not flat', () => {
    const tokens = extractKitTokens({ radius: { base: 8 }, shadow: { rest: '0 4px 12px rgba(0,0,0,0.1)' } })
    expect(tokens).toMatchObject({ radiusBase: 8, flat: false })
  })

  it('falls back to a prose px radius when radius.subtle is absent', () => {
    const tokens = extractKitTokens({ buttons: { primary: 'Rounded fill with 6px radius and lowercase labels.' } })
    expect(tokens).toMatchObject({ radiusButton: 6 })
    expect(tokens?.uppercase).toBeUndefined()
  })

  it('returns undefined for unusable input', () => {
    expect(extractKitTokens(null)).toBeUndefined()
    expect(extractKitTokens('nope')).toBeUndefined()
    expect(extractKitTokens({})).toBeUndefined()
    expect(extractKitTokens({ radius: { philosophy: 'words only' } })).toBeUndefined()
  })
})
