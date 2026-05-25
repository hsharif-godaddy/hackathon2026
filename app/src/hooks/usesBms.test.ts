/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'

import { renderHookWithProviders } from '@/tests/test-utils'

const mockGetSwitchboardFlag = vi.fn()
vi.mock('@/hooks/useSwitchboard', () => ({
  getSwitchboardFlag: (flag: string) => mockGetSwitchboardFlag(flag),
}))

import { usesBms } from './usesBms'

describe('usesBms', () => {
  it('returns true when app-builder-budget-service is enabled', () => {
    mockGetSwitchboardFlag.mockImplementation((flag: string) => {
      if (flag === 'app-builder-budget-service') return true
      if (flag === 'app-builder-bms-existing') return false
      return undefined
    })

    const { result } = renderHookWithProviders(() => usesBms())
    expect(result.current).toBe(true)
    expect(mockGetSwitchboardFlag).toHaveBeenCalledWith('app-builder-budget-service')
    expect(mockGetSwitchboardFlag).toHaveBeenCalledWith('app-builder-bms-existing')
  })

  it('returns true when app-builder-bms-existing is enabled', () => {
    mockGetSwitchboardFlag.mockImplementation((flag: string) => {
      if (flag === 'app-builder-budget-service') return false
      if (flag === 'app-builder-bms-existing') return true
      return undefined
    })

    const { result } = renderHookWithProviders(() => usesBms())
    expect(result.current).toBe(true)
    expect(mockGetSwitchboardFlag).toHaveBeenCalledWith('app-builder-budget-service')
    expect(mockGetSwitchboardFlag).toHaveBeenCalledWith('app-builder-bms-existing')
  })

  it('returns true when both flags are enabled', () => {
    mockGetSwitchboardFlag.mockImplementation(() => true)

    const { result } = renderHookWithProviders(() => usesBms())
    expect(result.current).toBe(true)
  })

  it('returns false when both flags are disabled', () => {
    mockGetSwitchboardFlag.mockImplementation(() => false)

    const { result } = renderHookWithProviders(() => usesBms())
    expect(result.current).toBe(false)
  })

  it('returns false when both flags are undefined (no switchboard data)', () => {
    mockGetSwitchboardFlag.mockImplementation(() => undefined)

    const { result } = renderHookWithProviders(() => usesBms())
    expect(result.current).toBe(false)
  })
})
