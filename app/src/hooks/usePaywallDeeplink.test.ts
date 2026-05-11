/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { clearPaywallDeeplinkParam, usePaywallDeeplink } from './usePaywallDeeplink'

const mockShipAnalyticsLog = vi.fn()
const mockUseSwitchboard = vi.fn()

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => mockShipAnalyticsLog(...args),
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => mockUseSwitchboard(flag),
}))

describe('usePaywallDeeplink', () => {
  const mockOpenPaywall = vi.fn()
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

  describe('when action=showPaywall is present', () => {
    beforeEach(() => {
      window.location.search = '?action=showPaywall'
    })

    it('calls openPaywall with default source', () => {
      renderHook(() => usePaywallDeeplink({ openPaywall: mockOpenPaywall }))

      expect(mockOpenPaywall).toHaveBeenCalledTimes(1)
      expect(mockOpenPaywall).toHaveBeenCalledWith('deeplink', 'upgrade')
    })

    it('falls back to deeplink for unknown source values', () => {
      window.location.search = '?action=showPaywall&source=unknown_value'

      renderHook(() => usePaywallDeeplink({ openPaywall: mockOpenPaywall }))

      expect(mockOpenPaywall).toHaveBeenCalledWith('deeplink', 'upgrade')
    })

    it('passes bell_campaign source when provided', () => {
      window.location.search = '?action=showPaywall&source=bell_campaign'

      renderHook(() => usePaywallDeeplink({ openPaywall: mockOpenPaywall }))

      expect(mockOpenPaywall).toHaveBeenCalledWith('bell_campaign', 'upgrade')
    })

    it('fires analytics event', () => {
      window.location.search = '?action=showPaywall'
      window.location.pathname = '/en-US/manage-plan'

      renderHook(() => usePaywallDeeplink({ openPaywall: mockOpenPaywall }))

      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('paywall.deeplink.triggered', {
        source: 'deeplink',
        page: '/en-US/manage-plan',
      })
    })

    it('clears the action param from URL', () => {
      window.location.search = '?action=showPaywall&other=keep'
      window.location.pathname = '/en-US'

      renderHook(() => usePaywallDeeplink({ openPaywall: mockOpenPaywall }))

      expect(mockReplaceState).toHaveBeenCalledWith(null, '', '/en-US?other=keep')
    })
  })

  describe('when action param is missing or different', () => {
    it('does not open paywall when action is missing', () => {
      window.location.search = ''

      renderHook(() => usePaywallDeeplink({ openPaywall: mockOpenPaywall }))

      expect(mockOpenPaywall).not.toHaveBeenCalled()
      expect(mockShipAnalyticsLog).not.toHaveBeenCalled()
    })

    it('does not open paywall when action has different value', () => {
      window.location.search = '?action=somethingElse'

      renderHook(() => usePaywallDeeplink({ openPaywall: mockOpenPaywall }))

      expect(mockOpenPaywall).not.toHaveBeenCalled()
    })
  })

  describe('feature flag gating', () => {
    it('does not trigger when feature flag is false', () => {
      mockUseSwitchboard.mockReturnValue(false)
      window.location.search = '?action=showPaywall'

      renderHook(() => usePaywallDeeplink({ openPaywall: mockOpenPaywall }))

      expect(mockOpenPaywall).not.toHaveBeenCalled()
      expect(mockShipAnalyticsLog).not.toHaveBeenCalled()
    })

    it('does not trigger when feature flag is undefined', () => {
      mockUseSwitchboard.mockReturnValue(undefined)
      window.location.search = '?action=showPaywall'

      renderHook(() => usePaywallDeeplink({ openPaywall: mockOpenPaywall }))

      expect(mockOpenPaywall).not.toHaveBeenCalled()
    })

    it('uses correct feature flag name', () => {
      window.location.search = '?action=showPaywall'

      renderHook(() => usePaywallDeeplink({ openPaywall: mockOpenPaywall }))

      expect(mockUseSwitchboard).toHaveBeenCalledWith('appbuilder-paywall-deeplink')
    })
  })

  describe('enabled gate', () => {
    beforeEach(() => {
      window.location.search = '?action=showPaywall'
    })

    it('does not trigger when enabled is false', () => {
      renderHook(() => usePaywallDeeplink({ openPaywall: mockOpenPaywall, enabled: false }))

      expect(mockOpenPaywall).not.toHaveBeenCalled()
    })

    it('triggers when enabled becomes true', () => {
      const { rerender } = renderHook(
        ({ enabled }) => usePaywallDeeplink({ openPaywall: mockOpenPaywall, enabled }),
        { initialProps: { enabled: false } }
      )

      expect(mockOpenPaywall).not.toHaveBeenCalled()

      rerender({ enabled: true })

      expect(mockOpenPaywall).toHaveBeenCalledTimes(1)
    })

    it('defaults enabled to true', () => {
      renderHook(() => usePaywallDeeplink({ openPaywall: mockOpenPaywall }))

      expect(mockOpenPaywall).toHaveBeenCalledTimes(1)
    })
  })

  describe('one-shot behavior', () => {
    beforeEach(() => {
      window.location.search = '?action=showPaywall'
    })

    it('only fires once even with multiple rerenders', () => {
      const { rerender } = renderHook(() => usePaywallDeeplink({ openPaywall: mockOpenPaywall }))

      expect(mockOpenPaywall).toHaveBeenCalledTimes(1)
      expect(mockReplaceState).toHaveBeenCalledTimes(1)

      rerender()
      rerender()
      rerender()

      expect(mockOpenPaywall).toHaveBeenCalledTimes(1)
      expect(mockReplaceState).toHaveBeenCalledTimes(1)
    })

    it('only fires once even if enabled toggles', () => {
      const { rerender } = renderHook(
        ({ enabled }) => usePaywallDeeplink({ openPaywall: mockOpenPaywall, enabled }),
        { initialProps: { enabled: true } }
      )

      expect(mockOpenPaywall).toHaveBeenCalledTimes(1)

      rerender({ enabled: false })
      rerender({ enabled: true })

      expect(mockOpenPaywall).toHaveBeenCalledTimes(1)
    })
  })
})

