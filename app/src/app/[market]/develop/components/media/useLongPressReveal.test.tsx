/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useLongPressReveal } from './useLongPressReveal'

describe('useLongPressReveal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reveals a tile after the press is held past the threshold', () => {
    const { result } = renderHook(() => useLongPressReveal())

    act(() => { result.current.getHandlers('img-a').onTouchStart() })
    expect(result.current.revealedKey).toBeNull()

    act(() => { vi.advanceTimersByTime(450) })
    expect(result.current.revealedKey).toBe('img-a')
  })

  it('does not reveal when the press is released before the threshold', () => {
    const { result } = renderHook(() => useLongPressReveal())

    act(() => {
      const handlers = result.current.getHandlers('img-a')
      handlers.onTouchStart()
      handlers.onTouchEnd()
      vi.advanceTimersByTime(450)
    })
    expect(result.current.revealedKey).toBeNull()
  })

  it('consumeLongPress returns true once after a fired long-press, then resets', () => {
    const { result } = renderHook(() => useLongPressReveal())

    act(() => {
      result.current.getHandlers('img-a').onTouchStart()
      vi.advanceTimersByTime(450)
    })
    // The trailing synthetic click should be swallowed exactly once.
    expect(result.current.consumeLongPress()).toBe(true)
    expect(result.current.consumeLongPress()).toBe(false)
  })

  it('getHandlers suppresses the native context menu so a hold only reveals', () => {
    const { result } = renderHook(() => useLongPressReveal())
    const preventDefault = vi.fn()

    act(() => { result.current.getHandlers('img-a').onContextMenu({ preventDefault }) })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    // Suppressing the menu must not, by itself, reveal or fire a long-press.
    expect(result.current.revealedKey).toBeNull()
  })

  it('clearRevealed hides the revealed tile', () => {
    const { result } = renderHook(() => useLongPressReveal())

    act(() => {
      result.current.getHandlers('img-a').onTouchStart()
      vi.advanceTimersByTime(450)
    })
    expect(result.current.revealedKey).toBe('img-a')

    act(() => { result.current.clearRevealed() })
    expect(result.current.revealedKey).toBeNull()
  })
})
