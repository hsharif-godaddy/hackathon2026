'use client';

import { useEffect, useState } from 'react';

/**
 * Fetch the resolved cluster id (e.g. `c38`) for an app id, with a small
 * module-level cache so a panel mount doesn't refetch what we already know.
 *
 * Returns a tri-state so callers can distinguish "still resolving" from
 * "resolved as null" (which happens for apps whose agent URL doesn't match
 * the expected `<appId>.<svc>.<cluster>.airoapp.ai` pattern, e.g. PaaS or
 * custom domains). The Logs tab uses this to render either the actual
 * `cluster="<id>"` label, a `<resolved>` placeholder while loading, or to
 * omit the cluster label entirely when resolution returns null.
 */

export type ClusterResolution =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'resolved'; cluster: string | null };

interface CacheEntry {
  cluster: string | null;
  expiresAt: number;
}

const TTL_MS = 5 * 60_000;
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string | null>>();

async function fetchCluster(appId: string): Promise<string | null> {
  const res = await fetch(`/api/cluster/${encodeURIComponent(appId)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data?.cluster === 'string' ? data.cluster : null;
}

function readCache(appId: string): string | null | undefined {
  const hit = cache.get(appId);
  if (!hit) return undefined;
  if (Date.now() >= hit.expiresAt) {
    cache.delete(appId);
    return undefined;
  }
  return hit.cluster;
}

export function useAppCluster(appId: string | undefined): ClusterResolution {
  const [resolution, setResolution] = useState<ClusterResolution>(() => {
    if (!appId) return { status: 'idle' };
    const cached = readCache(appId);
    if (cached !== undefined) return { status: 'resolved', cluster: cached };
    return { status: 'loading' };
  });

  useEffect(() => {
    if (!appId) {
      setResolution({ status: 'idle' });
      return;
    }

    const cached = readCache(appId);
    if (cached !== undefined) {
      setResolution({ status: 'resolved', cluster: cached });
      return;
    }

    let cancelled = false;
    setResolution({ status: 'loading' });
    const existing = inFlight.get(appId);
    const promise = existing
      ? existing
      : fetchCluster(appId)
          .catch(() => null)
          .finally(() => {
            inFlight.delete(appId);
          });
    if (!existing) inFlight.set(appId, promise);

    promise.then((value) => {
      // Always populate the cache — even after cancellation. The fetch
      // already happened, throwing the result away just forces the next
      // mount to re-fetch the same answer.
      cache.set(appId, { cluster: value, expiresAt: Date.now() + TTL_MS });
      if (cancelled) return;
      setResolution({ status: 'resolved', cluster: value });
    });

    return () => {
      cancelled = true;
    };
  }, [appId]);

  return resolution;
}
