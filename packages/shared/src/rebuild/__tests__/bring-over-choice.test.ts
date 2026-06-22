import { describe, it, expect } from 'vitest'
import {
  presetForDirection,
  bringOverToStylePreferences,
  isRebuildBringOverChoice,
  type RebuildBringOverChoice,
} from '../bring-over-choice.js'

describe('presetForDirection', () => {
  it('keep-similar preset is all-on', () => {
    expect(presetForDirection('keep-similar')).toEqual({
      direction: 'keep-similar',
      keepLogo: true,
      keepImages: true,
      keepColors: true,
      keepFonts: true,
    })
  })

  it('modernize preset keeps the logo, drops images/colors/fonts', () => {
    expect(presetForDirection('modernize')).toEqual({
      direction: 'modernize',
      keepLogo: true,
      keepImages: false,
      keepColors: false,
      keepFonts: false,
    })
  })
})

describe('bringOverToStylePreferences', () => {
  it('maps keep toggles to keep-original enums and true flags', () => {
    const choice: RebuildBringOverChoice = {
      direction: 'keep-similar',
      keepLogo: true,
      keepImages: true,
      keepColors: true,
      keepFonts: true,
    }
    expect(bringOverToStylePreferences(choice)).toEqual({
      keepLogo: true,
      keepSourceImages: true,
      colorPreference: 'keep-original',
      typographyStyle: 'keep-original',
    })
  })

  it('maps off toggles to fresh enums and false flags', () => {
    const choice: RebuildBringOverChoice = {
      direction: 'modernize',
      keepLogo: false,
      keepImages: false,
      keepColors: false,
      keepFonts: false,
    }
    expect(bringOverToStylePreferences(choice)).toEqual({
      keepLogo: false,
      keepSourceImages: false,
      colorPreference: 'suggest-new',
      typographyStyle: 'modern',
    })
  })

  it('respects a single overridden toggle (Reimagine but keep colors)', () => {
    const choice: RebuildBringOverChoice = {
      direction: 'modernize',
      keepLogo: false,
      keepImages: false,
      keepColors: true,
      keepFonts: false,
    }
    expect(bringOverToStylePreferences(choice).colorPreference).toBe('keep-original')
    expect(bringOverToStylePreferences(choice).typographyStyle).toBe('modern')
  })
})

describe('isRebuildBringOverChoice', () => {
  it('returns false for null', () => {
    expect(isRebuildBringOverChoice(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isRebuildBringOverChoice(undefined)).toBe(false)
  })

  it('returns false for an empty object', () => {
    expect(isRebuildBringOverChoice({})).toBe(false)
  })

  it('returns false when all boolean fields are missing', () => {
    expect(isRebuildBringOverChoice({ direction: 'modernize' })).toBe(false)
  })

  it('returns false for a bogus direction even when all boolean fields are present', () => {
    expect(
      isRebuildBringOverChoice({
        direction: 'bogus',
        keepLogo: true,
        keepImages: true,
        keepColors: true,
        keepFonts: true,
      }),
    ).toBe(false)
  })

  it('returns true for a fully valid object', () => {
    expect(
      isRebuildBringOverChoice({
        direction: 'keep-similar',
        keepLogo: true,
        keepImages: true,
        keepColors: true,
        keepFonts: true,
      }),
    ).toBe(true)
  })

  it('returns false when a boolean field is the string "true" (type coercion guard)', () => {
    expect(
      isRebuildBringOverChoice({
        direction: 'modernize',
        keepLogo: 'true',
        keepImages: false,
        keepColors: false,
        keepFonts: false,
      }),
    ).toBe(false)
  })
})
