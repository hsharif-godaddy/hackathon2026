import { describe, expect, it } from 'vitest'

import {
  BUILDER_LAYOUT_VERSION,
  DEFAULT_BUILDER_LAYOUT,
  builderLayoutVariant,
  normalizeBuilderLayout,
  type BuilderLayoutDescriptor,
} from '../builder-layout.js'

describe('builder-layout constants', () => {
  it('pins version to 1 and default to the neutral default layout', () => {
    expect(BUILDER_LAYOUT_VERSION).toBe(1)
    expect(DEFAULT_BUILDER_LAYOUT).toEqual({ version: 1, layout: 'default' })
  })
})

describe('builderLayoutVariant', () => {
  it('labels immersive with pinned surface canvas', () => {
    expect(
      builderLayoutVariant({
        version: 1,
        layout: 'immersive',
        pinnedSurface: { canvasId: 'some-canvas' },
      }),
    ).toBe('immersive:some-canvas')
  })

  it('labels immersive without surface as plain immersive', () => {
    expect(builderLayoutVariant({ version: 1, layout: 'immersive' })).toBe('immersive')
  })

  it('labels other layouts by their layout kind', () => {
    expect(builderLayoutVariant({ version: 1, layout: 'default' })).toBe('default')
    expect(builderLayoutVariant({ version: 1, layout: 'commander' })).toBe('commander')
    expect(builderLayoutVariant({ version: 1, layout: 'develop' })).toBe('develop')
  })
})

describe('normalizeBuilderLayout', () => {
  it('clamps non-record input to the default layout', () => {
    expect(normalizeBuilderLayout(null)).toEqual(DEFAULT_BUILDER_LAYOUT)
    expect(normalizeBuilderLayout(undefined)).toEqual(DEFAULT_BUILDER_LAYOUT)
    expect(normalizeBuilderLayout('immersive')).toEqual(DEFAULT_BUILDER_LAYOUT)
    expect(normalizeBuilderLayout(42)).toEqual(DEFAULT_BUILDER_LAYOUT)
    expect(normalizeBuilderLayout([])).toEqual(DEFAULT_BUILDER_LAYOUT)
  })

  it('clamps wrong version to the default layout', () => {
    expect(normalizeBuilderLayout({ version: 2, layout: 'immersive' })).toEqual(DEFAULT_BUILDER_LAYOUT)
    expect(normalizeBuilderLayout({ layout: 'immersive' })).toEqual(DEFAULT_BUILDER_LAYOUT)
  })

  it('clamps unknown layout to the default layout', () => {
    expect(normalizeBuilderLayout({ version: 1, layout: 'wat' })).toEqual(DEFAULT_BUILDER_LAYOUT)
  })

  it('reconstructs a clean immersive descriptor and drops strays', () => {
    expect(
      normalizeBuilderLayout({
        version: 1,
        layout: 'immersive',
        pinnedSurface: { canvasId: 'any-canvas' },
        stray: 'x',
      }),
    ).toEqual({
      version: 1,
      layout: 'immersive',
      pinnedSurface: { canvasId: 'any-canvas' },
    })
  })

  it('keeps any string pinned-surface canvasId (structural validation, no allow-list)', () => {
    expect(
      normalizeBuilderLayout({
        version: 1,
        layout: 'immersive',
        pinnedSurface: { canvasId: 'a-feature-specific-canvas' },
      }),
    ).toEqual({
      version: 1,
      layout: 'immersive',
      pinnedSurface: { canvasId: 'a-feature-specific-canvas' },
    })
  })

  it('drops a non-string pinned surface but keeps immersive', () => {
    expect(
      normalizeBuilderLayout({
        version: 1,
        layout: 'immersive',
        pinnedSurface: { canvasId: 42 },
      }),
    ).toEqual({ version: 1, layout: 'immersive' })
  })

  it('normalizes immersive without a surface', () => {
    expect(normalizeBuilderLayout({ version: 1, layout: 'immersive' })).toEqual({
      version: 1,
      layout: 'immersive',
    })
  })

  it('keeps commander initialCanvasId only when it is a string', () => {
    expect(
      normalizeBuilderLayout({ version: 1, layout: 'commander', initialCanvasId: 'canvas-a' }),
    ).toEqual({ version: 1, layout: 'commander', initialCanvasId: 'canvas-a' })
    expect(normalizeBuilderLayout({ version: 1, layout: 'commander', initialCanvasId: 7 })).toEqual({
      version: 1,
      layout: 'commander',
    })
    expect(normalizeBuilderLayout({ version: 1, layout: 'commander' })).toEqual({
      version: 1,
      layout: 'commander',
    })
  })

  it('passes through a valid default and develop descriptor', () => {
    expect(normalizeBuilderLayout({ version: 1, layout: 'default' })).toEqual({
      version: 1,
      layout: 'default',
    })
    expect(normalizeBuilderLayout({ version: 1, layout: 'develop' })).toEqual({
      version: 1,
      layout: 'develop',
    })
  })

  it('returns a value assignable to the descriptor union', () => {
    const result: BuilderLayoutDescriptor = normalizeBuilderLayout({ version: 1, layout: 'immersive' })
    expect(result.layout).toBe('immersive')
  })
})
