import { runtimeErrorBuffer, runtimeErrorSignature, type RuntimeErrorEntry } from './runtime-error-buffer.js';
// Re-export so existing call sites (`import { RuntimeErrorEntry } from
// './runtime-error-service.js'`) keep working without a codemod.
export { runtimeErrorSignature };
export type { RuntimeErrorEntry };

/**
 * Outcome of a post-hook runtime-error check.
 *
 * - `ok=true, errors=[]` — clean poll window, nothing to do. This is the
 *   expected outcome for turns that exhaust the full `maxWaitMs` without
 *   any buffered errors; we deliberately wait the full budget so the
 *   preview has time to boot and surface first-paint crashes (see the
 *   `runtimeErrorPollMaxWaitMs` default in `post-stream-validator.ts`).
 * - `ok=false, errors=[...]` — real runtime errors the agent should fix.
 * - `ok=true, skipped=true, reason='aborted'` — the caller aborted (user
 *   stopped the turn, socket closed, etc.). Callers must treat this as
 *   "do not block the message" and continue — never convert a skip into
 *   a fake pass/fail.
 */
export interface RuntimeErrorResult {
  ok: boolean;
  errors: RuntimeErrorEntry[];
  skipped?: boolean;
  reason?: 'aborted';
  durationMs?: number;
}

// Fallbacks used only when the caller doesn't override them. Production
// callers pass explicit values (see `runtimeErrorPollMaxWaitMs` in
// `post-stream-validator.ts`); these exist so unit-test callers that
// don't care about timing still see sensible defaults. Kept in sync with
// the production budget so they don't drift into "almost 4s" territory
// and mislead new callers.
const DEFAULT_MAX_WAIT_MS = 10_000;
const DEFAULT_QUIET_WINDOW_MS = 1500;
const POLL_INTERVAL_MS = 250;

// Default poll cadence for `waitForCycleAdvance`. Tighter than
// `POLL_INTERVAL_MS` so the validator reacts quickly once the new preview
// process finishes booting and the initial cycle beacon lands — the
// overall wait is dominated by dev-server boot time, not this cadence.
const CYCLE_WAIT_POLL_INTERVAL_MS = 150;

/**
 * Outcome of `waitForCycleAdvance`. `advanced: true` means the buffer's
 * current cycleId for `appId` is different from the caller-supplied
 * `previousCycleId` (the preview restarted and its new `error-client.ts`
 * pushed a fresh beacon). `advanced: false` means the timeout or abort
 * signal fired before the cycleId changed.
 */
export interface CycleAdvanceResult {
  advanced: boolean;
  newCycleId?: number;
  durationMs: number;
}

/**
 * Post-hook runtime-error checker.
 *
 * Drains `RuntimeErrorBuffer` for `appId` using a quiet-window strategy:
 * once at least one error has arrived, the check returns as soon as no
 * new errors have arrived for `quietWindowMs`, capped at `maxWaitMs`.
 * This balances latency against catching async errors (`useEffect`, data
 * fetches) that surface a beat after HMR applies. The buffer is
 * populated exclusively via the authenticated
 * `POST /apps/:id/runtime-errors` route (see `routes/runtime-errors.ts`)
 * and is the sole source of truth.
 *
 * Cross-turn freshness is handled by the buffer itself via cycle
 * rotation — entries from prior render generations are evicted when
 * the preview HMRs. The service just drains whatever the buffer
 * considers current for this app, and the shared-per-call
 * `seenSignatures` Set prevents the 250ms polling loop from
 * double-counting within a single drain window.
 */
export class RuntimeErrorService {
  /**
   * True once the preview has announced at least one cycle for `appId`.
   * The `runtime-errors-cycle` beacon is the only thing that gates the
   * buffer into a "drainable" state; if it never arrives (postMessage
   * not wired, network failure on the forwarded POST, extension-blocked
   * parent window), `drainForTurn` silently returns `[]` and the
   * validator would report clean. Callers use this to distinguish
   * "genuinely clean turn" from "no signal from the preview at all"
   * and log accordingly.
   */
  hasCycleEstablished(appId: string): boolean {
    return runtimeErrorBuffer.getCurrentCycleId(appId) !== undefined;
  }

