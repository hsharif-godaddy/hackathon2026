/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'

import { renderHookWithProviders } from '@/tests/test-utils'
import {
  getVisualViewportBottomInset,
  useVisualViewportBottomInset,
} from './useVisualViewportBottomInset'

function mockVisualViewport(options: {
  height: number
  offsetTop?: number
  innerHeight?: number
}) {
  const listeners = new Map<string, Set<() => void>>()

  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: options.innerHeight ?? 800,
  })

  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      height: options.height,
      offsetTop: options.offsetTop ?? 0,
      addEventListener: (type: string, listener: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(listener)
      },
      removeEventListener: (type: string, listener: () => void) => {
        listeners.get(type)?.delete(listener)
      },
    },
  })

  return {
    emit(type: string) {
      listeners.get(type)?.forEach((listener) => listener())
    },
    setHeight(height: number) {
      ;(window.visualViewport as { height: number }).height = height
    },
  }
}

describe('getVisualViewportBottomInset', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // @ts-expect-error test cleanup
    delete window.visualViewport
  })

  it('returns 0 when visualViewport is unavailable', () => {
    // @ts-expect-error test cleanup
    delete window.visualViewport
    expect(getVisualViewportBottomInset()).toBe(0)
  })

  it('returns the keyboard overlap height', () => {
    mockVisualViewport({ height: 400, innerHeight: 800 })
    expect(getVisualViewportBottomInset()).toBe(400)
  })

  it('accounts for visual viewport offsetTop', () => {
    mockVisualViewport({ height: 500, offsetTop: 50, innerHeight: 800 })
    expect(getVisualViewportBottomInset()).toBe(250)
  })

  it('never returns a negative inset', () => {
    mockVisualViewport({ height: 900, innerHeight: 800 })
    expect(getVisualViewportBottomInset()).toBe(0)
  })
})

describe('useVisualViewportBottomInset', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // @ts-expect-error test cleanup
    delete window.visualViewport
  })

  it('updates when the visual viewport resizes', () => {
    const viewport = mockVisualViewport({ height: 800, innerHeight: 800 })

    const { result } = renderHookWithProviders(() => useVisualViewportBottomInset())

    expect(result.current.bottomInset).toBe(0)
    expect(result.current.viewportHeight).toBe(800)

    act(() => {
      viewport.setHeight(420)
      viewport.emit('resize')
    })

    expect(result.current.bottomInset).toBe(380)
    expect(result.current.viewportHeight).toBe(420)
  })
})
