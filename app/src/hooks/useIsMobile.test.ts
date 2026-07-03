/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useIsMobile } from './useIsMobile'

const mockUseBreakpoints = vi.fn()

vi.mock('./useBreakpoints', () => ({
  useBreakpoints: () => mockUseBreakpoints(),
}))

describe('useIsMobile', function useIsMobileTests() {
  beforeEach(function reset() {
    vi.clearAllMocks()
    mockUseBreakpoints.mockReturnValue({ isBelowMdBreakpoint: false })
  })

  it('returns isBelowMdBreakpoint from useBreakpoints', function delegatesToBreakpoints() {
    mockUseBreakpoints.mockReturnValue({ isBelowMdBreakpoint: true })

    const { result } = renderHook(function useRenderUseIsMobile() {
      return useIsMobile()
    })

    expect(result.current).toBe(true)
  })

  it('is true below md (< 768px, mobile layout)', function mobileLayout() {
    mockUseBreakpoints.mockReturnValue({ isBelowMdBreakpoint: true })

    const { result } = renderHook(function useRenderUseIsMobile() {
      return useIsMobile()
    })

    expect(result.current).toBe(true)
  })

  it('is false at md and above (≥ 768px, desktop layout)', function desktopLayout() {
    mockUseBreakpoints.mockReturnValue({ isBelowMdBreakpoint: false })

    const { result } = renderHook(function useRenderUseIsMobile() {
      return useIsMobile()
    })

    expect(result.current).toBe(false)
  })

  it('is true in the 640–767px band (mobile layout but not below sm)', function betweenSmAndMd() {
    mockUseBreakpoints.mockReturnValue({
      isBelowSmBreakpoint: false,
      isBelowMdBreakpoint: true,
    })

    const { result } = renderHook(function useRenderUseIsMobile() {
      return useIsMobile()
    })

    expect(result.current).toBe(true)
  })
})
