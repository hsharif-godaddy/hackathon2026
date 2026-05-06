import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

import { getEnvConfig } from './tests/helpers/constants';

// Load test environment variables from tests/.env. getEnvConfig() reads
// process.env lazily at call time, so values from .env are picked up below.
dotenv.config({ path: path.resolve(__dirname, 'tests/.env') });

const { env: envName, config: envConfig } = getEnvConfig();

/**
 * CI runners resolve `sso.test-godaddy.com` to an internal VIP, so Chrome's
 * Local Network Access check blocks the cross-origin heartbeat POST from
 * `airo-builder.test-godaddy.com` (classified public) to SSO (classified
 * local). Heartbeats silently fail, the VAT ages out, and mid-run 401s
 * redirect the page to SSO. Real users hit this from public DNS where both
 * hosts are public→public, so LNA doesn't trip. Scope the flag to `test` and
 * `pre-test` (same DNS zone, same internal-VIP routing on CI) — never disable
 * it against prod.
 */
const LNA_DISABLED_ENVS: readonly string[] = ['test', 'pre-test'];
const launchOptions = LNA_DISABLED_ENVS.includes(envName)
  ? {
      args: [
        '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessForIframes',
      ],
    }
  : undefined;

/**
 * Playwright E2E Test Configuration
 *
 * Two test suites:
 * - e2e: Consolidated single-app critical path test (fast, ~10 min)
 * - regression: Full test suite with individual feature specs (thorough, ~30+ min)
 *
 * Environment selection (resolves baseURL + credentials). The --env flag is
 * parsed by scripts/e2e.sh and translated to PLAYWRIGHT_ENV; the
 * PLAYWRIGHT_ENV form is what playwright.config.ts and constants.ts read.
 *
 *   pnpm test:e2e --env=<local|dev|pre-test|test|prod> [playwright args...]
 *   ./scripts/e2e.sh --env=prod --project=e2e --headed
 *   PLAYWRIGHT_ENV=prod npx playwright test --project=e2e --headed
 *
 * Project selection:
 *   --project=e2e          fast critical path only
 *   --project=regression   full regression suite
 *   (no --project)         both
 *
 * PLAYWRIGHT_BASE_URL still wins if set (e.g. for one-off URLs not in the
 * environments map in tests/helpers/constants.ts).
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry failed tests once in CI for flakiness tolerance */
  retries: process.env.CI ? 1 : 0,
  /**
   * Single worker to ensure serial execution.
   * Required because:
   * 1. All tests share the same test account credentials
   * 2. Tests create/delete apps which affects global state
   * 3. SSO session state is shared across tests
   *
   * TODO: For parallel execution, implement:
   * - Separate test accounts per worker
   * - Proper test isolation with spec-prefixed app cleanup
   * - Worker-scoped authentication contexts
   */
  workers: 1,
  /* Global timeout for tests - site creation can take up to 5 minutes */
  timeout: 420000, // 7 minutes
  /* Expect timeout for assertions */
  expect: {
    timeout: 30000, // 30 seconds for expect assertions
  },
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI
    ? [['list'], ['github'], ['./tests/reporters/elasticsearch-reporter.ts']]
    : [['list'], ['html'], ['./tests/reporters/elasticsearch-reporter.ts']],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /**
     * Base URL to use in actions like `await page.goto('/')`.
     * Resolution order:
     *   1. PLAYWRIGHT_BASE_URL (explicit override, e.g. one-off ad-hoc URL)
     *   2. environments[PLAYWRIGHT_ENV].baseUrl (driven by --env shortcuts)
     *   3. environments.test.baseUrl (default fallback when nothing is set)
     */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || envConfig.baseUrl,
    /* Viewport size for desktop testing */
    viewport: { width: 1920, height: 1360 },
    /* Action timeout for clicks, fills, etc. */
    actionTimeout: 30000,
    /* Navigation timeout */
    navigationTimeout: 150000,
    /* Collect trace on failure. See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-failure',
    /* Take screenshot on failure */
    screenshot: 'only-on-failure',
    /* Record video on failure */
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'e2e',
      testDir: './tests/e2e',
      use: { ...devices['Desktop Chrome'], ...(launchOptions && { launchOptions }) },
    },
    {
      name: 'regression',
      testDir: './tests/regression',
      use: { ...devices['Desktop Chrome'], ...(launchOptions && { launchOptions }) },
    },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://127.0.0.1:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
