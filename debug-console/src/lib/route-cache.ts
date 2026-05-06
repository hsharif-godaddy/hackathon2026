type CacheEntry = { exp: number; val: unknown };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

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
