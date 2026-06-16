/**
 * Shared constants for Playwright E2E tests
 */

declare const process: {
  env: Record<string, string | undefined>;
};

/** AI response timeout - 5 minutes for complex generation tasks */
export const AI_RESPONSE_TIMEOUT_MS = 300000;
/** Deployment timeout - 5 minutes for full deployment cycle */
export const DEPLOYMENT_TIMEOUT_MS = 300000;
/** Publish success timeout - 10 minutes (fqdn propagation can be slow) */
export const PUBLISH_TIMEOUT_MS = DEPLOYMENT_TIMEOUT_MS * 2;
/** Deployment status poll interval - check every 5 seconds */
export const DEPLOYMENT_POLL_INTERVAL_MS = 5000;
/** Default timeout for most assertions - 30 seconds */
export const DEFAULT_TIMEOUT = 30000;
/** Long timeout for navigation/page loads - 60 seconds */
export const LONG_TIMEOUT = 60000;
/** Preview iframe timeout - 3 minutes for initial app generation */
export const PREVIEW_TIMEOUT = 180000;
/** Chat input timeout - 2 minutes for AI to finish processing */
export const CHAT_INPUT_TIMEOUT = 120000;
/** Short timeout for quick visibility checks - 2 seconds */
export const SHORT_TIMEOUT = 2000;
/** SSO authentication timeout - 30 seconds for login flow */
export const SSO_TIMEOUT = 30000;
/** Go Live modal wait time - 20 seconds after publish */
export const GO_LIVE_MODAL_TIMEOUT = 20000;

/** Apps grid page size — must match app/src/app/[market]/apps/constants.ts */
export const APPS_GRID_PAGE_SIZE = 12;

/**
 * Hard cap enforced by mgmt-airo (returns HTTP 422 with errorCode
 * `APP_LIMIT_EXCEEDED` from `app/src/app/api/sites/quick-create/route.ts:147-152`
 * when create is attempted above this). The actual upstream limit is set by
 * mgmt-airo and not configured here; 80 is the effective cap we observe and
 * want to stay below in tests.
 */
export const MAX_TEST_APPS = 80;
/**
 * Headroom kept below {@link MAX_TEST_APPS} so parallel Playwright workers
 * don't race the cap. Eviction triggers when the test account holds at least
 * `(MAX_TEST_APPS - TEST_APP_BUFFER)` e2e-tagged apps.
 */
export const TEST_APP_BUFFER = 5;

/**
 * Skip both per-spec cleanup (afterEach `deleteAppsWithPrefix`) and the
 * pre-flight eviction guard (beforeEach `evictOldestE2eAppsToFitLimit`)
 * when this flag is set. Useful when iterating locally and you want the
 * created apps to survive so you can inspect them in the UI afterward.
 *
 * Wired via `--no-delete` in `scripts/e2e.sh`, which exports
 * `E2E_NO_DELETE=true`. The wrapper also defaults this to `true` for
 * `--env=local` and `--env=dev` (so devs don't lose their apps by
 * accident); CI environments (`pre-test`, `test`, `prod`) still clean
 * up unless the flag is explicitly negated.
 */
export const E2E_NO_DELETE = process.env.E2E_NO_DELETE === 'true';

/**
 * Environment configuration
 */
export type Environment = 'local' | 'dev' | 'pre-test' | 'test' | 'prod';

export interface EnvironmentConfig {
  baseUrl: string;
  usernameVar: string;
  passwordVar: string;
}

export const environments: Record<Environment, EnvironmentConfig> = {
  // `local` points at the local Gasket dev shell (see
  // .claude/skills/local-dev-browser/SKILL.md). Backed by the same SSO as test,
  // so LOCAL_USERNAME/LOCAL_PASSWORD typically match TEST_USERNAME/TEST_PASSWORD.
  local: {
    baseUrl: 'https://local.gasket.dev-godaddy.com:8443',
    usernameVar: 'LOCAL_USERNAME',
    passwordVar: 'LOCAL_PASSWORD',
  },
  dev: {
    baseUrl: 'https://airo-builder.dev-godaddy.com',
    usernameVar: 'DEV_USERNAME',
    passwordVar: 'DEV_PASSWORD',
  },
  'pre-test': {
    baseUrl: 'https://pre-test-airo-builder.test-godaddy.com',
    usernameVar: 'PRE_TEST_USERNAME',
    passwordVar: 'PRE_TEST_PASSWORD',
  },
  test: {
    baseUrl: 'https://airo-builder.test-godaddy.com',
    usernameVar: 'TEST_USERNAME',
    passwordVar: 'TEST_PASSWORD',
  },
  prod: {
    baseUrl: 'https://airo-builder.godaddy.com',
    usernameVar: 'PROD_USERNAME',
    passwordVar: 'PROD_PASSWORD',
  },
};

