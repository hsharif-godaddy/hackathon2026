/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const logAnalytics = vi.fn()
const useAnalyticsMock = vi.fn(() => ({ logAnalytics }))

vi.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: (options: unknown) => useAnalyticsMock(options),
}))

import { useFirstBuildEstimateImpression } from './useFirstBuildEstimateImpression'

describe('useFirstBuildEstimateImpression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls useAnalytics without an experiment id', () => {
    renderHook(() => useFirstBuildEstimateImpression('app-1'))

    expect(useAnalyticsMock).toHaveBeenCalledWith({})
  })

  it('does not log until the returned callback is invoked', () => {
    renderHook(() => useFirstBuildEstimateImpression('app-1'))

    expect(logAnalytics).not.toHaveBeenCalled()
  })

  it('logs the impression once no matter how many times markShown is called', () => {
    const { result } = renderHook(() => useFirstBuildEstimateImpression('app-1'))

    result.current()
    result.current()

    expect(logAnalytics).toHaveBeenCalledTimes(1)
    expect(logAnalytics).toHaveBeenCalledWith(
      'firstBuildTimeEstimate.shown',
      { appId: 'app-1' },
      { kind: 'impression', eid: 'develop.firstBuildTimeEstimate.shown', impressionProps: { appId: 'app-1' } },
    )
  })

  it('logs again after the appId changes', () => {
    const { result, rerender } = renderHook(
      ({ appId }: { appId: string }) => useFirstBuildEstimateImpression(appId),
      { initialProps: { appId: 'app-1' } },
    )

    result.current()
    expect(logAnalytics).toHaveBeenCalledTimes(1)

    rerender({ appId: 'app-2' })
    result.current()

    expect(logAnalytics).toHaveBeenCalledTimes(2)
    expect(logAnalytics).toHaveBeenLastCalledWith(
      'firstBuildTimeEstimate.shown',
      { appId: 'app-2' },
      { kind: 'impression', eid: 'develop.firstBuildTimeEstimate.shown', impressionProps: { appId: 'app-2' } },
    )
  })
})
