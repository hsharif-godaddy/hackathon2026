import { describe, expect, it } from 'vitest'

import {
  hexSwatchBorderColor,
  HISTORY_SWATCH_BORDER,
} from './hexSwatchBorder'

describe('hexSwatchBorderColor', function hexSwatchBorderColorTests() {
  it('uses muted border for white fill on white panel', function whiteOnWhite() {
    expect(hexSwatchBorderColor('#ffffff')).toBe(HISTORY_SWATCH_BORDER)
  })

  it('uses muted border for near-white fill on white panel', function nearWhiteOnWhite() {
    expect(hexSwatchBorderColor('#f5f5f5')).toBe(HISTORY_SWATCH_BORDER)
  })

  it('uses muted border for panel-matching light gray', function lightGrayOnWhite() {
    expect(hexSwatchBorderColor('#e8e8e8')).toBe(HISTORY_SWATCH_BORDER)
  })

  it('keeps border transparent for colors with enough contrast', function saturatedColor() {
    expect(hexSwatchBorderColor('#7f42d5')).toBe('transparent')
    expect(hexSwatchBorderColor('#bcc12f')).toBe('transparent')
  })
})
