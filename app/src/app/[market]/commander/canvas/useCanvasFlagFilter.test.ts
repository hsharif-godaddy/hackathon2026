/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { CanvasId } from './registry'
import { useCanvasFlagFilter } from './useCanvasFlagFilter'

const switchboardValues: Record<string, unknown> = {}

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => switchboardValues[flag],
}))

afterEach(() => {
  for (const key of Object.keys(switchboardValues)) {
    delete switchboardValues[key]
  }
})

describe('useCanvasFlagFilter', () => {
  it('always allows canvases without a switchboardFlag', () => {
    const { result } = renderHook(() => useCanvasFlagFilter())
    expect(result.current(CanvasId.Preview)).toBe(true)
    expect(result.current(CanvasId.Code)).toBe(true)
    expect(result.current(CanvasId.SettingsDatabase)).toBe(true)
  })

  it('returns false for unknown canvas ids', () => {
    const { result } = renderHook(() => useCanvasFlagFilter())
    expect(result.current('not-a-canvas' as CanvasId)).toBe(false)
  })

  it('only treats the literal value true as enabling a flag', () => {
    switchboardValues['appbuilder-brandbook'] = 'true'
    const { result: stringResult } = renderHook(() => useCanvasFlagFilter())
    expect(stringResult.current(CanvasId.Brand)).toBe(false)

    switchboardValues['appbuilder-brandbook'] = 1
    const { result: numberResult } = renderHook(() => useCanvasFlagFilter())
    expect(numberResult.current(CanvasId.Brand)).toBe(false)

    switchboardValues['appbuilder-brandbook'] = undefined
    const { result: undefResult } = renderHook(() => useCanvasFlagFilter())
    expect(undefResult.current(CanvasId.Brand)).toBe(false)

    switchboardValues['appbuilder-brandbook'] = true
    const { result: trueResult } = renderHook(() => useCanvasFlagFilter())
    expect(trueResult.current(CanvasId.Brand)).toBe(true)
  })

  it('uses descriptor.switchboardFlag to decide each canvas independently', () => {
    switchboardValues['appbuilder-brandbook'] = true
    switchboardValues['appbuilder-domain-top-level'] = false
    const { result } = renderHook(() => useCanvasFlagFilter())
    expect(result.current(CanvasId.Brand)).toBe(true)
    expect(result.current(CanvasId.Domain)).toBe(false)
  })
})
