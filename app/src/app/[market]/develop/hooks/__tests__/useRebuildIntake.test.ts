import { describe, expect,it } from 'vitest'

import { buildIntakeStylePreferences } from '../useRebuildIntake'

describe('buildIntakeStylePreferences', () => {
  it('maps an all-off choice to fresh enums + false flags', () => {
    expect(
      buildIntakeStylePreferences('modernize', {
        direction: 'modernize',
        keepLogo: false,
        keepImages: false,
        keepColors: false,
        keepFonts: false,
      }),
    ).toEqual({
      designDirection: 'modernize',
      colorPreference: 'suggest-new',
      typographyStyle: 'modern',
      layoutApproach: 'responsive',
      keepLogo: false,
      keepSourceImages: false,
    })
  })

  it('derives logo/image axes from direction when choice is null, keeping colors/fonts original', () => {
    // Flag off / no modal: colors+fonts stay keep-original (pre-PR behavior), but
    // images follow the direction so `modernize` reimagines instead of cloning.
    expect(buildIntakeStylePreferences('modernize', null)).toEqual({
      designDirection: 'modernize',
      colorPreference: 'keep-original',
      typographyStyle: 'keep-original',
      layoutApproach: 'responsive',
      keepLogo: true,
      keepSourceImages: false,
    })
  })

  it('clones imagery on the null-choice fallback for keep-similar', () => {
    expect(buildIntakeStylePreferences('keep-similar', null)).toEqual({
      designDirection: 'keep-similar',
      colorPreference: 'keep-original',
      typographyStyle: 'keep-original',
      layoutApproach: 'responsive',
      keepLogo: true,
      keepSourceImages: true,
    })
  })
})
