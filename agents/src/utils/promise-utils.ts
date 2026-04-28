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
