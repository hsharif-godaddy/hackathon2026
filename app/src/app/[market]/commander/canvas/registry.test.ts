import { describe, expect, it } from 'vitest'

import { CANVAS_MENU_ORDER, CANVAS_REGISTRY, CanvasId } from './registry'

describe('CANVAS_REGISTRY', () => {
  it('every canvas tab has a unique icon', () => {
    const icons: unknown[] = Object.values(CANVAS_REGISTRY).map((c) => c.Icon)
    const unique: Set<unknown> = new Set(icons)
    expect(unique.size).toBe(icons.length)
  })

  it('DesignKitBuild is hidden', () => {
    const descriptor = CANVAS_REGISTRY[CanvasId.DesignKitBuild]
    expect(descriptor.dismissible).toBe(false)
    expect(descriptor.defaultOpen).toBe(false)
    expect(CANVAS_MENU_ORDER).not.toContain(CanvasId.DesignKitBuild)
  })
})
