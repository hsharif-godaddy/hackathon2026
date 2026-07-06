import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

import { getEnvConfig } from './tests/helpers/constants';

// Load test environment variables from tests/.env. getEnvConfig() reads
// process.env lazily at call time, so values from .env are picked up below.
dotenv.config({ path: path.resolve(__dirname, 'tests/.env') });

const { env: envName, config: envConfig } = getEnvConfig();

/**
 * CI runners resolve `sso.*godaddy.com` to an internal VIP, so Chrome's
 * Local Network Access check blocks the cross-origin SSO traffic from
 * `airo-builder.*godaddy.com` (classified public) to SSO (classified local).
 * On test/pre-test this silently fails the heartbeat POST (VAT ages out →
 * mid-run 401s). On prod-on-CI it also breaks the standalone-SSO login token
 * exchange (`loginViaSsoDirect`), surfacing as `/api/sites` 401
 * "Encoded token does not have 3 parts".
 *
 * Real users hit every env from public DNS (public→public), so LNA never
 * trips for them — the flag is purely a CI-runner-network workaround.
 * Therefore:
 *   - test / pre-test: always disable (the original heartbeat fix).
 *   - prod: disable ONLY on CI (process.env.CI). Never locally — a local
 *     prod run uses public DNS, and we don't want to mask the LNA check that
 *     real prod users genuinely rely on outside the runner.
 */
const LNA_DISABLED_ENVS: readonly string[] = ['test', 'pre-test'];
const lnaDisabled =
  LNA_DISABLED_ENVS.includes(envName) || (envName === 'prod' && !!process.env.CI);
const launchOptions = lnaDisabled
  ? {
      args: [
        '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessForIframes',
      ],
    }
  : undefined;

/**
 * Non-en-US locale override for the `de-DE-smoke` project and manual/CI smoke
 * runs. Driven by the playwright-e2e workflow's `locale` input (→
 * PLAYWRIGHT_LOCALE). `locale` sets the browser's Accept-Language header, which
 * Gasket's pluginIntl uses for locale detection. Left undefined on normal runs
 * so every existing project keeps its en-US default — `locale: undefined` is a
 * no-op in Playwright's contextOptions.
 */
const smokeLocale: string | undefined = process.env.PLAYWRIGHT_LOCALE || undefined;

