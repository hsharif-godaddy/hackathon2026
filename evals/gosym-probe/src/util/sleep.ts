/**
 * Resolves after `ms` milliseconds.
 *
 * When an `AbortSignal` is supplied, the timer is cancelled and the promise
 * rejects with the signal's abort reason the moment the signal fires (or
 * immediately, if it is already aborted). This lets callers that sleep inside a
 * retry/backoff loop honor cancellation promptly instead of stalling for the
 * full duration — important when a server-supplied `Retry-After` can push the
 * wait up to several minutes.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
