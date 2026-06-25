/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { STAGE_DURATION_MS, useProgressTracker } from './useProgressTracker'

// Unique app id per test so the per-app tick store starts fresh (no cross-test resume).
const hoisted = vi.hoisted(() => ({ appId: 'init', counter: 0 }))
vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => hoisted.appId,
}))

const STAGE_COUNT = 5
const INTRO_DELAY_MS = 800

describe('useProgressTracker', function hookTests() {
  beforeEach(function setup() {
    hoisted.counter += 1
    hoisted.appId = `test-app-${hoisted.counter}`
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  })

  afterEach(function teardown() {
    vi.useRealTimers()
  })

  it('starts before the first stage during the intro delay', function intro() {
    const { result } = renderHook(() => useProgressTracker(STAGE_COUNT))

    expect(result.current.activeStage).toBe(-1)
    expect(result.current.subProgress).toBe(0)
  })

  it('activates the first stage after the intro delay', function firstStage() {
    const { result } = renderHook(() => useProgressTracker(STAGE_COUNT))

    act(() => { vi.advanceTimersByTime(INTRO_DELAY_MS) })

    expect(result.current.activeStage).toBe(0)
  })

  it('advances one stage per STAGE_DURATION_MS', function advances() {
    const { result } = renderHook(() => useProgressTracker(STAGE_COUNT))

    act(() => { vi.advanceTimersByTime(INTRO_DELAY_MS + STAGE_DURATION_MS) })

    expect(result.current.activeStage).toBe(1)
  })

  it('resumes from the stored progress after an ask-question remount', function resumes() {
    const first = renderHook(() => useProgressTracker(STAGE_COUNT))
    act(() => { vi.advanceTimersByTime(INTRO_DELAY_MS + STAGE_DURATION_MS) })
    expect(first.result.current.activeStage).toBe(1)
    first.unmount()

    // Remount with the same app id (the overlay unmounts/remounts across a
    // question) — it should pick up at stage 1, not restart at -1/0.
    const second = renderHook(() => useProgressTracker(STAGE_COUNT))
    expect(second.result.current.activeStage).toBe(1)
  })

  it('clamps at the final stage and never exceeds it', function clamps() {
    const { result } = renderHook(() => useProgressTracker(STAGE_COUNT))

    act(() => { vi.advanceTimersByTime(INTRO_DELAY_MS + STAGE_DURATION_MS * 20) })

    expect(result.current.activeStage).toBe(STAGE_COUNT - 1)
  })

  it('creeps the trailing progress forward past the final stage without completing', function trailingCreep() {
    const { result } = renderHook(() => useProgressTracker(STAGE_COUNT))

    // Empty until the final stage is passed.
    act(() => { vi.advanceTimersByTime(INTRO_DELAY_MS) })
    expect(result.current.trailingProgress).toBe(0)

    // Past all five stages it has started to fill...
    act(() => { vi.advanceTimersByTime(STAGE_DURATION_MS * 6) })
    const early: number = result.current.trailingProgress
    expect(early).toBeGreaterThan(0)

    // ...keeps moving forward (monotonic)...
    act(() => { vi.advanceTimersByTime(STAGE_DURATION_MS * 2) })
    expect(result.current.trailingProgress).toBeGreaterThan(early)

    // ...but never completes, even after a long wait.
    act(() => { vi.advanceTimersByTime(STAGE_DURATION_MS * 30) })
    expect(result.current.trailingProgress).toBeLessThan(1)
  })
})
