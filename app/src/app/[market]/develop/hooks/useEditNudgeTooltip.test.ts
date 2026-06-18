/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { ViewMode } from '@/app/[market]/develop/components/types'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useEditNudgeTooltip } from './useEditNudgeTooltip'

const STORAGE_KEY = 'airo-edit-nudge-dismissed'

function postNudgeEvent() {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'EDITABLE_ELEMENT_CLICKED_IN_PREVIEW', tagName: 'p' },
    }),
  )
}

describe('useEditNudgeTooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useDevelopPageStore.setState({ viewMode: ViewMode.PREVIEW })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows tooltip on EDITABLE_ELEMENT_CLICKED_IN_PREVIEW in Preview mode', () => {
    const { result } = renderHook(() => useEditNudgeTooltip())
    expect(result.current.visible).toBe(false)

    act(() => postNudgeEvent())

    expect(result.current.visible).toBe(true)
  })

  it('does not show tooltip in Edit mode', () => {
    useDevelopPageStore.setState({ viewMode: ViewMode.EDIT })
    const { result } = renderHook(() => useEditNudgeTooltip())

    act(() => postNudgeEvent())

    expect(result.current.visible).toBe(false)
  })

  it('only shows once per session', () => {
    const { result } = renderHook(() => useEditNudgeTooltip())

    act(() => postNudgeEvent())
    expect(result.current.visible).toBe(true)

    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.visible).toBe(false)

    act(() => postNudgeEvent())
    expect(result.current.visible).toBe(false)
  })

  it('does not show when permanently dismissed', () => {
    localStorage.setItem(STORAGE_KEY, '1')
    const { result } = renderHook(() => useEditNudgeTooltip())

    act(() => postNudgeEvent())

    expect(result.current.visible).toBe(false)
  })

  it('dismissForever sets localStorage and hides tooltip', () => {
    const { result } = renderHook(() => useEditNudgeTooltip())

    act(() => postNudgeEvent())
    expect(result.current.visible).toBe(true)

    act(() => result.current.dismissForever())

    expect(result.current.visible).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('auto-hides after 5 seconds', () => {
    const { result } = renderHook(() => useEditNudgeTooltip())

    act(() => postNudgeEvent())
    expect(result.current.visible).toBe(true)

    act(() => { vi.advanceTimersByTime(4999) })
    expect(result.current.visible).toBe(true)

    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.visible).toBe(false)
  })

  it('click within 500ms does not dismiss', () => {
    const { result } = renderHook(() => useEditNudgeTooltip())

    act(() => postNudgeEvent())
    expect(result.current.visible).toBe(true)

    act(() => {
      vi.advanceTimersByTime(200)
      window.dispatchEvent(new MouseEvent('click'))
    })
    expect(result.current.visible).toBe(true)
  })

  it('click after 500ms dismisses', () => {
    const { result } = renderHook(() => useEditNudgeTooltip())

    act(() => postNudgeEvent())
    expect(result.current.visible).toBe(true)

    act(() => { vi.advanceTimersByTime(600) })
    act(() => { window.dispatchEvent(new MouseEvent('click')) })
    expect(result.current.visible).toBe(false)
  })
})
