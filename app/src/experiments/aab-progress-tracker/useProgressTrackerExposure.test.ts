/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { INELIGIBLE_COHORT } from '@/config/experiments'
import { useProgressTrackerExposure } from './useProgressTrackerExposure'

const { mockLogAnalytics, cohortRef } = vi.hoisted(() => ({
  mockLogAnalytics: vi.fn(),
  cohortRef: { current: 'on' as string },
}))
vi.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: () => ({ cohort: cohortRef.current, logAnalytics: mockLogAnalytics }),
}))

// Unique app id per test so the module-scope once-per-app guard starts fresh.
const hoisted = vi.hoisted(() => ({ counter: 0 }))

describe('useProgressTrackerExposure', function exposureTests() {
  beforeEach(function setup() {
    hoisted.counter += 1
    cohortRef.current = 'on'
    vi.clearAllMocks()
  })

  it('fires for the treatment cohort on the first-build screen', function treatment() {
    const appId: string = `test-app-${hoisted.counter}`
    cohortRef.current = 'on'
    renderHook(() => useProgressTrackerExposure(appId, true))

    expect(mockLogAnalytics).toHaveBeenCalledWith(
      'progressTracker.exposure',
      { appId, cohort: 'on' },
      { kind: 'impression', eid: 'develop.progressTracker.exposure', impressionProps: { appId } },
    )
  })

  it('also fires for the control cohort (symmetric exposure)', function control() {
    const appId: string = `test-app-${hoisted.counter}`
    cohortRef.current = 'off'
    renderHook(() => useProgressTrackerExposure(appId, true))

    expect(mockLogAnalytics).toHaveBeenCalledWith(
      'progressTracker.exposure',
      { appId, cohort: 'off' },
      { kind: 'impression', eid: 'develop.progressTracker.exposure', impressionProps: { appId } },
    )
  })

  it('does not fire for users not in the experiment', function ineligible() {
    const appId: string = `test-app-${hoisted.counter}`
    cohortRef.current = INELIGIBLE_COHORT
    renderHook(() => useProgressTrackerExposure(appId, true))

    expect(mockLogAnalytics).not.toHaveBeenCalled()
  })

  it('does not fire while the first-build screen is not showing', function inactive() {
    const appId: string = `test-app-${hoisted.counter}`
    renderHook(() => useProgressTrackerExposure(appId, false))

    expect(mockLogAnalytics).not.toHaveBeenCalled()
  })
})