  /**
   * Current cycle generation for `appId`, or `undefined` if the preview
   * has never announced one. Thin pass-through over
   * `runtimeErrorBuffer.getCurrentCycleId` so callers (notably the
   * post-stream validator's restart path) can read the pre-restart
   * cycleId through the service and stay decoupled from the buffer
   * singleton for testability.
   */
  getCurrentCycleId(appId: string): number | undefined {
    return runtimeErrorBuffer.getCurrentCycleId(appId);
  }

  /**
   * Resolve once the buffer's current cycleId for `appId` differs from
   * `previousCycleId`, capped at `opts.timeoutMs`.
   *
   * Used by the post-stream validator's preview-restart recovery: after
   * asking dev-supervisor to restart the preview process, we wait for
   * the new preview's `error-client.ts` to emit its initial cycle
   * beacon (which rotates the buffer's cycleId) before re-polling
   * runtime errors. Resolving early matters because dev-server boot
   * time varies widely across cold vs warm dep graphs; a fixed sleep
   * would either be wasteful most of the time or truncate cold boots.
   *
   * Honors `opts.signal` — an abort resolves immediately with
   * `advanced: false` rather than throwing, so the caller can fall
   * through to its existing cleanup path without special-casing abort
   * in a try/catch.
   *
   * `previousCycleId` may be `undefined` (preview never announced a
   * cycle before the restart — e.g. restart fires on the very first
   * turn). In that case *any* non-undefined cycleId counts as an
   * advance.
   */
  async waitForCycleAdvance(
    appId: string,
    previousCycleId: number | undefined,
    opts: { timeoutMs: number; signal?: AbortSignal }
  ): Promise<CycleAdvanceResult> {
    const begin = Date.now();

    if (opts.signal?.aborted) {
      return { advanced: false, durationMs: 0 };
    }

    while (true) {
      const current = runtimeErrorBuffer.getCurrentCycleId(appId);
      if (current !== undefined && current !== previousCycleId) {
        return {
          advanced: true,
          newCycleId: current,
          durationMs: Date.now() - begin
        };
      }

      const elapsed = Date.now() - begin;
      if (elapsed >= opts.timeoutMs) {
        return { advanced: false, durationMs: elapsed };
      }

      if (opts.signal?.aborted) {
        return { advanced: false, durationMs: elapsed };
      }

      const remaining = opts.timeoutMs - elapsed;
      const sleepMs = Math.min(CYCLE_WAIT_POLL_INTERVAL_MS, remaining);
      await sleepOrAbort(sleepMs, opts.signal);
    }
  }

  async pollRuntimeErrors(
    appId: string,
    options: {
      maxWaitMs?: number;
      quietWindowMs?: number;
      signal?: AbortSignal;
      /**
       * Optional Set for caller-side dedup. When omitted, the service
       * mints a fresh Set scoped to this single `pollRuntimeErrors`
       * call so its 250ms polling loop doesn't double-count buffered
       * entries across consecutive drains. Present mainly for tests
       * and any future caller that wants to share dedup state across
       * calls.
       */
      seenSignatures?: Set<string>;
    }
  ): Promise<RuntimeErrorResult> {
    const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    const quietWindowMs = options.quietWindowMs ?? DEFAULT_QUIET_WINDOW_MS;

    if (options.signal?.aborted) {
      return { ok: true, errors: [], skipped: true, reason: 'aborted' };
    }

    const begin = Date.now();
    const seenSignatures = options.seenSignatures ?? new Set<string>();
    const errors: RuntimeErrorEntry[] = [];
    let lastNewErrorAt = 0;

    while (true) {
      if (options.signal?.aborted) {
        return {
          ok: true,
          errors,
          skipped: true,
          reason: 'aborted',
          durationMs: Date.now() - begin
        };
      }

      const fresh = runtimeErrorBuffer.drainForTurn(appId, { seenSignatures });
      if (fresh.length > 0) {
        errors.push(...fresh);
        lastNewErrorAt = Date.now();
      }

      const elapsed = Date.now() - begin;

      if (errors.length > 0 && Date.now() - lastNewErrorAt >= quietWindowMs) {
        return { ok: false, errors, durationMs: elapsed };
      }

      if (elapsed >= maxWaitMs) {
        if (errors.length > 0) {
          return { ok: false, errors, durationMs: elapsed };
        }
        return { ok: true, errors: [], durationMs: elapsed };
      }

      await sleepOrAbort(POLL_INTERVAL_MS, options.signal);
    }
  }
}

async function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

