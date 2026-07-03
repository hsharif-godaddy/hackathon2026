/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'

import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { renderHookWithProviders } from '@/tests/test-utils'
import { useSyncResponsiveState } from './useSyncResponsiveState'

const mockUseBreakpoints = vi.fn()

vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: () => mockUseBreakpoints(),
}))

describe('useSyncResponsiveState', function syncResponsiveStateTests() {
  beforeEach(function reset() {
    vi.clearAllMocks()
    useDevelopPageStore.setState({ isMobile: false })
    mockUseBreakpoints.mockReturnValue({ isBelowMdBreakpoint: false })
  })

  it('syncs store isMobile to true below md (< 768px, mobile layout)', async function belowMd() {
    mockUseBreakpoints.mockReturnValue({ isBelowMdBreakpoint: true })

    renderHookWithProviders(() => useSyncResponsiveState())

    await waitFor(function assertMobile() {
      expect(useDevelopPageStore.getState().isMobile).toBe(true)
    })
  })

  it('syncs store isMobile to false at md and above (≥ 768px, desktop layout)', async function atOrAboveMd() {
    useDevelopPageStore.setState({ isMobile: true })
    mockUseBreakpoints.mockReturnValue({ isBelowMdBreakpoint: false })

    renderHookWithProviders(() => useSyncResponsiveState())

    await waitFor(function assertDesktop() {
      expect(useDevelopPageStore.getState().isMobile).toBe(false)
    })
  })

  it('syncs mobile layout in the 640–767px band (below md but not below sm)', async function betweenSmAndMd() {
    mockUseBreakpoints.mockReturnValue({
      isBelowSmBreakpoint: false,
      isBelowMdBreakpoint: true,
    })

    renderHookWithProviders(() => useSyncResponsiveState())

    await waitFor(function assertMobile() {
      expect(useDevelopPageStore.getState().isMobile).toBe(true)
    })
  })

  it('returns isBelowMdBreakpoint (same boundary as useIsMobile)', function returnValue() {
    mockUseBreakpoints.mockReturnValue({ isBelowMdBreakpoint: true })

    const { result } = renderHookWithProviders(() => useSyncResponsiveState())

    expect(result.current.isBelowMdBreakpoint).toBe(true)
  })
})
