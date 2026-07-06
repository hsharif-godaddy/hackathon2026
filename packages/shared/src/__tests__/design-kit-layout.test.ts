import { describe, expect, it } from 'vitest'

import {
  DESIGN_KIT_BUILD_CANVAS_ID,
  designKitLayoutForPhase,
  isDesignKitBuildCanvas,
} from '../design-kit-layout.js'

describe('isDesignKitBuildCanvas', () => {
  it('accepts only the design-kit-build canvas', () => {
    expect(isDesignKitBuildCanvas(DESIGN_KIT_BUILD_CANVAS_ID)).toBe(true)
    expect(isDesignKitBuildCanvas('something-else')).toBe(false)
    expect(isDesignKitBuildCanvas(undefined)).toBe(false)
  })
})

describe('designKitLayoutForPhase', () => {
  it('returns the neutral default layout for a non-design-kit app', () => {
    expect(designKitLayoutForPhase(false, 'brand')).toEqual({ version: 1, layout: 'default' })
  })

  it('returns the neutral default layout for a finished design-kit app (ready)', () => {
    expect(designKitLayoutForPhase(true, 'ready')).toEqual({ version: 1, layout: 'default' })
  })

  it('pins the design-kit-build surface for the brand phase', () => {
    expect(designKitLayoutForPhase(true, 'brand')).toEqual({
      version: 1,
      layout: 'immersive',
      pinnedSurface: { canvasId: DESIGN_KIT_BUILD_CANVAS_ID },
    })
  })

  it('pins the design-kit-build surface for the website phase', () => {
    expect(designKitLayoutForPhase(true, 'website')).toEqual({
      version: 1,
      layout: 'immersive',
      pinnedSurface: { canvasId: DESIGN_KIT_BUILD_CANVAS_ID },
    })
  })

  it('returns immersive without a surface for the gathering phase', () => {
    expect(designKitLayoutForPhase(true, 'gathering')).toEqual({ version: 1, layout: 'immersive' })
  })

  it('returns immersive without a surface when a design-kit app has no phase yet', () => {
    expect(designKitLayoutForPhase(true, undefined)).toEqual({ version: 1, layout: 'immersive' })
  })

  it('never emits commander or develop', () => {
    const result = designKitLayoutForPhase(true, 'gathering')
    expect(result.layout === 'commander' || result.layout === 'develop').toBe(false)
  })
})