export function getEnvConfig(): { env: Environment; config: EnvironmentConfig } {
  const explicit = process.env.PLAYWRIGHT_ENV;
  const env = (explicit ?? 'test') as Environment;
  const config = environments[env];
  if (!config) {
    // Throw instead of silently remapping to `test`. A typo like --env=prd
    // would otherwise run the prod-strict assertions against the test env
    // and report misleading green/red signals. scripts/e2e.sh validates the
    // allowlist too; this is the second line of defense for callers that
    // set PLAYWRIGHT_ENV directly.
    throw new Error(
      `Unknown environment "${explicit}". Valid values: ${Object.keys(environments).join(', ')}.`,
    );
  }
  return { env, config };
}

export function getCredentials(): { username: string; password: string } {
  const { config } = getEnvConfig();
  // Prefer env-specific credentials (CI sets these per environment). Fall
  // back to generic E2E_USERNAME/E2E_PASSWORD so local dev can keep a single
  // pair in tests/.env that works for any --env target.
  //
  // Deliberately NOT named USERNAME/PASSWORD: process.env.USERNAME is set to
  // the OS login name on Linux (incl. GitHub-hosted runners, where it's
  // `runner`) and macOS, so a tests/.env entry would be silently overridden
  // by the shell — yielding a confusing SSO failure with no obvious cause.
  const username = process.env[config.usernameVar] || process.env.E2E_USERNAME;
  const password = process.env[config.passwordVar] || process.env.E2E_PASSWORD;

  if (!username || !password) {
    throw new Error(
      `${config.usernameVar}/${config.passwordVar} (or generic E2E_USERNAME/E2E_PASSWORD) ` +
        `environment variables must be set`,
    );
  }

  return { username, password };
}

const SALT_LENGTH = 6;

/**
 * The GitHub Actions run id (stable for the whole workflow run, including
 * across Playwright retries) and shard index. Used to seed a deterministic
 * per-spec salt in CI — see {@link getSpecPrefix}. Both are `undefined` locally.
 */
const CI_RUN_SEED = process.env.GITHUB_RUN_ID;
const SHARD_ID = process.env.SHARD ?? '1';

/**
 * Generate a random alphanumeric salt.
 * Prevents prompt collisions across parallel runs when no stable CI seed is
 * available (local dev, where retries are disabled anyway).
 */
function randomSalt(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < SALT_LENGTH; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Deterministic alphanumeric salt derived from a seed string (djb2 → base36).
 * Same seed always yields the same salt, so a Playwright retry (which runs in a
 * fresh worker process) computes the SAME app prefix as the first attempt and
 * its `afterEach` can delete the first attempt's orphaned app. The old
 * `Math.random` salt regenerated per process, so retried tests leaked apps
 * toward the `MAX_TEST_APPS` cap.
 */
function deterministicSalt(seed: string): string {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    // hash * 33 + charCode, kept in unsigned 32-bit range.
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).padStart(SALT_LENGTH, '0').slice(-SALT_LENGTH);
}

// Memoize salt per spec name so repeated calls within the same process return a
// stable prefix (important for cleanup/grouping). In CI the value is derived
// deterministically, so it is also stable ACROSS processes (i.e. across retries
// and across shards), which is what makes retry cleanup work.
const saltCache = new Map<string, string>();

/**
 * Get spec prefix for app naming (for parallel-safe execution).
 *
 * In CI the salt is seeded from `${spec}:${shard}:${GITHUB_RUN_ID}` so it is:
 * - stable across retries of the same spec (retry cleanup can reclaim orphans),
 * - unique per shard (a shard never matches a sibling shard's apps), and
 * - unique per workflow run (overlapping runs never delete each other's
 *   in-flight apps via prefix cleanup).
 * Locally (no `GITHUB_RUN_ID`, retries disabled) it falls back to a random salt.
 */
export function getSpecPrefix(specName: string): string {
  const name = specName.replace('.spec.ts', '').replace('.spec.js', '');
  if (!saltCache.has(name)) {
    const value = CI_RUN_SEED
      ? deterministicSalt(`${name}:${SHARD_ID}:${CI_RUN_SEED}`)
      : randomSalt();
    saltCache.set(name, value);
  }
  return `[e2e:${name}:${saltCache.get(name)}]`;
}
