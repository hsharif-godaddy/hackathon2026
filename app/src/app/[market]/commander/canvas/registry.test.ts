import { describe, expect,it } from 'vitest'

import { CANVAS_REGISTRY } from './registry'

describe('CANVAS_REGISTRY', () => {
  it('every canvas tab has a unique icon', () => {
    const icons: unknown[] = Object.values(CANVAS_REGISTRY).map((c) => c.Icon)
    const unique: Set<unknown> = new Set(icons)
    expect(unique.size).toBe(icons.length)
  })
})
