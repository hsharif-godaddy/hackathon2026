/**
 * Promise Utilities Tests
 *
 * Tests for the withTimeout utility for racing promises against timeouts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { raceAbortGrace, withTimeout } from '../promise-utils.js'

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Helper to create no-op callbacks for tests that don't care about them
  const noop = () => {}
  const noopErr = () => {}

  it('returns resolved value when promise completes before timeout', async () => {
    const promise = Promise.resolve('success')
    const result = await withTimeout(promise, 5000, noop, noopErr)
    expect(result).toBe('success')
  })

  it('returns null when promise times out', async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('too late'), 10000)
    })

    const resultPromise = withTimeout(slowPromise, 5000, noop, noopErr)

    // Fast-forward past timeout
    await vi.advanceTimersByTimeAsync(5100)

    const result = await resultPromise
    expect(result).toBeNull()
  })

  it('calls onTimeout callback when promise times out', async () => {
    const onTimeout = vi.fn()
    const slowPromise = new Promise<string>(() => {
      // Never resolves
    })

    const resultPromise = withTimeout(slowPromise, 5000, onTimeout, noopErr)

    // Fast-forward past timeout
    await vi.advanceTimersByTimeAsync(5100)

    await resultPromise
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('does not call onTimeout callback when promise resolves in time', async () => {
    const onTimeout = vi.fn()
    const promise = Promise.resolve('fast')

    await withTimeout(promise, 5000, onTimeout, noopErr)

    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('handles parallel promises with mixed timeouts', async () => {
    const fastPromise = Promise.resolve('fast')
    const slowPromise = new Promise<string>(() => {
      // Never resolves
    })

    const [fastResult, slowResult] = await Promise.all([
      withTimeout(fastPromise, 5000, noop, noopErr),
      (async () => {
        const promise = withTimeout(slowPromise, 5000, noop, noopErr)
        await vi.advanceTimersByTimeAsync(5100)
        return promise
      })(),
    ])

    expect(fastResult).toBe('fast')
    expect(slowResult).toBeNull()
  })

  it('cleans up timer when promise resolves before timeout', async () => {
    const promise = Promise.resolve('fast')

    await withTimeout(promise, 5000, noop, noopErr)

    // Advance timers - no callback should fire
    await vi.advanceTimersByTimeAsync(10000)
    // Test passes if no errors (timer was cleaned up)
  })

  it('uses custom timeout duration', async () => {
    const customTimeout = 1000
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('too late'), customTimeout + 500)
    })

    const resultPromise = withTimeout(slowPromise, customTimeout, noop, noopErr)

    // Advance past custom timeout
    await vi.advanceTimersByTimeAsync(customTimeout + 100)

    const result = await resultPromise
    expect(result).toBeNull()
  })

  it('propagates errors from rejected promises', async () => {
    const error = new Error('test error')
    const failingPromise = Promise.reject(error)

    await expect(withTimeout(failingPromise, 5000, noop, noopErr)).rejects.toThrow('test error')
  })

  it('suppresses rejection after timeout has fired', async () => {
    const onLateRejection = vi.fn()
    // Create a promise that rejects slowly
    const slowRejectPromise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('late rejection')), 10000)
    })

    const resultPromise = withTimeout(slowRejectPromise, 5000, noop, onLateRejection)

    // Fast-forward past timeout
    await vi.advanceTimersByTimeAsync(5100)
    const result = await resultPromise
    expect(result).toBeNull()

    // Fast-forward to when rejection fires - should call onLateRejection, not throw
    await vi.advanceTimersByTimeAsync(10000)
    expect(onLateRejection).toHaveBeenCalledTimes(1)
  })

  it('calls onLateRejection callback when promise rejects after timeout', async () => {
    const onTimeout = vi.fn()
    const onLateRejection = vi.fn()
    const lateError = new Error('late rejection')

    // Create a promise that rejects slowly
    const slowRejectPromise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(lateError), 10000)
    })

    const resultPromise = withTimeout(slowRejectPromise, 5000, onTimeout, onLateRejection)

    // Fast-forward past timeout
    await vi.advanceTimersByTimeAsync(5100)
    const result = await resultPromise
    expect(result).toBeNull()
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onLateRejection).not.toHaveBeenCalled()

    // Fast-forward to when rejection fires
    await vi.advanceTimersByTimeAsync(10000)

    // onLateRejection should be called with the error
    expect(onLateRejection).toHaveBeenCalledTimes(1)
    expect(onLateRejection).toHaveBeenCalledWith(lateError)
  })

  it('does not call onLateRejection when promise rejects before timeout', async () => {
    const onTimeout = vi.fn()
    const onLateRejection = vi.fn()
    const error = new Error('early rejection')
    const failingPromise = Promise.reject(error)

    await expect(withTimeout(failingPromise, 5000, onTimeout, onLateRejection)).rejects.toThrow('early rejection')

    expect(onTimeout).not.toHaveBeenCalled()
    expect(onLateRejection).not.toHaveBeenCalled()
  })
})

describe('raceAbortGrace', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with the value when the promise settles before any abort', async () => {
    const controller = new AbortController()
    await expect(raceAbortGrace(Promise.resolve('ok'), controller.signal, 5000)).resolves.toBe('ok')
  })

  it('rejects with the original error when the promise rejects before any abort', async () => {
    const controller = new AbortController()
    await expect(
      raceAbortGrace(Promise.reject(new Error('boom')), controller.signal, 5000),
    ).rejects.toThrow('boom')
  })

  it('rejects after the grace when the promise ignores the abort', async () => {
    const controller = new AbortController()
    const neverSettles = new Promise<string>(() => undefined)
    const resultPromise = raceAbortGrace(neverSettles, controller.signal, 5000)
    // Attach the rejection expectation before advancing timers so the grace
    // rejection (fired during advanceTimersByTimeAsync) is handled — otherwise
    // it surfaces as an unhandled rejection.
    const assertion = expect(resultPromise).rejects.toThrow('did not settle within 5000ms after abort (reason: chunk_timeout)')
    controller.abort('chunk_timeout')
    await vi.advanceTimersByTimeAsync(5100)
    await assertion
  })

  it('resolves with the value when the promise settles within the grace after abort', async () => {
    const controller = new AbortController()
    const settlesLate = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 1000))
    const resultPromise = raceAbortGrace(settlesLate, controller.signal, 5000)
    controller.abort('user_stopped')
    await vi.advanceTimersByTimeAsync(1100)
    await expect(resultPromise).resolves.toBe('late')
  })

  it('arms the grace immediately when the signal is already aborted at call time', async () => {
    const controller = new AbortController()
    controller.abort('server_shutdown')
    const neverSettles = new Promise<string>(() => undefined)
    const resultPromise = raceAbortGrace(neverSettles, controller.signal, 3000)
    const assertion = expect(resultPromise).rejects.toThrow('did not settle within 3000ms after abort (reason: server_shutdown)')
    await vi.advanceTimersByTimeAsync(3100)
    await assertion
  })
})
