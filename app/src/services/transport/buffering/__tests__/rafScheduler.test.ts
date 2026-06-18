/**
 * @vitest-environment jsdom
 */
/**
 * RAF Scheduler Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRAFScheduler } from '../rafScheduler'

vi.mock('@/lib/request-context', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('createRAFScheduler', () => {
  let flush: ReturnType<typeof vi.fn>

  beforeEach(() => {
    flush = vi.fn()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('schedules a flush via requestAnimationFrame', async () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    const scheduler = createRAFScheduler(flush, 'test')

    scheduler.schedule()

    expect(rafSpy).toHaveBeenCalledTimes(1)
    expect(flush).not.toHaveBeenCalled()

    // Execute the RAF callback
    await vi.waitFor(() => {
      expect(flush).toHaveBeenCalledTimes(1)
    })
  })

  it('deduplicates multiple schedule calls within one frame', async () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    const scheduler = createRAFScheduler(flush, 'test')

    scheduler.schedule()
    scheduler.schedule()
    scheduler.schedule()

    expect(rafSpy).toHaveBeenCalledTimes(1)

    await vi.waitFor(() => {
      expect(flush).toHaveBeenCalledTimes(1)
    })
  })

  it('allows scheduling again after flush completes', async () => {
    const scheduler = createRAFScheduler(flush, 'test')

    scheduler.schedule()
    await vi.waitFor(() => {
      expect(flush).toHaveBeenCalledTimes(1)
    })

    // Should be able to schedule again
    scheduler.schedule()
    await vi.waitFor(() => {
      expect(flush).toHaveBeenCalledTimes(2)
    })
  })

  it('flushImmediate cancels pending RAF and flushes synchronously', () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    const scheduler = createRAFScheduler(flush, 'test')

    scheduler.schedule()
    scheduler.flushImmediate()

    expect(cancelSpy).toHaveBeenCalled()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('flushImmediate works when nothing is scheduled', () => {
    const scheduler = createRAFScheduler(flush, 'test')

    scheduler.flushImmediate()

    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('falls back to setTimeout when RAF is unavailable', async () => {
    const originalRAF = window.requestAnimationFrame
    delete (window as any).requestAnimationFrame

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout')
    const scheduler = createRAFScheduler(flush, 'test')

    scheduler.schedule()

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 16)

    await vi.waitFor(() => {
      expect(flush).toHaveBeenCalledTimes(1)
    })

    window.requestAnimationFrame = originalRAF
  })

  it('flushImmediate cancels pending setTimeout fallback', () => {
    const originalRAF = window.requestAnimationFrame
    delete (window as any).requestAnimationFrame

    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
    const scheduler = createRAFScheduler(flush, 'test')

    scheduler.schedule()
    scheduler.flushImmediate()

    expect(clearTimeoutSpy).toHaveBeenCalled()
    expect(flush).toHaveBeenCalledTimes(1)

    window.requestAnimationFrame = originalRAF
  })

  it('cancel cancels pending RAF without flushing', () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
    const scheduler = createRAFScheduler(flush, 'test')

    scheduler.schedule()
    scheduler.cancel()

    expect(cancelSpy).toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('cancel allows scheduling again', async () => {
    const scheduler = createRAFScheduler(flush, 'test')

    scheduler.schedule()
    scheduler.cancel()

    // Should be able to schedule again after cancel
    scheduler.schedule()
    await vi.waitFor(() => {
      expect(flush).toHaveBeenCalledTimes(1)
    })
  })

  it('recovers from flush errors and retries', async () => {
    let callCount = 0
    const errorFlush = vi.fn(function () {
      callCount++
      if (callCount === 1) {
        throw new Error('flush failed')
      }
    })

    const scheduler = createRAFScheduler(errorFlush, 'test')

    scheduler.schedule()

    // The RAF callback will catch the error and retry
    await vi.waitFor(() => {
      expect(errorFlush).toHaveBeenCalledTimes(2) // original + fallback retry
    })
  })
})
