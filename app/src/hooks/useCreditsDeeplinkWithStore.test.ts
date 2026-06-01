/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { useCreditsDeeplinkWithStore } from './useCreditsDeeplinkWithStore'

const mockOpenCreditsModal = vi.fn()
const mockUseSwitchboard = vi.fn()

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => mockUseSwitchboard(flag),
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: { openCreditsModal: typeof mockOpenCreditsModal }) => unknown) =>
    selector({ openCreditsModal: mockOpenCreditsModal }),
}))

describe('useCreditsDeeplinkWithStore', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSwitchboard.mockReturnValue(true)

    Object.defineProperty(window, 'location', {
      value: { search: '', pathname: '/en-US', hash: '' },
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

  it('calls openCreditsModal from store when action=showCredits', () => {
    window.location.search = '?action=showCredits'

    renderHook(() => useCreditsDeeplinkWithStore())

    expect(mockOpenCreditsModal).toHaveBeenCalledTimes(1)
    expect(mockOpenCreditsModal).toHaveBeenCalledWith('deeplink', PAYWALL_ITC.CREDITS)
  })

  it('does not call openCreditsModal when action param is missing', () => {
    window.location.search = ''

    renderHook(() => useCreditsDeeplinkWithStore())

    expect(mockOpenCreditsModal).not.toHaveBeenCalled()
  })

  it('respects enabled option', () => {
    window.location.search = '?action=showCredits'

    renderHook(() => useCreditsDeeplinkWithStore({ enabled: false }))

    expect(mockOpenCreditsModal).not.toHaveBeenCalled()
  })

  it('calls openCreditsModal with bell_campaign source', () => {
    window.location.search = '?action=showCredits&source=bell_campaign'

    renderHook(() => useCreditsDeeplinkWithStore())

    expect(mockOpenCreditsModal).toHaveBeenCalledTimes(1)
    expect(mockOpenCreditsModal).toHaveBeenCalledWith('bell_campaign', PAYWALL_ITC.CREDITS)
  })
})
