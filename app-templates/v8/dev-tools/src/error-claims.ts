/**
 * Cross-instance dedup registry for errors already claimed by an
 * `AiroErrorBoundary`'s `componentDidCatch`.
 *
 * ## Why this exists
 *
 * The template mounts TWO boundaries in development:
 *   - a ROOT boundary in `main.tsx`, above the providers and `<App>`,
 *     which owns the global `window.onerror` / `unhandledrejection`
 *     handlers and catches render errors that escape the router
 *     (siblings of `<RouterProvider>`, provider crashes, first-render
 *     throws);
 *   - an INNER boundary in `App.tsx`, inside the route element, which
 *     catches route render errors before React Router swaps in its own
 *     default error UI.
 *
 * React 18 re-dispatches a boundary-caught render error to
 * `window.onerror` in the same frame, using the same Error reference.
 * When the INNER boundary catches a route render error, that re-dispatch
 * reaches the ROOT boundary's global handler — a different instance whose
 * per-instance `hasActiveError` / `platformErrors` dedup has no knowledge
 * of the inner boundary's claim. Without a shared registry the root would
 * re-forward the error and stack a second overlay on top of the one the
 * inner boundary is already showing.
 *
 * Keyed by Error identity in a WeakSet so GC reclaims entries once the
 * error object is unreachable — no manual cleanup required for the common
 * path. `reset()` exists only for HMR, where a long-lived closure could
 * retain a claimed Error reference across an update.
 */
let claimed = new WeakSet<object>();

/**
 * Mark an error as claimed by a boundary's `componentDidCatch`. Safe to
 * call with any non-null object; primitives are ignored because a
 * re-dispatch always carries the same Error object reference.
 */
export function claim(error: unknown): void {
  if (error !== null && typeof error === 'object') {
    claimed.add(error);
  }
}

/**
 * True when an error was already claimed by a boundary's
 * `componentDidCatch`. The global async handler checks this before
 * forwarding/overlaying so a same-frame re-dispatch from another
 * boundary instance is suppressed exactly once.
 */
export function isClaimed(error: unknown): boolean {
  return error !== null && typeof error === 'object' && claimed.has(error);
}

/**
 * Drop all claims. Called from each boundary's HMR `vite:afterUpdate`
 * reset so a cached Error reference held in a long-lived closure can't
 * permanently suppress a genuinely new occurrence after a hot update.
 * WeakSet has no `clear()`, so we replace the instance; both boundaries
 * read the live module binding through these functions.
 */
export function reset(): void {
  claimed = new WeakSet<object>();
}
