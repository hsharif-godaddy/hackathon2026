/**
 * In-memory runtime-error buffer (per appId) consumed by the post-stream
 * validator's runtime phase.
 *
 * Ingestion flow: the builder parent `app/` forwards `error-fix-request`
 * payloads through `agentFetch` to the authenticated
 * `POST /apps/:id/runtime-errors` endpoint, which calls `push()` here.
 *
 * ## Cycle-based freshness
 *
 * Every runtime-error POST is tagged with a monotonic `cycleId` that
 * advances on every preview render generation — one per Vite HMR
 * boundary (`vite:beforeUpdate`), one per full page reload, and one on
 * initial load. A separate `POST /apps/:id/runtime-errors/cycle` endpoint
 * tells the server the preview has started a new render generation; the
 * server then treats any buffered entry from an earlier generation as
 * stale and drops it. This is the core mechanism that prevents "ghost"
 * errors — a mid-turn intermediate edit throws, a later edit in the same
 * turn fixes it, but the ghost entry survives to the next validator
 * drain — because the signal comes from the preview, which is the only
 * component that knows "the current render is clean."
 *
 * The cycle rotation does two things atomically in `rotateCycle`:
 *   1. Advances `currentCycleIdByApp[appId]` to `max(current, incoming)`
 *      (a stale rotation POST that arrives out of order is a no-op).
 *   2. Evicts buffered entries whose `cycleId < new current`.
 *
 * `push()` honours the same comparison:
 *   - A payload without a `cycleId` is malformed; dropped.
 *   - If `cycleId < currentCycleId` → dropped as stale. Late-arriving
 *     POST from an already-superseded cycle.
 *   - If `cycleId > currentCycleId` → advance current + prune, then
 *     store. Handles the race where the browser has already bumped its
 *     own cycleId and started reporting errors under it before the
 *     corresponding cycle POST landed at the server.
 *   - If equal → store.
 *
 * Entries live in the buffer only for the current render generation. A
 * genuinely unfixed error will be re-thrown on the next render after
 * HMR (which bumps to a new cycle and re-pushes), so stripping
 * mid-turn entries does not hide anything real.
 */

import { logger } from '../logging/index.js';

/**
 * A single runtime error captured from the preview browser. Shape matches
 * the `RuntimeErrorData` the dev-tools client posts via `postMessage` and
 * the UI context renderer — keep in sync with both.
 */
export interface RuntimeErrorEntry {
  message: string;
  name: string;
  stack?: string;
  componentStack?: string;
  url?: string;
  timestamp: number;
}

/**
 * Stable signature for a runtime error payload. Used for push-time dedup
 * (React crash loops re-render the same error every frame) and for the
 * `RuntimeErrorService` polling loop's in-call dedup.
 *
 * The third component is the first call-site frame, not the first
 * non-empty stack line. V8-shaped stacks start with a `${name}: ${message}`
 * line that duplicates the first two components, leaving the signature
 * with no real discriminator — two distinct call sites throwing the same
 * `TypeError: x is undefined` would hash identically. Frame detection
 * covers both V8 (`at foo (file:line)`) and Firefox/WebKit
 * (`foo@file:line`) formats, with a fallback to the first line for
 * degenerate stacks that don't contain either.
 */
