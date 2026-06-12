/**
 * pool-resolve — setup project that resolves every e2e-v2 pool app id ONCE per
 * run and caches them to disk. The `e2e-v2` project declares
 * `dependencies: ['pool-resolve']`, so Playwright runs this to completion
 * before any e2e-v2 spec starts.
 *
 * Why: at workers=4 each spec's `beforeAll` previously called `getPoolAppId`
 * (a `GET /api/sites`) near-simultaneously. The test env serves that heavy
 * endpoint one-at-a-time and 504s a concurrent burst (and synchronized retries
 * re-collide). Resolving here — once, serially, in a single worker — removes
 * the burst entirely; specs then read the cached ids with no network. See
 * tests/helpers/pool-cache.ts and REFACTOR_PLAN.md PR 4 design notes.
 *
 * This is distinct from `bootstrap-pool` (tests/pool-setup/), which CREATES
 * the pool apps and is run manually/occasionally. pool-resolve only LOOKS THEM
 * UP, and runs every e2e-v2 run. If a pool app is missing, `getPoolAppId`
 * throws its "run bootstrap-pool" hint here, failing setup (and skipping
 * e2e-v2) with a clear message.
 */
import { test as setup } from '../helpers/test-fixtures';

import { getPoolAppId } from '../helpers/api';
import { loginViaSsoDirect } from '../helpers/auth';
import { getEnvConfig } from '../helpers/constants';
import { writePoolCache } from '../helpers/pool-cache';
import { dismissOverlays } from '../helpers/ui';

/** Every purpose any e2e-v2 spec looks up via getCachedPoolAppId. */
const POOL_PURPOSES: readonly string[] = ['develop-ui', 'publish-domain'];

const { env } = getEnvConfig();

setup('resolve e2e-v2 pool app ids', async ({ page }) => {
  // One login + a serial GET /api/sites per purpose. No app creation.
  setup.setTimeout(180_000);

  // Authenticate on the standalone SSO page, then land on the app host so
  // getPoolAppId's GET /api/sites runs same-origin and authenticated.
  await loginViaSsoDirect(page);
  await page.goto('/');
  await dismissOverlays(page);

  const ids: Record<string, string> = {};
  for (const purpose of POOL_PURPOSES) {
    // Serial (not Promise.all) on purpose — the whole point is to NOT hit
    // /api/sites concurrently. getPoolAppId is retry-protected for blips.
    ids[purpose] = await getPoolAppId(page, purpose);
    console.log(`  resolved pool "${purpose}": ${ids[purpose]}`);
  }

  writePoolCache(env, ids);
  console.log(`  wrote pool cache: ${POOL_PURPOSES.length} ids (env=${env})`);
});