describe('clearPaywallDeeplinkParam', () => {
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
    window.location.search = '?action=showPaywall&source=deeplink&itc=keep_me&other=param'
    window.location.pathname = '/en-US'

    clearPaywallDeeplinkParam()

    expect(mockReplaceState).toHaveBeenCalledWith(null, '', '/en-US?itc=keep_me&other=param')
  })

  it('strips URL search entirely when action is the only param', () => {
    window.location.search = '?action=showPaywall'
    window.location.pathname = '/en-US/develop/123'

    clearPaywallDeeplinkParam()

    expect(mockReplaceState).toHaveBeenCalledWith(null, '', '/en-US/develop/123')
  })

  it('does nothing when action param is not present', () => {
    window.location.search = '?other=param'

    clearPaywallDeeplinkParam()

    expect(mockReplaceState).not.toHaveBeenCalled()
  })

  it('does nothing when search is empty', () => {
    window.location.search = ''

    clearPaywallDeeplinkParam()

    expect(mockReplaceState).not.toHaveBeenCalled()
  })

  it('does nothing when action param has a different value', () => {
    window.location.search = '?action=otherAction'

    clearPaywallDeeplinkParam()

    expect(mockReplaceState).not.toHaveBeenCalled()
  })

  it('preserves hash fragment when stripping action param', () => {
    window.location.search = '?action=showPaywall&other=keep'
    window.location.pathname = '/en-US'
    ;(window.location as { hash: string }).hash = '#section'

    clearPaywallDeeplinkParam()

    expect(mockReplaceState).toHaveBeenCalledWith(null, '', '/en-US?other=keep#section')
  })

  it('preserves hash fragment when action is the only param', () => {
    window.location.search = '?action=showPaywall'
    window.location.pathname = '/en-US'
    ;(window.location as { hash: string }).hash = '#anchor'

    clearPaywallDeeplinkParam()

    expect(mockReplaceState).toHaveBeenCalledWith(null, '', '/en-US#anchor')
  })
})
