import { logger } from '@/lib/logger';

type CacheEntry = { exp: number; val: unknown };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
const bgInFlight = new Set<string>();

/**
 * Scorecard-specific cache with stale-while-revalidate.
 * When bgRefreshMs milliseconds remain in the TTL a background refresh
 * fires so the next caller also gets a cache hit rather than waiting for
 * a cold fetch.
 */
export async function scorecardCached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  bgRefreshMs: number,
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now < hit.exp) {
    if (now > hit.exp - bgRefreshMs && !bgInFlight.has(key) && !inFlight.has(key)) {
      bgInFlight.add(key);
      void fn()
        .then((val) => { cache.set(key, { exp: Date.now() + ttlMs, val }); })
        .catch((err: unknown) => { logger.warn('scorecard.cache.bgRefresh.error', { key, error: err instanceof Error ? err.message : String(err) }); })
        .finally(() => { bgInFlight.delete(key); });
    }
    return hit.val as T;
  }

  const existing = inFlight.get(key);
  if (existing) return (await existing) as T;

  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const p = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  inFlight.set(key, p);

  void (async () => {
    try {
      const val = await fn();
      cache.set(key, { exp: Date.now() + ttlMs, val });
      resolve(val);
    } catch (err) {
      reject(err);
    } finally {
      inFlight.delete(key);
    }
  })();

  return p;
}

export function scorecardCachePeek<T>(key: string): T | null {
  const now = Date.now();
  const hit = cache.get(key);
  return hit && now < hit.exp ? (hit.val as T) : null;
}

export function scorecardCacheSet(key: string, ttlMs: number, val: unknown): void {
  cache.set(key, { exp: Date.now() + ttlMs, val });
}
