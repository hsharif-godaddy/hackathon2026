/**
 * Pool-app id cache — shared between the `pool-resolve` setup project and the
 * `e2e-v2` specs that depend on it.
 *
 * Why this exists: at workers=4 every spec's `beforeAll` used to call
 * `getPoolAppId` (a `GET /api/sites`) near-simultaneously — a concurrent burst
 * against a heavy endpoint that the test env's origin serves one-at-a-time,
 * 504ing the rest (and synchronized retries just re-collide). The
 * `pool-resolve` setup project now resolves every pool id ONCE, serially, and
 * writes them here; specs read the file (no network) in `beforeAll`. That
 * turns up-to-~20 `/api/sites` calls per run into ~2 serial ones, eliminating
 * the burst and minimizing exposure to an unstable endpoint.
 *
 * The cache is env-scoped: a run is always a single `PLAYWRIGHT_ENV`, and the
 * setup project overwrites the file at the start of every run, so it is always
 * fresh for the current env. `readPoolCache` returns null on a cross-env
 * mismatch (a stale file from a prior different-env run) so callers fail loud
 * rather than use the wrong env's ids.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Repo-relative, gitignored. Deliberately NOT under `test-results/`: Playwright
 * clears the output dir, which could race the file the setup project wrote.
 */
const POOL_CACHE_PATH: string = path.resolve(__dirname, '../.pool-cache.json');

interface PoolCache {
  /** PLAYWRIGHT_ENV the ids were resolved against (local/dev/pre-test/test/prod). */
  env: string;
  /** ISO8601 resolve time — for debugging a stale cache. */
  resolvedAt: string;
  /** purpose (e.g. "develop-ui") → resolved pool app id. */
  ids: Record<string, string>;
}

export function writePoolCache(env: string, ids: Record<string, string>): void {
  const data: PoolCache = { env, resolvedAt: new Date().toISOString(), ids };
  fs.writeFileSync(POOL_CACHE_PATH, JSON.stringify(data, null, 2));
}

/** Returns the cache for `env`, or null if missing/unreadable/cross-env stale. */
export function readPoolCache(env: string): PoolCache | null {
  try {
    const data = JSON.parse(fs.readFileSync(POOL_CACHE_PATH, 'utf8')) as PoolCache;
    if (data.env !== env) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Read a pool app id from the cache. Throws a clear hint if the cache is
 * missing or doesn't contain the purpose — which means the `pool-resolve`
 * setup project didn't run (or bootstrap-pool never seeded the app). Specs
 * reach pool apps through the `e2e-v2` project, which declares
 * `dependencies: ['pool-resolve']`, so the setup always runs first.
 */
export function getCachedPoolAppId(env: string, purpose: string): string {
  const cache = readPoolCache(env);
  const id = cache?.ids[purpose];
  if (!id) {
    throw new Error(
      `No cached pool app id for "${purpose}" (env=${env}) at ${POOL_CACHE_PATH}. ` +
        `The pool-resolve setup project should populate it before e2e-v2 runs — ` +
        `run via \`--project=e2e-v2\` (which depends on pool-resolve). If resolve ` +
        `failed, ensure bootstrap-pool has created the pool apps for this env: ` +
        `\`pnpm exec playwright test --project=bootstrap-pool --env=${env}\`.`,
    );
  }
  return id;
}
