/**
 * Module-scoped render-cycle counter shared between `error-client.ts` (which
 * owns the Vite HMR event listeners that advance it) and `AiroErrorBoundary`
 * (which stamps the current value onto every error payload it emits).
 *
 * Kept in its own module on purpose: `AiroErrorBoundary` is statically
 * imported from the app's `App.tsx` and therefore gets bundled into every
 * build, production included. Pulling the counter out of `error-client.ts`
 * (which has real import-time side effects — HMR listeners, initial
 * cycle beacon) means the boundary can read the current cycleId without
 * dragging those side effects into production bundles. `error-client.ts`
 * remains dev-only, loaded on demand by `index.html`.
 *
 * ## Monotonicity contract
 *
 * The counter is a wall-clock millisecond timestamp (`Date.now()`) and
 * must advance strictly monotonically across:
 *   - In-session advances (one per HMR boundary in a given page load).
 *   - Full-page reloads (a stale cycleId would walk the server-side
 *     `currentCycleIdByApp` *backwards* on `max(current, incoming)`,
 *     which would correctly no-op, but then every subsequent POST from
 *     the reloaded page would appear stale and get dropped).
 *
 * `advanceCycleId` enforces this with `Math.max(counter + 1, Date.now())`:
 *   - If 2+ advances happen inside a single millisecond, the `+1`
 *     guarantees a fresh value.
 *   - If the system clock ever goes backwards (NTP adjustment), the `+1`
 *     keeps us monotonic within the session. Across reloads, a backwards
 *     clock jump could still cause a stale id — we accept that edge case
 *     rather than persisting state across reloads.
 */

let currentCycleId = Date.now();

/**
 * Read the currently-active cycle generation. Callers that produce
 * runtime-error POSTs should include the value they read here so the
 * server's buffer can filter stale entries from superseded render
 * generations. See `RuntimeErrorBuffer.push` in
 * `agents/src/services/runtime-error-buffer.ts`.
 */
export function getCurrentCycleId(): number {
  return currentCycleId;
}

/**
 * Advance to a new cycle generation and return the new id. Caller is
 * responsible for announcing the rotation to the server (done in
 * `error-client.ts` via a `runtime-errors-cycle` postMessage forwarded
 * by the builder parent).
 */
export function advanceCycleId(): number {
  currentCycleId = Math.max(currentCycleId + 1, Date.now());
  return currentCycleId;
}
