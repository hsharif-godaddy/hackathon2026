import { describe, expect, it } from 'vitest'

import { maxNaturalTipHeightsPx, verticalLazyInnerFloorPx } from '@/app/[market]/develop/components/tips/tips-stack-measures'

describe('tips-stack-measures', () => {
  describe('#verticalLazyInnerFloorPx', () => {
    it('returns 0 when the visible window is empty', () => {
      expect(verticalLazyInnerFloorPx([], { a: 10 }, null)).toBe(0)
    })

    it('uses only the front natural height when not exiting', () => {
      expect(verticalLazyInnerFloorPx(['a', 'b'], { a: 40, b: 99 }, null)).toBe(40)
    })

    it('uses the max of outgoing and next-up natural heights while exiting', () => {
      expect(verticalLazyInnerFloorPx(['a', 'b'], { a: 40, b: 120 }, 'a')).toBe(120)
      expect(verticalLazyInnerFloorPx(['a', 'b'], { a: 130, b: 40 }, 'a')).toBe(130)
    })

    it('treats missing natural heights as 0', () => {
      expect(verticalLazyInnerFloorPx(['a', 'b'], {}, 'a')).toBe(0)
    })
  })

  describe('#maxNaturalTipHeightsPx', () => {
    it('returns 0 for an empty tip list', () => {
      expect(maxNaturalTipHeightsPx([], { a: 10 })).toBe(0)
    })

    it('returns the largest natural height among the given tip ids', () => {
      expect(
        maxNaturalTipHeightsPx(['x', 'y', 'z'], { x: 12, y: 50, z: 30 }),
      ).toBe(50)
    })

    it('treats missing ids as 0', () => {
      expect(maxNaturalTipHeightsPx(['x', 'y'], { x: 25 })).toBe(25)
    })
  })
})
