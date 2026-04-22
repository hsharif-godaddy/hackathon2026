/**
 * In-memory runtime-error buffer (per appId) consumed by the post-stream
 * validator's runtime phase.
 *
 * Ingestion flow: the builder parent `app/` forwards `error-fix-request`
 * payloads through `agentFetch` to the authenticated
 * `POST /apps/:id/runtime-errors` endpoint, which calls `push()` here.
 *
 * Turn-aware semantics live in the caller (`runRuntimeErrorPhase`):
 * - Per-socket turn watermark (`since`) — callers filter out entries
 *   pushed before the start of the current iteration's window. The
 *   validator advances this after every iteration that surfaces errors,
 *   which is what prevents previously-reported (and possibly resolved)
 *   errors from being re-fed to the agent on the next iteration while
 *   still allowing genuine re-throws (which get fresh `pushedAt` stamps)
 *   to surface.
 * - Optional in-call `seenSignatures` — used by `RuntimeErrorService`
 *   internally so its 250ms polling loop doesn't double-count the same
 *   buffered entry across consecutive drains within one poll. Not used
 *   for cross-iteration dedup.
 *
 * This module just stores entries and offers a non-destructive filter.
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
 * Kept short on purpose — cross-iteration dedup is handled by the
 * validator advancing its `since` watermark after every iteration that
 * surfaces errors, so this only needs to absorb the tight same-frame
 * flood, not multi-second retry cycles. Once the window elapses, a fresh
 * push appends a new entry whose `pushedAt > advanced watermark`, which
 * is exactly how unfixed errors get re-surfaced on the next iteration.
 */
const PUSH_DEDUP_WINDOW_MS = 2000;

/**
 * Result of a `push()` call. Exposed primarily for tests and logging —
 * the HTTP route responds 204 regardless so the preview never sees state.
 */
export type PushResult = 'accepted' | 'deduped' | 'dropped';

interface BufferedEntry {
  entry: RuntimeErrorEntry;
  /** `Date.now()` at push. Caller-provided `since` is compared against this. */
  pushedAt: number;
  signature: string;
}

/**
 * Options for `drainForTurn`.
 *
 * The buffer is append-only from the caller's POV; `drainForTurn` does
 * not remove entries. This matters when multiple sockets share the same
 * appId (e.g. two builder tabs open at once) — each socket maintains
 * its own iteration window via `since`, and one socket draining does
 * not starve another.
 */
export interface DrainOptions {
  /**
   * Millisecond epoch. Entries pushed before this are ignored. Callers
   * set this to the current turn's start timestamp so pre-turn errors
   * (e.g. a lingering crash loop from before the user sent a new message)
   * do not surface into an unrelated turn.
   */
  since: number;

  /**
   * Mutable set of signatures the caller has already reported to its
   * agent. `drainForTurn` skips entries whose signature is in the set,
   * and adds returned signatures to it as a side-effect.
   */
  seenSignatures: Set<string>;
}

export class RuntimeErrorBuffer {
  private byApp: Map<string, BufferedEntry[]> = new Map();

  /**
   * Append a runtime error for `appId`. Returns:
   *   - `'deduped'` — a matching signature was pushed within
   *     `PUSH_DEDUP_WINDOW_MS`; the entry was folded into the existing
   *     one (the pushedAt timestamp is refreshed so the dedup window
   *     keeps sliding while the crash loop continues).
   *   - `'accepted'` — new entry stored.
   *   - `'dropped'` — invalid shape (defensive; the route validates first).
   *
   * Side-effects:
   *   - Evicts the oldest entry when the buffer would exceed `MAX_PER_APP`.
   */
  push(appId: string, entry: RuntimeErrorEntry): PushResult {
    if (!appId || typeof appId !== 'string') {
      return 'dropped';
    }
    if (typeof entry?.message !== 'string' || typeof entry?.name !== 'string') {
      return 'dropped';
    }

    const signature = runtimeErrorSignature(entry);
    const now = Date.now();

    let bucket = this.byApp.get(appId);
    if (!bucket) {
      bucket = [];
      this.byApp.set(appId, bucket);
    }

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
        existing.pushedAt = now;
        return 'deduped';
      }
    }

    bucket.push({ entry, pushedAt: now, signature });

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
   * Non-destructive read. Returns entries for `appId` with
   * `pushedAt >= since` and signature not in `seenSignatures`, in push
   * order. Mutates `seenSignatures` to include every returned entry's
   * signature so subsequent drains (same caller, later iteration in the
   * same turn) won't re-surface them.
   */
  drainForTurn(appId: string, opts: DrainOptions): RuntimeErrorEntry[] {
    const bucket = this.byApp.get(appId);
    if (!bucket || bucket.length === 0) {
      return [];
    }

    const out: RuntimeErrorEntry[] = [];
    for (const record of bucket) {
      if (record.pushedAt < opts.since) continue;
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
  }
}

/**
 * Process-wide singleton. The HTTP route and the post-hook service both
 * reach for this directly — they're conceptually one pipeline split
 * across transports, and there's no per-request state to scope.
 */
export const runtimeErrorBuffer = new RuntimeErrorBuffer();
