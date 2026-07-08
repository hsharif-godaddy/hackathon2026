import { describe, expect, it } from 'vitest'

import { coerceScrollGutterPaddingBottom } from './commanderMobileScroll'

describe('commanderMobileScroll', function commanderMobileScrollTests() {
  describe('#coerceScrollGutterPaddingBottom', function coerceTests() {
    it('returns the number when value is numeric', function numeric() {
      expect(coerceScrollGutterPaddingBottom(112)).toBe(112)
      expect(coerceScrollGutterPaddingBottom(0)).toBe(0)
    })

    it('returns 0 for non-numeric values', function nonNumeric() {
      expect(coerceScrollGutterPaddingBottom(undefined)).toBe(0)
      expect(coerceScrollGutterPaddingBottom('112')).toBe(0)
      expect(coerceScrollGutterPaddingBottom(null)).toBe(0)
    })
  })
})
