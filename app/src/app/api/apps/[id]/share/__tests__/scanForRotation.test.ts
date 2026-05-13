/**
 * Direct unit tests for `scanForRotation` — the pure freshness predicate
 * that the GET `/api/apps/[id]/share` handler consumes to decide whether
 * to fire the rotation POST.
 *
 * Route-level tests (route.test.ts) cover the wiring (rotation fires,
 * fallback on errors, log payloads). This file pins the discriminated-
 * union contract independent of the route — so a future refactor that
 * changes the scan's tag set surfaces directly here rather than via a
 * downstream rotation-doesn't-fire symptom.
 */
import { describe, expect, it } from 'vitest';

import {
  type AgentsTokenEntry,
  type FreshnessScanResult,
  scanForRotation,
} from '../rotation-helpers';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FUTURE = Date.now() + 7 * DAY_MS;
const PAST = Date.now() - HOUR_MS; // expired 1h ago

function isoMsAgo(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

describe('scanForRotation', () => {
  it('returns { kind: "noActiveTokens" } when the input list is empty', () => {
    const result = scanForRotation([], Date.now());
    expect(result).toEqual({ kind: 'noActiveTokens' });
  });

  it('returns { kind: "noActiveTokens" } when every token in the list is expired', () => {
    // No active tokens at all — initial-mint case, handled elsewhere.
    const tokens: AgentsTokenEntry[] = [
      { token: 'a', expiresAt: PAST, createdAt: isoMsAgo(DAY_MS + HOUR_MS) },
      { token: 'b', expiresAt: PAST - 1000, createdAt: isoMsAgo(2 * DAY_MS) },
    ];
    const result = scanForRotation(tokens, Date.now());
    expect(result).toEqual({ kind: 'noActiveTokens' });
  });

  it('returns { kind: "fresh" } when the freshest active token is within the freshness window', () => {
    const tokens: AgentsTokenEntry[] = [
      { token: 'a', expiresAt: FUTURE, createdAt: isoMsAgo(2 * HOUR_MS) },
    ];
    const result = scanForRotation(tokens, Date.now());
    expect(result).toEqual({ kind: 'fresh' });
  });

  it('returns { kind: "stale", freshestAgeMs } when the freshest active token is past the freshness window', () => {
    const tokens: AgentsTokenEntry[] = [
      { token: 'a', expiresAt: FUTURE, createdAt: isoMsAgo(25 * HOUR_MS) },
    ];
    const result = scanForRotation(tokens, Date.now());
    expect(result.kind).toBe('stale');
    if (result.kind === 'stale') {
      // freshestAgeMs is approximately 25h; allow a small drift for the
      // milliseconds spent between isoMsAgo and the inner Date.now() call.
      expect(result.freshestAgeMs).toBeGreaterThan(25 * HOUR_MS - 1000);
      expect(result.freshestAgeMs).toBeLessThan(25 * HOUR_MS + 1000);
    }
  });

  it('returns { kind: "stale" } at exactly the 24h boundary (uses isStaleByFreshness >= via the shared module)', () => {
    // Pin: rotation fires AT 24h, not just past it. A future change of
    // `>=` to `>` in the shared `isStaleByFreshness` would flip this.
    const tokens: AgentsTokenEntry[] = [
      { token: 'a', expiresAt: FUTURE, createdAt: isoMsAgo(DAY_MS) },
    ];
    const result = scanForRotation(tokens, Date.now());
    expect(result.kind).toBe('stale');
  });

  it('picks the freshest active token (by createdAt DESC) when multiple are active', () => {
    // After a previous rotation, both the old and new tokens are
    // simultaneously active. The scan must compare against the newer
    // one — otherwise rotation would fire perpetually while the older
    // token is still alive.
    const tokens: AgentsTokenEntry[] = [
      { token: 'old', expiresAt: FUTURE, createdAt: isoMsAgo(25 * HOUR_MS) }, // stale
      { token: 'new', expiresAt: FUTURE, createdAt: isoMsAgo(1000) },         // fresh
    ];
    const result = scanForRotation(tokens, Date.now());
    expect(result).toEqual({ kind: 'fresh' });
  });

  it('ignores expired tokens when finding the freshest createdAt (an expired-but-recent createdAt does not win)', () => {
    // Race-edge: a token that EXPIRED 1ms ago but has a fresh-looking
    // createdAt must NOT be considered when computing the freshest
    // active. The expiresAt filter gates inclusion in the scan.
    const tokens: AgentsTokenEntry[] = [
      // Recent createdAt but expired — must be filtered out.
      { token: 'expired-recent', expiresAt: PAST, createdAt: isoMsAgo(1000) },
      // 25h old but active — this is the freshest ACTIVE token, so we rotate.
      { token: 'stale-active', expiresAt: FUTURE, createdAt: isoMsAgo(25 * HOUR_MS) },
    ];
    const result = scanForRotation(tokens, Date.now());
    expect(result.kind).toBe('stale');
  });

  it('returns { kind: "noParseableCreatedAt", activeTokenCount } when active tokens exist but none have a usable createdAt', () => {
    // Older agents binary, schema drift, proxy stripped the field, etc.
    // The scan distinguishes this from "noActiveTokens" so the call site
    // can emit a dedicated warn (silent rotation-disable detection).
    const tokens: AgentsTokenEntry[] = [
      { token: 'a', expiresAt: FUTURE /* no createdAt */ },
      { token: 'b', expiresAt: FUTURE, createdAt: 'not a date' }, // NaN parse
      { token: 'c', expiresAt: FUTURE, createdAt: 1234567890 as unknown as string }, // wrong type
    ];
    const result = scanForRotation(tokens, Date.now());
    expect(result.kind).toBe('noParseableCreatedAt');
    if (result.kind === 'noParseableCreatedAt') {
      expect(result.activeTokenCount).toBe(3);
    }
  });

  it('activeTokenCount counts only active tokens (excludes expired ones)', () => {
    // The count is carried through into noParseableCreatedAt; should
    // not include expired tokens since they don't contribute to the
    // rotation-disable signal the operator is investigating.
    const tokens: AgentsTokenEntry[] = [
      { token: 'expired1', expiresAt: PAST /* no createdAt */ },
      { token: 'expired2', expiresAt: PAST /* no createdAt */ },
      { token: 'active', expiresAt: FUTURE /* no createdAt */ },
    ];
    const result = scanForRotation(tokens, Date.now()) as Extract<
      FreshnessScanResult,
      { kind: 'noParseableCreatedAt' }
    >;
    expect(result.kind).toBe('noParseableCreatedAt');
    expect(result.activeTokenCount).toBe(1);
  });

  it('handles a malformed token entry (missing expiresAt, non-number expiresAt)', () => {
    // Defensive narrowing per entry — a non-number expiresAt skips the
    // entry without throwing. If ALL entries are malformed in this way,
    // we get noActiveTokens (none passed the `> now` check at all).
    const tokens: AgentsTokenEntry[] = [
      { token: 'a' /* no expiresAt */ },
      { token: 'b', expiresAt: 'not a number' as unknown as number },
    ];
    const result = scanForRotation(tokens, Date.now());
    expect(result).toEqual({ kind: 'noActiveTokens' });
  });

  it('treats expiresAt === now as expired (uses > now strict comparison)', () => {
    // Pin: boundary at expiresAt. A token whose expiresAt is exactly
    // now is treated as already-expired (the equals case is on the
    // expired side). Without this pin, a future flip from `>` to `>=`
    // could let a just-now-expired token win the freshness scan.
    const now = Date.now();
    const tokens: AgentsTokenEntry[] = [
      { token: 'just-expired', expiresAt: now, createdAt: isoMsAgo(1000) },
    ];
    const result = scanForRotation(tokens, now);
    expect(result).toEqual({ kind: 'noActiveTokens' });
  });
});
