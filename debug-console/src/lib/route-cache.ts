type CacheEntry = { exp: number; val: unknown };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Manually seed (or overwrite) a route-cache entry. Used by force-refresh
 * paths that already paid the cost of computing the fresh value: writing
 * back means concurrent dashboard readers landing on the same key see the
 * fresh value immediately instead of the stale entry sitting in cache
 * until its natural TTL expires. Without this, the force-refresh fixes
 * the clicker's view but other operators on the same app keep reading
 * stale data for up to ttlMs.
 */
export function setRouteCache<T>(key: string, val: T, ttlMs: number): void {
  cache.set(key, { exp: Date.now() + ttlMs, val });
}

export async function routeCached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now < hit.exp) {
    return hit.val as T;
  }

  const existing = inFlight.get(key);
  if (existing) {
    return (await existing) as T;
  }

  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const p = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
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
