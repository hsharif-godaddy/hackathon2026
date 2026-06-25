/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useProgressTrackerImpression } from './useProgressTrackerImpression'

const { mockLogAnalytics } = vi.hoisted(() => ({ mockLogAnalytics: vi.fn() }))
vi.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: () => ({ cohort: 'on', logAnalytics: mockLogAnalytics }),
}))

// Unique app id per test so the module-scope once-per-app guard starts fresh.
const hoisted = vi.hoisted(() => ({ counter: 0 }))

describe('useProgressTrackerImpression', function impressionTests() {
  beforeEach(function setup() {
    hoisted.counter += 1
    vi.clearAllMocks()
  })

  it('logs a cohort-tagged impression the first time the tracker is shown', function logsOnce() {
    const appId: string = `test-app-${hoisted.counter}`
    renderHook(() => useProgressTrackerImpression(appId))

    expect(mockLogAnalytics).toHaveBeenCalledWith(
      'progressTracker.shown',
      { appId },
      { kind: 'impression', eid: 'develop.progressTracker.shown', impressionProps: { appId } },
    )
  })

  it('does not re-fire when the tracker remounts for the same app (ask-question pause)', function dedupesRemount() {
    const appId: string = `test-app-${hoisted.counter}`
    const first = renderHook(() => useProgressTrackerImpression(appId))
    expect(mockLogAnalytics).toHaveBeenCalledTimes(1)
    first.unmount()

    renderHook(() => useProgressTrackerImpression(appId))
    expect(mockLogAnalytics).toHaveBeenCalledTimes(1)
  })
})
