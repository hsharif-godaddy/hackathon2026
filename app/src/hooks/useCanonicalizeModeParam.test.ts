/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useCanonicalizeModeParam } from './useCanonicalizeModeParam'

const mockReplace = vi.fn()
const mockShipAnalyticsLog = vi.fn()

const searchParamsRef = vi.hoisted(() => ({ value: new URLSearchParams() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/en-US',
  useSearchParams: () => searchParamsRef.value,
}))

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => mockShipAnalyticsLog(...args),
}))

describe('useCanonicalizeModeParam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParamsRef.value = new URLSearchParams()
  })

  it('rewrites a legacy ?template= to ?mode= and logs once', () => {
    searchParamsRef.value = new URLSearchParams('template=logo-designer')

    renderHook(() => useCanonicalizeModeParam())

    expect(mockReplace).toHaveBeenCalledTimes(1)
    expect(mockReplace).toHaveBeenCalledWith('/en-US?mode=logo-designer', { scroll: false })
    expect(mockShipAnalyticsLog).toHaveBeenCalledTimes(1)
    expect(mockShipAnalyticsLog).toHaveBeenCalledWith('mode_param.legacy_used', {
      param: 'template',
      value: 'logo-designer',
    })
  })

  it('does not replace or log when no legacy param is present', () => {
    searchParamsRef.value = new URLSearchParams('mode=logo-designer')

    renderHook(() => useCanonicalizeModeParam())

    expect(mockReplace).not.toHaveBeenCalled()
    expect(mockShipAnalyticsLog).not.toHaveBeenCalled()
  })

  it('preserves an existing mode value and drops the legacy template param', () => {
    searchParamsRef.value = new URLSearchParams('mode=deep-build&template=logo-designer')

    renderHook(() => useCanonicalizeModeParam())

    expect(mockReplace).toHaveBeenCalledWith('/en-US?mode=deep-build', { scroll: false })
  })

  it('only fires once across rerenders', () => {
    searchParamsRef.value = new URLSearchParams('template=logo-designer')

    const { rerender } = renderHook(() => useCanonicalizeModeParam())
    rerender()
    rerender()

    expect(mockReplace).toHaveBeenCalledTimes(1)
    expect(mockShipAnalyticsLog).toHaveBeenCalledTimes(1)
  })
})
