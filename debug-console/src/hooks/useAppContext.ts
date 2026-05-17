'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Client-side cache + fetcher for `/api/app-context`.
 *
 * The Dashboard fires this on every appId / timeRange / refresh change, and
 * the server-side fan-out is the dominant fetch storm. Caching the response
 * client-side cuts both per-load fetches (the hook short-circuits on cache
 * hits) and the magnifying effect of switching between apps and back.
 *
 * Cache scope: module-level Map. Survives in-SPA navigation but not full
 * page reload, which is the right blast radius — a hard reload should
 * revalidate, casual tab-switching should not.
 *
 * Sections: callers opt into the slices they need (`['metadata', 'errors']`).
 * The cache key folds sections in alphabetical order so two callers asking
 * for the same set hit the same entry regardless of array order.
 */

export type AppContextSection = 'metadata' | 'activity' | 'errors' | 'traces';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const TTL_MS = 60_000;
const MAX_ENTRIES = 50;

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

function cacheKey(appId: string, timeRange: string, sections: readonly AppContextSection[]): string {
  const sortedSections = [...sections].sort().join(',');
  return `${appId}:${timeRange}:${sortedSections}`;
}

function readCache<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() >= hit.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function writeCache<T>(key: string, value: T): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

/**
 * Drop cached responses for `appId` (any timeRange, any section combination).
 * Called when the user hits the manual refresh button so they always see
 * a fresh fetch on demand.
 */
export function invalidateAppContextCache(appId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${appId}:`)) cache.delete(key);
  }
}

interface UseAppContextOptions<T> {
  appId: string | null;
  timeRange: string;
  sections: readonly AppContextSection[];
  /** Bumping this forces a refetch + cache bypass (e.g. user clicked refresh). */
  refreshKey?: number;
  /** Optional response shaper — runs once per fetch, NOT per re-render. */
  parse?: (raw: unknown) => T;
}

interface UseAppContextResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useAppContext<T = unknown>({
  appId,
  timeRange,
  sections,
  refreshKey = 0,
  parse,
}: UseAppContextOptions<T>): UseAppContextResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `parse` is held in a ref so the fetch effect doesn't re-run when callers
  // pass a fresh closure on every render.
  const parseRef = useRef(parse);
  parseRef.current = parse;

  // Memoize the sections array as a sorted, joined string so identity-only
  // changes don't retrigger the effect.
  const sectionsKey = [...sections].sort().join(',');

  useEffect(() => {
    if (!appId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const sortedSections = sectionsKey.split(',') as AppContextSection[];
    const key = cacheKey(appId, timeRange, sortedSections);
    const cached = readCache<T>(key);
    if (cached !== undefined && refreshKey === 0) {
      setData(cached);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // No AbortController on the shared fetch. Tying its lifetime to one
    // subscriber's controller meant: when a subscriber unmounted (e.g. user
    // navigates between tabs), the abort propagated to the SHARED promise
    // and any other coalesced subscribers fell into `.catch(AbortError)` —
    // surfacing a misleading "the operation was aborted" error in unrelated
    // tabs. Letting the fetch run to completion populates the cache for
    // free; each subscriber decides via a local `cancelled` flag whether to
    // commit the result to its own React state.
    let cancelled = false;

    const existingInFlight = inFlight.get(key);
    const promise = existingInFlight ?? (async () => {
      const params = new URLSearchParams();
      params.set('appId', appId);
      params.set('timeRange', timeRange);
      params.set('sections', sortedSections.join(','));
      const response = await fetch(`/api/app-context?${params}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch app context (${response.status})`);
      }
      const raw = await response.json();
      const value = parseRef.current ? parseRef.current(raw) : (raw as T);
      writeCache(key, value);
      return value;
    })();

    if (!existingInFlight) inFlight.set(key, promise);

    promise
      .then((value) => {
        if (cancelled) return;
        setData(value as T);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || 'Failed to fetch app context');
        setLoading(false);
      })
      .finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      });

    return () => {
      cancelled = true;
    };
  }, [appId, timeRange, sectionsKey, refreshKey]);

  return { data, loading, error };
}

/**
 * Test-only: clear the entire cache + in-flight maps so each test sees a
 * clean slate. Tests that share an `appId` would otherwise see leakage.
 */
export function __clearAppContextCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
