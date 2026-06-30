/**
 * Promise utilities for timeout and cancellation patterns.
 */

/**
 * Race a promise against a timeout. Returns null if the timeout fires first.
 * Cleans up the timer when the promise resolves to prevent memory leaks.
 *
 * @param promise - Promise to race
 * @param timeoutMs - Timeout duration in milliseconds
 * @param onTimeout - Callback when timeout occurs (required to force callers to handle timeout)
 * @param onLateRejection - Callback when promise rejects after timeout already fired (required
 *        because this utility has no logger import and cannot provide a safe default - callers
 *        must handle late rejections intentionally to ensure they surface in structured logging)
 * @returns The promise result, or null if timed out
 * @throws Propagates rejection from the inner promise if it rejects before the
 *         timeout fires. Rejections that arrive after timeout are suppressed.
 *         Callers should wrap in try/catch when the inner promise may reject.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
  onLateRejection: (err: unknown) => void
): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let settled = false
  let timedOut = false

  const wrappedPromise = promise.then(
    result => {
      settled = true
      if (timeoutId) clearTimeout(timeoutId)
      return result
    },
    err => {
      settled = true
      if (timeoutId) clearTimeout(timeoutId)
      throw err
    }
  )

  // Suppress unhandled rejection if promise rejects after timeout already fired
  // This can happen if an LLM call fails slowly after the timeout returns null
  wrappedPromise.catch((err) => {
    // Only notify if timeout already won the race - otherwise the rejection propagates normally
    if (timedOut) {
      onLateRejection(err)
    }
  })

  return Promise.race([
    wrappedPromise,
    new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => {
        timedOut = true
        if (!settled) {
          onTimeout?.()
        }
        resolve(null)
      }, timeoutMs)
    }),
  ])
}

/**
 * Await `promise`, but once `signal` aborts, bound the remaining wait to
 * `graceMs`. If the promise has not settled within that window after the abort,
 * reject with a synthetic error so the caller's abort handling runs instead of
 * hanging. A cooperative producer that settles on abort resolves/rejects well
 * within the grace; this only fires when the producer ignores the abort
 * entirely (e.g. an SDK whose result promises never settle on a dead socket).
 *
 * The grace timer is armed only on abort and cleared when the promise settles,
 * so the non-aborted happy path adds no timer. A late rejection from `promise`
 * after the grace fired is consumed (the `.then` handler stays attached), so it
 * does not surface as an unhandled rejection.
 */
export function raceAbortGrace<T>(promise: Promise<T>, signal: AbortSignal, graceMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    const armGrace = (): void => {
      graceTimer = setTimeout(() => {
        reject(new Error(`Result did not settle within ${graceMs}ms after abort (reason: ${String(signal.reason ?? 'unknown')})`))
      }, graceMs)
    }
    if (signal.aborted) armGrace()
    else signal.addEventListener('abort', armGrace, { once: true })
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', armGrace)
      if (graceTimer !== undefined) clearTimeout(graceTimer)
    })
  })
}
