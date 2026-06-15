import { describe, expect, it } from 'vitest'

import { extractKitTokens } from '../kit-tokens.js'

describe('extractKitTokens', () => {
  it('parses radius, flatness, casing and tracking from a real-shaped anchor', () => {
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
