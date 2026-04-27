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

/** Apps grid page size — must match app/src/app/apps/constants.ts */
export const APPS_GRID_PAGE_SIZE = 12;

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
  // Support both PLAYWRIGHT_ENV (preferred) and legacy CYPRESS_ENV.
  const explicit = process.env.PLAYWRIGHT_ENV || process.env.CYPRESS_ENV;
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

const SALT_LENGTH = 4;

/**
 * Generate a random alphanumeric salt.
 * Prevents prompt collisions across retries and parallel runs.
 */
function salt(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < SALT_LENGTH; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// Memoize salt per spec name so repeated calls within the same process
// return a stable prefix (important for cleanup/grouping). Retries run
// in a new worker process, so they naturally get a fresh salt.
const saltCache = new Map<string, string>();

/**
 * Get spec prefix for app naming (for parallel-safe execution)
 */
export function getSpecPrefix(specName: string): string {
  const name = specName.replace('.spec.ts', '').replace('.spec.js', '');
  if (!saltCache.has(name)) {
    saltCache.set(name, salt());
  }
  return `[e2e:${name}:${saltCache.get(name)}]`;
}
