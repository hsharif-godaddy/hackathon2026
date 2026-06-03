/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { usePostBuildEditNudge } from '@/hooks/usePostBuildEditNudge'

describe('usePostBuildEditNudge', function tests() {
  const baseProps = {
    viewMode: 'edit',
    showBuildingOverlay: false,
    isStreaming: false,
    isLoading: false,
    isMobile: false,
    featureFlagEnabled: true,
  }

  let getItemSpy: ReturnType<typeof vi.spyOn>
  let setItemSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  function fireFirstInteraction() {
    act(function message() {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'IFRAME_FIRST_INTERACTION' },
          source: window,
        })
      )
    })
  }

  beforeEach(function setup() {
    vi.clearAllMocks()
    getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null)
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const iframe = document.createElement('iframe')
    iframe.id = 'preview-iframe'
    Object.defineProperty(iframe, 'contentWindow', {
      value: window,
      configurable: true,
    })
    document.body.appendChild(iframe)
  })

  afterEach(function teardown() {
    getItemSpy.mockRestore()
    setItemSpy.mockRestore()
    warnSpy.mockRestore()
    document.getElementById('preview-iframe')?.remove()
  })

  it('does not show nudge when featureFlagEnabled is false', function disabledFlag() {
    const { result } = renderHook(() =>
      usePostBuildEditNudge({
        ...baseProps,
        featureFlagEnabled: false,
      })
    )

    fireFirstInteraction()

    expect(result.current.showNudge).toBe(false)
  })

  it('does not show nudge when isMobile is true', function mobile() {
    const { result } = renderHook(() =>
      usePostBuildEditNudge({
        ...baseProps,
        isMobile: true,
      })
    )

    fireFirstInteraction()

    expect(result.current.showNudge).toBe(false)
  })

  it('does not show nudge when localStorage key exists', function alreadyShown() {
    getItemSpy.mockImplementation((key) => (key === 'airo-edit-nudge-shown' ? 'true' : null))

    const { result } = renderHook(() => usePostBuildEditNudge(baseProps))

    fireFirstInteraction()

    expect(result.current.showNudge).toBe(false)
  })

  it('does not show nudge while showBuildingOverlay is true', function buildingOverlay() {
    const { result } = renderHook(() =>
      usePostBuildEditNudge({
        ...baseProps,
        showBuildingOverlay: true,
      })
    )

    fireFirstInteraction()

    expect(result.current.showNudge).toBe(false)
  })

  it('does not show nudge while isStreaming is true', function streaming() {
    const { result } = renderHook(() =>
      usePostBuildEditNudge({
        ...baseProps,
        isStreaming: true,
      })
    )

    fireFirstInteraction()

    expect(result.current.showNudge).toBe(false)
  })

  it('does not show nudge while isLoading is true', function loading() {
    const { result } = renderHook(() =>
      usePostBuildEditNudge({
        ...baseProps,
        isLoading: true,
      })
    )

    fireFirstInteraction()

    expect(result.current.showNudge).toBe(false)
  })

  it('ignores IFRAME_FIRST_INTERACTION when source does not match iframe', function sourceMismatch() {
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
    const differentSource = Object.create(null) as Window
    Object.defineProperty(iframe, 'contentWindow', {
      value: differentSource,
      configurable: true,
    })
    const { result } = renderHook(() => usePostBuildEditNudge(baseProps))

    fireFirstInteraction()

    expect(result.current.showNudge).toBe(false)
  })

  it('ignores IFRAME_FIRST_INTERACTION when preview-iframe not in DOM', function missingIframe() {
    document.getElementById('preview-iframe')?.remove()
    const { result } = renderHook(() => usePostBuildEditNudge(baseProps))

    fireFirstInteraction()

    expect(result.current.showNudge).toBe(false)
  })

  it('shows nudge when IFRAME_FIRST_INTERACTION message is received after conditions are met', function firstInteraction() {
    const { result } = renderHook(() => usePostBuildEditNudge(baseProps))

    fireFirstInteraction()

    expect(result.current.showNudge).toBe(true)
  })

  it('dismiss sets showNudge to false and writes localStorage key', function dismiss() {
    const { result } = renderHook(() => usePostBuildEditNudge(baseProps))

    fireFirstInteraction()

    expect(result.current.showNudge).toBe(true)

    act(function close() {
      result.current.dismiss()
    })

    expect(result.current.showNudge).toBe(false)
    expect(setItemSpy).toHaveBeenCalledWith('airo-edit-nudge-shown', 'true')
  })

  it('dismisses permanently when viewMode changes away from edit', function dismissesOnViewModeChange() {
    const { result, rerender } = renderHook((props) => usePostBuildEditNudge(props), {
      initialProps: baseProps,
    })

    fireFirstInteraction()
    expect(result.current.showNudge).toBe(true)

    rerender({
      ...baseProps,
      viewMode: 'preview',
    })

    expect(result.current.showNudge).toBe(false)
    expect(setItemSpy).toHaveBeenCalledWith('airo-edit-nudge-shown', 'true')
  })

  it('gracefully handles localStorage.getItem throwing', function getItemError() {
    getItemSpy.mockImplementation(() => {
      throw new Error('getItem failed')
    })
    const { result } = renderHook(() => usePostBuildEditNudge(baseProps))

    fireFirstInteraction()

    expect(result.current.showNudge).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(
      '[edit-nudge] localStorage operation failed',
      expect.any(Error)
    )
  })

  it('gracefully handles localStorage.setItem throwing on dismiss', function setItemError() {
    setItemSpy.mockImplementation(() => {
      throw new Error('setItem failed')
    })
    const { result } = renderHook(() => usePostBuildEditNudge(baseProps))

    fireFirstInteraction()
    expect(result.current.showNudge).toBe(true)

    act(function close() {
      result.current.dismiss()
    })

    expect(result.current.showNudge).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      '[edit-nudge] localStorage operation failed',
      expect.any(Error)
    )
  })

  it('cleans up message listener on unmount', function cleanup() {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => usePostBuildEditNudge(baseProps))

    const listener = addSpy.mock.calls.find((call) => call[0] === 'message')?.[1]

    expect(listener).toBeTypeOf('function')

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('message', listener)
  })
})
