/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { usePaywallDeeplinkWithStore } from './usePaywallDeeplinkWithStore'

const mockOpenUpgradeModal = vi.fn()
const mockUseSwitchboard = vi.fn()

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => mockUseSwitchboard(flag),
}))

vi.mock('@/stores/usePaywallStore', () => ({
  usePaywallStore: (selector: (state: { openUpgradeModal: typeof mockOpenUpgradeModal }) => unknown) =>
    selector({ openUpgradeModal: mockOpenUpgradeModal }),
}))

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}))

describe('usePaywallDeeplinkWithStore', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSwitchboard.mockReturnValue(true)

    Object.defineProperty(window, 'location', {
      value: { search: '', pathname: '/en-US' },
      writable: true,
    })

    Object.defineProperty(window, 'history', {
      value: { replaceState: vi.fn() },
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    })
  })

  it('calls openUpgradeModal from store when action=showPaywall', () => {
    window.location.search = '?action=showPaywall'

    renderHook(() => usePaywallDeeplinkWithStore())

    expect(mockOpenUpgradeModal).toHaveBeenCalledTimes(1)
    expect(mockOpenUpgradeModal).toHaveBeenCalledWith('deeplink', undefined)
  })

  it('does not call openUpgradeModal when action param is missing', () => {
    window.location.search = ''

    renderHook(() => usePaywallDeeplinkWithStore())

    expect(mockOpenUpgradeModal).not.toHaveBeenCalled()
  })

  it('respects enabled option', () => {
    window.location.search = '?action=showPaywall'

    renderHook(() => usePaywallDeeplinkWithStore({ enabled: false }))

    expect(mockOpenUpgradeModal).not.toHaveBeenCalled()
  })

  it('defaults enabled to true', () => {
    window.location.search = '?action=showPaywall'

    renderHook(() => usePaywallDeeplinkWithStore())

    expect(mockOpenUpgradeModal).toHaveBeenCalledTimes(1)
  })
})
