import { test as base, expect, Page, BrowserContext, APIRequestContext } from '@playwright/test';
import { authenticate, clearAuthState, handleSsoLogin } from '../helpers/auth';
import { dismissBanners, waitForHomepage } from '../helpers/ui';
import { getSpecPrefix } from '../helpers/constants';

/**
 * Custom test fixtures extending Playwright's base test
 *
 * NOTE: Tests currently run with workers: 1 to avoid login/state conflicts.
 * All tests share the same test account, so parallel execution requires
 * implementing separate test accounts per worker.
 */

export interface TestFixtures {
  /** Page with authentication already established */
  authenticatedPage: Page;
  /** API request context for making authenticated API calls */
  apiContext: APIRequestContext;
  /** Get spec prefix for app naming */
  specPrefix: string;
}

/**
 * Extended test with custom fixtures
 */
export const test = base.extend<TestFixtures>({
  // Authenticated page fixture
  authenticatedPage: async ({ page, context }, use) => {
    try {
      await authenticate(page, context);
      await dismissBanners(page);
    } catch (error) {
      console.error('Authentication failed:', error);
      throw error;
    }
    await use(page);
  },

  // API context fixture
  apiContext: async ({ request }, use) => {
    await use(request);
  },

  // Spec prefix fixture
  specPrefix: async ({}, use, testInfo) => {
    const specName = testInfo.file.split('/').pop() || 'unknown';
    await use(getSpecPrefix(specName));
  },
});

export { expect };

/**
 * Test with unauthenticated state
 */
export const unauthenticatedTest = base.extend<{ unauthenticatedPage: Page }>({
  unauthenticatedPage: async ({ page, context }, use) => {
    await clearAuthState(context);
    await page.waitForTimeout(1000);
    await use(page);
  },
});
