/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { clearCreditsDeeplinkParam, useCreditsDeeplink } from './useCreditsDeeplink'

const mockShipAnalyticsLog = vi.fn()
const mockUseSwitchboard = vi.fn()

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => mockShipAnalyticsLog(...args),
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => mockUseSwitchboard(flag),
}))

describe('useCreditsDeeplink', () => {
  const mockOpenCredits = vi.fn()
  const mockReplaceState = vi.fn()
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSwitchboard.mockReturnValue(true)

    Object.defineProperty(window, 'location', {
      value: { search: '', pathname: '/en-US', hash: '' },
      writable: true,
    })

    Object.defineProperty(window, 'history', {
      value: { replaceState: mockReplaceState },
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    })
  })

  describe('when action=showCredits is present', () => {
    beforeEach(() => {
      window.location.search = '?action=showCredits'
    })

    it('calls openCredits with default source', () => {
      renderHook(() => useCreditsDeeplink({ openCredits: mockOpenCredits }))

      expect(mockOpenCredits).toHaveBeenCalledTimes(1)
      expect(mockOpenCredits).toHaveBeenCalledWith('deeplink')
    })

    it('falls back to deeplink for unknown source values', () => {
      window.location.search = '?action=showCredits&source=unknown_value'

      renderHook(() => useCreditsDeeplink({ openCredits: mockOpenCredits }))

      expect(mockOpenCredits).toHaveBeenCalledWith('deeplink')
    })

    it('passes bell_campaign source when provided', () => {
      window.location.search = '?action=showCredits&source=bell_campaign'

      renderHook(() => useCreditsDeeplink({ openCredits: mockOpenCredits }))

      expect(mockOpenCredits).toHaveBeenCalledWith('bell_campaign')
    })

    it('fires analytics event', () => {
      window.location.search = '?action=showCredits'
      window.location.pathname = '/en-US/manage-plan'

      renderHook(() => useCreditsDeeplink({ openCredits: mockOpenCredits }))

      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('credits.deeplink.triggered', {
        source: 'deeplink',
        page: '/en-US/manage-plan',
      })
    })

    it('clears the action param from URL', () => {
      window.location.search = '?action=showCredits&other=keep'
      window.location.pathname = '/en-US'

      renderHook(() => useCreditsDeeplink({ openCredits: mockOpenCredits }))

      expect(mockReplaceState).toHaveBeenCalledWith(null, '', '/en-US?other=keep')
    })
  })

  describe('when action param is missing or different', () => {
    it('does not open credits when action is missing', () => {
      window.location.search = ''

      renderHook(() => useCreditsDeeplink({ openCredits: mockOpenCredits }))

      expect(mockOpenCredits).not.toHaveBeenCalled()
      expect(mockShipAnalyticsLog).not.toHaveBeenCalled()
    })

    it('does not open credits when action has different value', () => {
      window.location.search = '?action=showPaywall'

      renderHook(() => useCreditsDeeplink({ openCredits: mockOpenCredits }))

      expect(mockOpenCredits).not.toHaveBeenCalled()
    })
  })

  describe('feature flag gating', () => {
    it('does not trigger when feature flag is false', () => {
      mockUseSwitchboard.mockReturnValue(false)
      window.location.search = '?action=showCredits'

      renderHook(() => useCreditsDeeplink({ openCredits: mockOpenCredits }))

      expect(mockOpenCredits).not.toHaveBeenCalled()
      expect(mockShipAnalyticsLog).not.toHaveBeenCalled()
    })

    it('does not trigger when feature flag is undefined', () => {
      mockUseSwitchboard.mockReturnValue(undefined)
      window.location.search = '?action=showCredits'

      renderHook(() => useCreditsDeeplink({ openCredits: mockOpenCredits }))

      expect(mockOpenCredits).not.toHaveBeenCalled()
    })

    it('uses correct feature flag name', () => {
      window.location.search = '?action=showCredits'

      renderHook(() => useCreditsDeeplink({ openCredits: mockOpenCredits }))

      expect(mockUseSwitchboard).toHaveBeenCalledWith('appbuilder-credits-deeplink')
    })
  })

  describe('enabled gate', () => {
    beforeEach(() => {
      window.location.search = '?action=showCredits'
    })

    it('does not trigger when enabled is false', () => {
      renderHook(() => useCreditsDeeplink({ openCredits: mockOpenCredits, enabled: false }))

      expect(mockOpenCredits).not.toHaveBeenCalled()
    })

    it('triggers when enabled becomes true', () => {
      const { rerender } = renderHook(
        ({ enabled }) => useCreditsDeeplink({ openCredits: mockOpenCredits, enabled }),
        { initialProps: { enabled: false } }
      )

      expect(mockOpenCredits).not.toHaveBeenCalled()

      rerender({ enabled: true })

      expect(mockOpenCredits).toHaveBeenCalledTimes(1)
    })
  })

  describe('one-shot behavior', () => {
    beforeEach(() => {
      window.location.search = '?action=showCredits'
    })

    it('only fires once even with multiple rerenders', () => {
      const { rerender } = renderHook(() => useCreditsDeeplink({ openCredits: mockOpenCredits }))

      expect(mockOpenCredits).toHaveBeenCalledTimes(1)
      expect(mockReplaceState).toHaveBeenCalledTimes(1)

      rerender()
      rerender()

      expect(mockOpenCredits).toHaveBeenCalledTimes(1)
      expect(mockReplaceState).toHaveBeenCalledTimes(1)
    })

    it('only fires once even if enabled toggles after first fire', () => {
      const { rerender } = renderHook(
        ({ enabled }) => useCreditsDeeplink({ openCredits: mockOpenCredits, enabled }),
        { initialProps: { enabled: true } }
      )

      expect(mockOpenCredits).toHaveBeenCalledTimes(1)

      rerender({ enabled: false })
      rerender({ enabled: true })

      expect(mockOpenCredits).toHaveBeenCalledTimes(1)
    })
  })
})

describe('clearCreditsDeeplinkParam', () => {
  const originalLocation = window.location
  const mockReplaceState = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    Object.defineProperty(window, 'location', {
      value: { search: '', pathname: '/en-US', hash: '' },
      writable: true,
    })

    Object.defineProperty(window, 'history', {
      value: { replaceState: mockReplaceState },
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    })
  })

  it('strips action and source params from URL but preserves other params', () => {
    window.location.search = '?action=showCredits&source=deeplink&itc=keep_me&other=param'
    window.location.pathname = '/en-US'

    clearCreditsDeeplinkParam()

    expect(mockReplaceState).toHaveBeenCalledWith(null, '', '/en-US?itc=keep_me&other=param')
  })

  it('does nothing when action param has a different value', () => {
    window.location.search = '?action=showPaywall'

    clearCreditsDeeplinkParam()

    expect(mockReplaceState).not.toHaveBeenCalled()
  })

  it('preserves hash fragment when stripping action param', () => {
    window.location.search = '?action=showCredits&other=keep'
    window.location.pathname = '/en-US'
    ;(window.location as { hash: string }).hash = '#section'

    clearCreditsDeeplinkParam()

    expect(mockReplaceState).toHaveBeenCalledWith(null, '', '/en-US?other=keep#section')
  })
})
