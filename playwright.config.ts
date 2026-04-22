import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load test environment variables from tests/.env
dotenv.config({ path: path.resolve(__dirname, 'tests/.env') });

/**
 * Playwright E2E Test Configuration
 *
 * Tests migrated from Cypress (e2e/cypress/tests/) to Playwright (tests/smoke/)
 * Smoke tests covering: apps page, authentication, navigation, develop page features,
 * publish, media, and cold archive restore (see tests/smoke/)
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/smoke',
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
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://airo-builder.test-godaddy.com',
    /* Viewport size matching Cypress config */
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
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // Temporarily disabled to focus on Chrome only
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    // /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://127.0.0.1:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