export function runtimeErrorSignature(entry: RuntimeErrorEntry): string {
  const lines = (entry.stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  // Prefer V8 (`at foo (file:line)`) frames; if none, fall back to
  // Firefox/WebKit (`name@file:line`) frames anchored at the start of the
  // trimmed line so messages with embedded emails or URLs
  // (`Error: reach us at foo@bar.com:5`) don't masquerade as frames.
  // Final fallback is the first line of the stack, to at least give the
  // signature *some* discriminator for degenerate stacks.
  const firstFrame =
    lines.find((l) => l.startsWith('at ')) ??
    lines.find((l) => /^\S+@\S+:\d+/.test(l)) ??
    lines[0] ??
    '';
  return `${entry.name}::${entry.message}::${firstFrame}`;
}

/**
 * Maximum entries retained per appId. Beyond this, oldest entries are
 * evicted FIFO. 50 is well above what a healthy turn produces (typical is
 * 1–3) but low enough that a pathological crash loop can't exhaust memory.
 */
const MAX_PER_APP = 50;

/**
 * Push-time dedup window. The preview posts the same error once per React
 * re-render during a crash loop; collapsing those into a single buffered
 * entry keeps the buffer shallow and the prompt clean.
 *
 * Entries from prior cycles are already evicted on cycle rotation, so
 * this window only ever needs to collapse the in-cycle same-frame flood.
 */
const PUSH_DEDUP_WINDOW_MS = 2000;

/**
 * Result of a `push()` call. Exposed primarily for tests and logging —
 * the HTTP route responds 204 regardless so the preview never sees state.
 *
 * - `'accepted'` — new entry stored.
 * - `'deduped'` — signature match within `PUSH_DEDUP_WINDOW_MS`, existing
 *    record refreshed in-place.
 * - `'stale'` — `cycleId` older than the app's current cycle; the
 *    preview has already moved on and this POST is a late-arriving
 *    artifact from a superseded render.
 * - `'dropped'` — invalid shape (missing `cycleId`, non-finite values,
 *    missing required fields).
 */
export type PushResult = 'accepted' | 'deduped' | 'dropped' | 'stale';

interface BufferedEntry {
  entry: RuntimeErrorEntry;
  /** `Date.now()` at push. Used only for the in-cycle push-dedup window. */
  pushedAt: number;
  signature: string;
  /**
   * Invariant: always equals `currentCycleIdByApp[appId]` while this
   * record is in the bucket. `rotateCycleInternal` evicts any record
   * that would violate this on advance, and `push` auto-rotates before
   * appending, so the bucket is homogeneous in `cycleId` at every
   * observable moment. `drainForTurn`'s `record.cycleId !== current`
   * check is defensive against future paths that might skip rotation.
   */
  cycleId: number;
}

/**
 * Options for `drainForTurn`. The buffer is append-only from the caller's
 * POV; `drainForTurn` does not remove entries. This matters when multiple
 * sockets share the same appId (e.g. two builder tabs open at once) —
 * each socket maintains its own `seenSignatures` so one socket draining
 * does not starve another.
 */
export interface DrainOptions {
  /**
   * Mutable set of signatures the caller has already returned from a
   * prior drain in the same polling session. `drainForTurn` skips
   * entries whose signature is in the set and adds returned signatures
   * to it as a side-effect. Used by `RuntimeErrorService.pollRuntimeErrors`
   * to avoid double-counting within its 250ms polling loop.
   *
   * Cross-turn dedup is handled by cycle rotation — once a new cycle
   * starts, entries from earlier cycles are evicted, so the agent
   * doesn't need to remember what it reported on a prior turn.
   */
  seenSignatures: Set<string>;
}

export class RuntimeErrorBuffer {
  private byApp: Map<string, BufferedEntry[]> = new Map();

  /**
   * Current cycle generation per app. Unset for apps whose preview
   * hasn't announced a cycle yet (window between dev-tools load and the
   * first cycle POST landing). Once set, every push must carry a
   * `cycleId` `>= current`; stale pushes are dropped.
   */
  private currentCycleIdByApp: Map<string, number> = new Map();

  /**
   * Append a runtime error for `appId`. Returns:
   *   - `'dropped'` — invalid shape: missing/non-string `message`/`name`,
   *     missing/non-finite `cycleId`, or missing `appId`.
   *   - `'stale'` — `cycleId` older than the app's current cycle.
   *   - `'deduped'` — a matching signature was pushed within
   *     `PUSH_DEDUP_WINDOW_MS`; the entry was folded into the existing
   *     one (the pushedAt timestamp is refreshed so the dedup window
   *     keeps sliding while the crash loop continues).
   *   - `'accepted'` — new entry stored.
   *
   * Side-effects:
   *   - If `cycleId` is strictly greater than the app's current cycleId,
   *     advances the app's current cycleId and evicts entries tagged
   *     with the previous one. Covers the race where the preview has
   *     bumped its own cycle and started reporting under it before the
   *     `/cycle` POST reached the server.
   *   - Evicts the oldest entry when the buffer would exceed `MAX_PER_APP`.
   */
  push(appId: string, entry: RuntimeErrorEntry, cycleId: number): PushResult {
    if (!appId || typeof appId !== 'string') {
      return 'dropped';
    }
    if (typeof entry?.message !== 'string' || typeof entry?.name !== 'string') {
      return 'dropped';
    }
    if (typeof cycleId !== 'number' || !Number.isFinite(cycleId)) {
      return 'dropped';
    }

    const current = this.currentCycleIdByApp.get(appId);
    if (current !== undefined && cycleId < current) {
      return 'stale';
    }
    if (current === undefined || cycleId > current) {
      // Advance and prune. A push with a newer cycleId than the server
      // has yet heard about is itself evidence the preview has moved
      // on; treat it as a de-facto cycle rotation.
      this.rotateCycleInternal(appId, cycleId);
    }

    const signature = runtimeErrorSignature(entry);

    let bucket = this.byApp.get(appId);
    if (!bucket) {
      bucket = [];
      this.byApp.set(appId, bucket);
    }

    const now = Date.now();

    // Push-time dedup: if we've seen this exact signature recently, refresh
    // the existing record rather than appending. We scan from the tail
    // because dedupes are overwhelmingly the most-recent entry.
    //
    // We walk the full bucket instead of breaking on the first expired
    // entry. `existing.pushedAt = now` refreshes in place without
    // re-ordering, so the bucket is *not* monotonic in `pushedAt` — an
    // earlier-index entry whose timestamp was bumped can sit before a
    // later-index entry that's still at its original timestamp. A
    // tail-walk-with-early-break would skip over that refreshed entry and
    // append a duplicate record with the same signature. Iterating all
    // ≤MAX_PER_APP=50 entries is trivially cheap and preserves the
    // invariant that at most one record per signature exists inside the
    // dedup window.
    for (let i = bucket.length - 1; i >= 0; i--) {
      const existing = bucket[i]!;
      if (now - existing.pushedAt > PUSH_DEDUP_WINDOW_MS) {
        continue;
      }
      if (existing.signature === signature) {
        // Only `pushedAt` needs refreshing. `cycleId` is left alone
        // because the auto-rotation above already ensures every
        // bucket entry has `cycleId === current` — the existing
        // record and the incoming push share the same cycle by the
        // time we reach this loop.
        existing.pushedAt = now;
        return 'deduped';
      }
    }

    bucket.push({ entry, pushedAt: now, signature, cycleId });

    if (bucket.length > MAX_PER_APP) {
      const dropped = bucket.shift();
      logger.warn('runtime_error_buffer.evicted', {
        appId,
        droppedSignature: dropped?.signature,
        size: bucket.length
      });
    }

    return 'accepted';
  }

  /**
   * Rotate the app's current cycle generation. Called by the route
   * handler for `POST /apps/:id/runtime-errors/cycle`.
   *
   * Semantics:
   *   - Advances to `max(current, cycleId)`. A cycle POST that arrives
   *     out of order (stale) is a no-op — the server already saw a
   *     newer cycle, there's nothing to do.
   *   - Evicts buffered entries whose `cycleId` is strictly less than
   *     the new current. Entries at the new current stay.
   */
  rotateCycle(appId: string, cycleId: number): void {
    if (!appId || typeof cycleId !== 'number' || !Number.isFinite(cycleId)) {
      return;
    }
    this.rotateCycleInternal(appId, cycleId);
  }

  private rotateCycleInternal(appId: string, cycleId: number): void {
    const current = this.currentCycleIdByApp.get(appId);
    const next = current === undefined ? cycleId : Math.max(current, cycleId);
    if (current !== undefined && next === current) {
      return;
    }
    this.currentCycleIdByApp.set(appId, next);

    const bucket = this.byApp.get(appId);
    if (!bucket || bucket.length === 0) {
      return;
    }
    let kept = 0;
    for (const record of bucket) {
      if (record.cycleId < next) {
        continue;
      }
      bucket[kept++] = record;
    }
    bucket.length = kept;
  }

  /**
   * Current cycle generation for `appId`, or `undefined` if never set.
   * Exposed for tests and for the route handler's logging.
   */
  getCurrentCycleId(appId: string): number | undefined {
    return this.currentCycleIdByApp.get(appId);
  }

  /**
   * Non-destructive read. Returns entries for `appId` from the app's
   * current cycle only, in push order. Mutates `seenSignatures` to
   * include every returned entry's signature so subsequent drains in
   * the same polling session (typically `RuntimeErrorService`'s 250ms
   * poll loop) won't re-surface them.
   *
   * Returns `[]` when:
   *   - The app has no bucket yet (nothing ever pushed).
   *   - The app has no cycle yet (no cycle POST has landed, so we can't
   *     determine what's fresh). The preview's initial cycle beacon
   *     closes this window within the first ms of dev-tools load.
   */
  drainForTurn(appId: string, opts: DrainOptions): RuntimeErrorEntry[] {
    const bucket = this.byApp.get(appId);
    if (!bucket || bucket.length === 0) {
      return [];
    }
    const current = this.currentCycleIdByApp.get(appId);
    if (current === undefined) {
      return [];
    }

    const out: RuntimeErrorEntry[] = [];
    for (const record of bucket) {
      // Cycle rotation eagerly prunes stale entries, so this check is
      // belt-and-suspenders — in steady state every bucket entry has
      // `cycleId === current`. It costs nothing and defends against
      // any future path that skips the rotation.
      if (record.cycleId !== current) continue;
      if (opts.seenSignatures.has(record.signature)) continue;
      opts.seenSignatures.add(record.signature);
      out.push(record.entry);
    }
    return out;
  }

  /**
   * Current size for `appId` (for tests and internal logging).
   */
  size(appId: string): number {
    return this.byApp.get(appId)?.length ?? 0;
  }

  /**
   * Clear all state. Tests only.
   */
  _resetForTests(): void {
    this.byApp.clear();
    this.currentCycleIdByApp.clear();
  }
}

/**
 * Process-wide singleton. The HTTP route and the post-hook service both
 * reach for this directly — they're conceptually one pipeline split
 * across transports, and there's no per-request state to scope.
 */
export const runtimeErrorBuffer = new RuntimeErrorBuffer();
