import { logger } from '@/lib/request-context';
import { MailFlowClient } from './mail-flow-client';
import type { DkimStatusResponse } from './types';

const SOFT_TTL_MS = 5_000;
const MAX_STALE_MS = 15 * 60 * 1000;

// LRU upper bound. The cache is in-memory per BFF instance and only
// holds public DKIM status — no auth secrets. The bound exists to
// stop slow leaks in long-lived pods that serve many distinct customer
// domains over time. 2k entries × ~1 KiB per response ≈ 2 MiB worst case.
const MAX_ENTRIES = 2_000;

interface CacheEntry {
  data: DkimStatusResponse;
  fetchedAt: number;
}

// Map preserves insertion order, so re-inserting on access promotes
// to the most-recently-used position. When at MAX_ENTRIES, evict the
// oldest (first iterator value).
const cache = new Map<string, CacheEntry>();

// In-flight upstream requests, keyed by domain. Both the cold-miss path
// and the stale-revalidate path consult this map before issuing an
// upstream call so that N concurrent callers for the same domain share a
// single fetch instead of fanning out. Mirrors the refreshPromise pattern
// in dkim-cert-token.ts. Without this, opening N tabs that poll the
// same fresh domain would hit mail-flow N times at first paint and
// every revalidate.
const inflight = new Map<string, Promise<DkimStatusResponse>>();

const client = new MailFlowClient();

export function clearDkimCache(): void {
  cache.clear();
  inflight.clear();
}

function setEntry(key: string, entry: CacheEntry): void {
  // Re-insert pattern for LRU: delete + set bumps to most-recent position.
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= MAX_ENTRIES) {
    // Evict the least-recently-used entry (first in insertion order).
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, entry);
}

/**
 * Single-flight wrapper around `client.getDkimStatus`. Returns the
 * existing in-flight promise for `domain` if one is running, otherwise
 * starts a new fetch and registers it. The wrapper handles teardown
 * (delete from inflight) on both success and failure.
 *
 * Critical: callers MUST treat the returned promise as throwable.
 * If the upstream fetch rejects, this rejects too, and the caller
 * decides whether to swallow (revalidate path) or propagate
 * (cold-miss path).
 */
function fetchSingleFlight(domain: string): Promise<DkimStatusResponse> {
  const existing = inflight.get(domain);
  if (existing) return existing;

  const promise = (async (): Promise<DkimStatusResponse> => {
    try {
      return await client.getDkimStatus(domain);
    } finally {
      inflight.delete(domain);
    }
  })();

  inflight.set(domain, promise);
  return promise;
}

export async function getDkimStatusCached(domain: string): Promise<DkimStatusResponse> {
  const now = Date.now();
  const entry = cache.get(domain);

  if (entry) {
    const age = now - entry.fetchedAt;
    if (age < SOFT_TTL_MS) {
      // Bump LRU position even on hits so frequently-accessed domains
      // don't get evicted by a sweep of cold entries.
      setEntry(domain, entry);
      return entry.data;
    }
    // Past soft TTL — return stale and revalidate in background.
    // The revalidate path is itself single-flighted via fetchSingleFlight,
    // so N concurrent stale reads spawn at most one upstream call.
    void revalidate(domain);
    return entry.data;
  }

  // Hard miss — must fetch. Single-flight so a thundering-herd of
  // first-paint reads for the same new domain shares one upstream call.
  const data = await fetchSingleFlight(domain);
  setEntry(domain, { data, fetchedAt: Date.now() });
  return data;
}

async function revalidate(domain: string): Promise<void> {
  try {
    const data = await fetchSingleFlight(domain);
    setEntry(domain, { data, fetchedAt: Date.now() });
  } catch (err) {
    // Surface the failure so mail-flow outages produce log breadcrumbs
    // before the 15-min hard-eviction kicks in. Severity is warn (not
    // error) — we still serve cached data, callers don't see the gap.
    logger.warn('dkim.cache.revalidate.failed', {
      domain,
      error: err instanceof Error ? err.message : String(err),
    });
    const entry = cache.get(domain);
    if (entry && Date.now() - entry.fetchedAt > MAX_STALE_MS) {
      cache.delete(domain);
    }
  }
}
