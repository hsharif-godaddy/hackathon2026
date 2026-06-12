/**
 * A tiny FIFO counting semaphore for bounding concurrent async work.
 *
 * Deliberately dependency-free, mirroring the in-house worker-pool style of
 * `runCapped` rather than pulling in an external limiter. Used to cap how many
 * Playwright captures run at once, independent of how many trials are in flight.
 */
export interface Semaphore {
  /**
   * Resolves once a permit is available, yielding a `release` callback that
   * returns the permit. `release` is idempotent: calling it more than once
   * frees only the single permit acquired by this call.
   */
  acquire(): Promise<() => void>;
}

/**
 * Creates a counting semaphore with `permits` slots.
 *
 * A `permits` value that is not a finite number >= 1 (e.g. 0, a negative, or
 * NaN from a misconfigured override) yields an UNBOUNDED semaphore whose
 * `acquire` always resolves immediately with a no-op release. This is a safety
 * choice: a misconfiguration degrades to "no gating", never to a deadlock.
 */
export function createSemaphore(permits: number): Semaphore {
  if (!Number.isFinite(permits) || permits < 1) {
    const noop = (): void => {};
    return { acquire: () => Promise.resolve(noop) };
  }

  let available = Math.floor(permits);
  const waiters: Array<() => void> = [];

  const acquire = (): Promise<() => void> => {
    const grant = (): (() => void) => {
      // `released` guards idempotency: a second call to the returned
      // release must not free an extra permit.
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const next = waiters.shift();
        if (next) {
          // Hand the permit directly to the next waiter (FIFO) without
          // round-tripping through `available`, preserving the count.
          next();
        } else {
          available++;
        }
      };
    };

    if (available > 0) {
      available--;
      return Promise.resolve(grant());
    }

    return new Promise<() => void>((resolve) => {
      waiters.push(() => resolve(grant()));
    });
  };

  return { acquire };
}
