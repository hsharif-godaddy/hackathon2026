/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type InstalledFlag = typeof globalThis & { __airoTimerPauseInstalled?: boolean }
type TimerPauseModule = typeof import('../utils/edit-mode-timer-pause')

// Force a fresh install per test so install() runs against the current
// vi.useFakeTimers() context and the registry starts empty.
async function loadFreshModule(): Promise<TimerPauseModule> {
  vi.resetModules()
  delete (globalThis as InstalledFlag).__airoTimerPauseInstalled
  return await import('../utils/edit-mode-timer-pause')
}

describe('edit-mode-timer-pause', () => {
  let mod: TimerPauseModule

  beforeEach(async () => {
    vi.useFakeTimers()
    window.__airoEditModeActive = false
    mod = await loadFreshModule()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete window.__airoEditModeActive
  })

  describe('passthrough', () => {
    it('runs carousel-shaped intervals normally when edit mode is off', () => {
      const handler = vi.fn()
      setInterval(handler, 3000)
      vi.advanceTimersByTime(3000)
      expect(handler).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(3000)
      expect(handler).toHaveBeenCalledTimes(2)
    })

    it('runs sub-1s intervals (below carousel range) without pause', () => {
      const handler = vi.fn()
      setInterval(handler, 500)
      mod.pauseEditModeTimers()
      vi.advanceTimersByTime(500)
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('runs >10s intervals (above carousel range) without pause', () => {
      const handler = vi.fn()
      setInterval(handler, 15_000)
      mod.pauseEditModeTimers()
      vi.advanceTimersByTime(15_000)
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('fires setTimeout normally when delay is out of carousel range', () => {
      const handler = vi.fn()
      setTimeout(handler, 500)
      mod.pauseEditModeTimers()
      vi.advanceTimersByTime(500)
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('pause / resume', () => {
    it('pauses carousel-shaped intervals on pauseEditModeTimers', () => {
      const handler = vi.fn()
      setInterval(handler, 5000)
      mod.pauseEditModeTimers()
      vi.advanceTimersByTime(5000)
      expect(handler).not.toHaveBeenCalled()
    })

    it('pauses carousel-shaped setTimeouts', () => {
      const handler = vi.fn()
      setTimeout(handler, 5000)
      mod.pauseEditModeTimers()
      vi.advanceTimersByTime(5000)
      expect(handler).not.toHaveBeenCalled()
    })

    it('resumes paused intervals so they fire again', () => {
      const handler = vi.fn()
      setInterval(handler, 5000)
      mod.pauseEditModeTimers()
      vi.advanceTimersByTime(5000)
      expect(handler).not.toHaveBeenCalled()
      mod.resumeEditModeTimers()
      vi.advanceTimersByTime(5000)
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('defers new in-range schedules while edit mode is active, fires them on resume', () => {
      const handler = vi.fn()
      mod.pauseEditModeTimers()
      setInterval(handler, 3000)
      vi.advanceTimersByTime(10_000)
      expect(handler).not.toHaveBeenCalled()
      mod.resumeEditModeTimers()
      vi.advanceTimersByTime(3000)
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('ID stability', () => {
    it('keeps the wrapped ID stable across pause/resume so clearInterval still works', () => {
      const handler = vi.fn()
      const id = setInterval(handler, 5000)
      mod.pauseEditModeTimers()
      mod.resumeEditModeTimers()
      clearInterval(id)
      vi.advanceTimersByTime(10_000)
      expect(handler).not.toHaveBeenCalled()
    })

    it('keeps wrapped ID stable for setTimeout too', () => {
      const handler = vi.fn()
      const id = setTimeout(handler, 5000)
      mod.pauseEditModeTimers()
      mod.resumeEditModeTimers()
      clearTimeout(id)
      vi.advanceTimersByTime(10_000)
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('introspection', () => {
    it('getPausedCarouselTimerCount counts only paused in-range timers', () => {
      setInterval(vi.fn(), 3000)
      setInterval(vi.fn(), 7000)
      setInterval(vi.fn(), 500)
      setInterval(vi.fn(), 30_000)
      expect(mod.getPausedCarouselTimerCount()).toBe(0)
      mod.pauseEditModeTimers()
      expect(mod.getPausedCarouselTimerCount()).toBe(2)
      mod.resumeEditModeTimers()
      expect(mod.getPausedCarouselTimerCount()).toBe(0)
    })
  })

  describe('manual advance', () => {
    it('advancePausedCarouselTimers fires each paused in-range handler once', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      setInterval(h1, 3000)
      setInterval(h2, 7000)
      mod.pauseEditModeTimers()
      mod.advancePausedCarouselTimers()
      expect(h1).toHaveBeenCalledTimes(1)
      expect(h2).toHaveBeenCalledTimes(1)
    })

    it('advancePausedCarouselTimers does NOT fire out-of-range handlers', () => {
      const tooFast = vi.fn()
      const inRange = vi.fn()
      const tooSlow = vi.fn()
      setInterval(tooFast, 500)
      setInterval(inRange, 4000)
      setInterval(tooSlow, 30_000)
      mod.pauseEditModeTimers()
      mod.advancePausedCarouselTimers()
      expect(tooFast).not.toHaveBeenCalled()
      expect(inRange).toHaveBeenCalledTimes(1)
      expect(tooSlow).not.toHaveBeenCalled()
    })

    it('swallows handler exceptions so one bad rotator does not break others', () => {
      const broken = vi.fn(() => { throw new Error('boom') })
      const good = vi.fn()
      setInterval(broken, 3000)
      setInterval(good, 3000)
      mod.pauseEditModeTimers()
      expect(() => mod.advancePausedCarouselTimers()).not.toThrow()
      expect(broken).toHaveBeenCalled()
      expect(good).toHaveBeenCalled()
    })

    it('does not infinite-loop on a recursive setTimeout rotator (regression)', () => {
      // Handler reschedules itself via setTimeout; without a snapshot + delete of the old stub, the live iteration would visit the reschedule and hang.
      let calls = 0
      const tick = (): void => {
        calls++
        setTimeout(tick, 3000)
      }
      setTimeout(tick, 3000)
      mod.pauseEditModeTimers()
      expect(mod.getPausedCarouselTimerCount()).toBe(1)
      mod.advancePausedCarouselTimers()
      expect(calls).toBe(1)
      expect(mod.getPausedCarouselTimerCount()).toBe(1)
      mod.advancePausedCarouselTimers()
      expect(calls).toBe(2)
      expect(mod.getPausedCarouselTimerCount()).toBe(1)
    })

    it('hasActiveCarouselTimers detects any in-range timer regardless of pause state', () => {
      expect(mod.hasActiveCarouselTimers()).toBe(false)
      setInterval(vi.fn(), 3000)
      expect(mod.hasActiveCarouselTimers()).toBe(true)
      mod.pauseEditModeTimers()
      expect(mod.hasActiveCarouselTimers()).toBe(true)
    })

    it('hasActiveCarouselTimers ignores out-of-range timers', () => {
      setInterval(vi.fn(), 500)
      setInterval(vi.fn(), 30_000)
      expect(mod.hasActiveCarouselTimers()).toBe(false)
    })

    it('keeps setInterval entries around for resume after advance', () => {
      const handler = vi.fn()
      setInterval(handler, 3000)
      mod.pauseEditModeTimers()
      mod.advancePausedCarouselTimers()
      expect(handler).toHaveBeenCalledTimes(1)
      expect(mod.getPausedCarouselTimerCount()).toBe(1)
      mod.resumeEditModeTimers()
      vi.advanceTimersByTime(3000)
      expect(handler).toHaveBeenCalledTimes(2)
    })
  })
})