/**
 * Playwright E2E Test Configuration
 *
 * Three test suites:
 * - e2e: Consolidated single-app critical path test (fast, ~10 min)
 * - e2e-v2: Split + parallel-safe successor to e2e (4 files, ~5–10 min).
 *           Currently shipped alongside e2e; CI will flip to e2e-v2 in a
 *           follow-up PR, then the legacy e2e project is removed.
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
 *   --project=e2e          fast critical path only (legacy, single worker)
 *   --project=e2e-v2       split + parallel-safe successor (4 workers via
 *                          PLAYWRIGHT_E2E_WORKERS, set automatically by
 *                          scripts/e2e.sh)
 *   --project=regression   full regression suite
 *   (no --project)         all three
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
   * Default 1 worker preserves today's behavior for the legacy `e2e` and
   * `regression` projects, where:
   * 1. All tests share the same test account credentials
   * 2. Tests create/delete apps which affects global state
   * 3. SSO session state is shared across tests
   *
   * The `e2e-v2` project is parallel-safe — each spec uses a fresh browser
   * context per test (live SSO, no shared storageState), and the shared-app
   * specs read a long-lived pool app whose id is resolved once by the
   * `pool-resolve` setup dependency (no concurrent `GET /api/sites`), so
   * multiple workers don't collide. `scripts/e2e.sh` sets
   * `PLAYWRIGHT_E2E_WORKERS=4` automatically when invoked with
   * `--project=e2e-v2`. The override applies process-wide; if a single
   * invocation also runs `e2e` or `regression`, fall back to 1 worker
   * via `--workers=1` or run those projects separately.
   */
  workers: process.env.PLAYWRIGHT_E2E_WORKERS
    ? parseInt(process.env.PLAYWRIGHT_E2E_WORKERS, 10)
    : 1,
  /* Global timeout for tests - site creation can take up to 5 minutes */
  timeout: 420000, // 7 minutes
  /* Expect timeout for assertions */
  expect: {
    timeout: 30000, // 30 seconds for expect assertions
  },
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  // When CI runs the suite sharded across multiple runners, each shard writes
  // a `blob` report that the workflow's `merge-reports` job stitches into one
  // HTML report. PLAYWRIGHT_BLOB_REPORT is set by the workflow only when
  // total_shards > 1, so non-sharded CI keeps the `github` reporter unchanged.
  //
  // The `json` reporter is added on top in CI so the workflow's `summarize`
  // job can aggregate per-suite pass/fail/skip counts and failed test names
  // across shards (each entry carries `projectName`, giving authoritative
  // e2e-vs-regression grouping). It lands in test-results/ — already uploaded
  // per shard — and is purely additive (Testla still reads the JUnit file).
  // Sharded runs suffix the filename so per-shard files stay distinct.
  reporter: process.env.CI
    ? (process.env.PLAYWRIGHT_BLOB_REPORT
        ? [['list'], ['blob'], ['./tests/reporters/elasticsearch-reporter.ts'], ['junit', { outputFile: `test-results/junit-shard-${process.env.SHARD || '1'}.xml` }], ['json', { outputFile: `test-results/results-shard-${process.env.SHARD || '1'}.json` }]]
        : [['list'], ['github'], ['./tests/reporters/elasticsearch-reporter.ts'], ['junit', { outputFile: 'test-results/junit.xml' }], ['json', { outputFile: 'test-results/results.json' }]])
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
    /* Non-en-US locale override (PLAYWRIGHT_LOCALE); undefined = en-US default */
    locale: smokeLocale,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'e2e',
      testDir: './tests/e2e',
      use: { ...devices['Desktop Chrome'], ...(launchOptions && { launchOptions }) },
    },
    /**
     * bootstrap-pool: one-shot, idempotent setup that ensures the long-lived
     * pool apps used by `e2e-v2` exist for the target env. Run manually once
     * per env (and to re-seed after a pool app is deleted):
     *
     *   pnpm exec playwright test --project=bootstrap-pool --env=test
     *
     * NOT part of `e2e-v2` and NOT a `dependencies` entry — pool apps are
     * meant to outlive individual runs, so we don't pay their creation cost
     * every run. Specs look the apps up via `getPoolAppId` and fail with a
     * clear "run bootstrap-pool" hint if missing. See REFACTOR_PLAN.md PR 4.
     */
    {
      name: 'bootstrap-pool',
      testDir: './tests/pool-setup',
      use: { ...devices['Desktop Chrome'], ...(launchOptions && { launchOptions }) },
    },
    /**
     * e2e-v2: split + parallel-safe successor to the `e2e` project. Runs
     * the 4-file shape under `tests/e2e-v2/`. Workers default to 1
     * (matching the rest of the suite); `scripts/e2e.sh` sets
     * `PLAYWRIGHT_E2E_WORKERS=4` only when invoked with
     * `--project=e2e-v2`, which is the parallel-safe configuration.
     *
     * Authentication: each spec's hooks (`beforeAll` / `afterAll`) and each
     * test's `beforeEach` call `loginIfNeeded` directly — there is no shared
     * storageState. We tried the storageState model (auth once, reuse the
     * cookie jar) and it failed against GoDaddy SSO: the saved JWT was
     * syntactically valid but Gasket's pluginAuth rejected it on the first
     * `/develop/<id>` navigation, bouncing every test to SSO. The
     * un-exercised JWT was missing live VAT / customer-context grants that
     * only get minted by an interactive login flow. Per-test live login is
     * the proven pattern (see airohq/airo-ai-automation venture-agent for
     * prior art) and trades ~30–60 s of added wall-clock at workers=4 for
     * reliability.
     *
     * `create-flow.spec.ts` deliberately tests the cold-start SSO flow
     * itself; nothing in this project assumes pre-authentication.
     *
     * The legacy `e2e` project above is unchanged and continues to be the
     * canonical CI signal until a follow-up PR flips the workflow to
     * `--project=e2e-v2` and a third PR removes the legacy project +
     * `tests/e2e/e2e.spec.ts`.
     */
    /**
     * pool-resolve: setup project (a `dependencies` entry of e2e-v2) that
     * resolves every pool app id ONCE per run and caches them to
     * tests/.pool-cache.json. Specs then read the cache (no network) in
     * beforeAll. This eliminates the workers=4 concurrent `GET /api/sites`
     * burst that 504'd against the test env (4 beforeAll lookups firing at
     * once). Runs only when e2e-v2 runs — `--project=e2e` does NOT trigger it.
     * See tests/pool-resolve/resolve-pool-apps.setup.ts.
     */
    {
      name: 'pool-resolve',
      testDir: './tests/pool-resolve',
      // Default testMatch only picks up *.spec.ts / *.test.ts; the setup file
      // is *.setup.ts, so match it explicitly or the project finds 0 tests.
      testMatch: /.*\.setup\.ts$/,
      use: { ...devices['Desktop Chrome'], ...(launchOptions && { launchOptions }) },
    },
    {
      name: 'e2e-v2',
      testDir: './tests/e2e-v2',
      // Resolve pool ids once (serially) before the 4 specs fan out, instead
      // of each beforeAll hitting /api/sites concurrently.
      dependencies: ['pool-resolve'],
      use: {
        ...devices['Desktop Chrome'],
        ...(launchOptions && { launchOptions }),
      },
    },
    {
      name: 'regression',
      testDir: './tests/regression',
      use: { ...devices['Desktop Chrome'], ...(launchOptions && { launchOptions }) },
    },
    /**
     * de-DE-smoke: non-English locale smoke over the fast `e2e-v2` specs.
     * Catches locale-coupled locators (e.g. getByRole name-matching translated
     * text) that pass in en-US but break in any other locale. Manual/opt-in —
     * NOT part of the default CI matrix. Defaults to de-DE; PLAYWRIGHT_LOCALE
     * retargets it (e.g. fr-FR). Mirrors the `e2e-v2` project (same testDir +
     * `pool-resolve` dependency) so the shared-pool specs resolve their cached
     * app ids. Run: pnpm test:e2e --project=de-DE-smoke --env=test
     */
    {
      name: 'de-DE-smoke',
      testDir: './tests/e2e-v2',
      dependencies: ['pool-resolve'],
      use: {
        ...devices['Desktop Chrome'],
        locale: smokeLocale ?? 'de-DE',
        ...(launchOptions && { launchOptions }),
      },
    },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://127.0.0.1:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
