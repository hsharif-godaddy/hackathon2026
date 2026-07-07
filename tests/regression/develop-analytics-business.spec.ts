/**
 * Business Analytics E2E Test
 *
 * Happy path for commerce-backed business analytics on the Analytics tab:
 * - Open Analytics tab on a published (mocked) site with commerce configured
 * - Business analytics section loads sales overview from mocked reporting API
 *
 * Site publish state, ClickHouse/GraphQL, commerce binding, and reporting
 * responses are mocked so the test does not depend on live commerce data.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { detectSsoType, ensureAuthenticated, handleSsoLogin, isSignInUIResult, loginViaSsoDirect } from '../helpers/auth';
import {
  AI_RESPONSE_TIMEOUT_MS,
  DEFAULT_TIMEOUT,
  E2E_NO_DELETE,
  LONG_TIMEOUT,
  getSpecPrefix,
} from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

const SPEC_PREFIX = 'analytics-business';
const MOCK_PUBLISHED_URL = 'https://e2e-analytics-business.c4.test-airoapp.ai/';
const MOCK_STORE_ID = 'e2e-store-business-1';

async function enableAnalyticsSwitchboardFlags(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let gd: { switchboard?: Record<string, unknown> } | undefined;
    Object.defineProperty(window, 'gasketData', {
      configurable: true,
      get: () => gd,
      set: (v: { switchboard?: Record<string, unknown> } | undefined) => {
        gd = v || {};
        gd.switchboard = {
          ...(gd.switchboard || {}),
          'appbuilder-analytics': true,
          'appbuilder-business-analytics': true,
        };
      },
    });
  });
}

async function mockPublishedAnalyticsSite(page: Page, appId: string): Promise<void> {
  await page.route(`**/api/sites/${appId}`, async (route, request) => {
    if (request.method() !== 'GET') {
      await route.continue();
      return;
    }

    try {
      const upstream = await route.fetch();
      const body = (await upstream.json()) as Record<string, unknown>;
      await route.fulfill({
        response: upstream,
        body: JSON.stringify({
          ...body,
          published_url: MOCK_PUBLISHED_URL,
          variants: ['preview', 'publish'],
          variantsWithLifecycle: [{ variant: 'publish', status: 'active' }],
        }),
      });
    } catch (err) {
      console.error(`Failed to mock GET /api/sites/${appId}:`, err);
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'mock setup failed' }),
      });
    }
  });

  await page.route('**/api/analytics/graphql', async (route, request) => {
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { analyticsQuery: { rows: [] } } }),
    });
  });
}

async function mockBusinessAnalyticsApis(page: Page, appId: string): Promise<void> {
  await page.route(`**/api/apps/${appId}/commerce/binding`, async (route, request) => {
    if (request.method() !== 'GET') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        configured: true,
        binding: { storeId: MOCK_STORE_ID },
      }),
    });
  });

  await page.route('**/api/commerce/reporting/data', async (route, request) => {
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          timeIntervalStart: `${today}T00:00:00.000Z`,
          count: 1,
          sumTotal: 9900,
        }],
        pageInfo: { hasNextPage: false },
      }),
    });
  });
}

test.describe('Analytics Business Commerce', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    await loginViaSsoDirect(page);
    if (!E2E_NO_DELETE) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch((err) => {
        console.error('App eviction failed:', err);
      });
    }
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);

    if (E2E_NO_DELETE) {
      console.log('Cleanup skipped (E2E_NO_DELETE=true)');
      return;
    }

    try {
      await page.goto('/apps');
      await deleteAppsWithPrefix(page, getSpecPrefix(SPEC_PREFIX));
    } catch (err) {
      console.error('Cleanup failed:', err);
    }
  });

  test('Business analytics section loads sales overview from commerce reporting', async ({ page }, testInfo) => {
    testInfo.setTimeout(AI_RESPONSE_TIMEOUT_MS + 120_000);

    await enableAnalyticsSwitchboardFlags(page);
    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    console.log('Step 1: Creating app...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(
      `${getSpecPrefix(SPEC_PREFIX)} Single page hello world app - do not ask follow up questions`,
    );

    await dismissOverlays(page);
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    const ssoResult = await detectSsoType(page, true);
    if (isSignInUIResult(ssoResult)) {
      console.log('  SSO refresh detected, re-authenticating...');
      await handleSsoLogin(page);
    }

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] ?? '';
    expect(appId).toBeTruthy();
    console.log(`  App created: ${appId}`);

    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    await ensureAuthenticated(page);
    await dismissOverlays(page);

    console.log('Step 2: Mock published site, analytics, and commerce APIs...');
    await mockPublishedAnalyticsSite(page, appId);
    await mockBusinessAnalyticsApis(page, appId);
    await page.reload();
    await waitForDevelopPage(page);
    await dismissOverlays(page);

    console.log('Step 3: Open Analytics tab...');
    const analyticsTab = page.getByRole('radio', { name: /analytics|builder_settings_nav_analytics/i });
    const analyticsVisible = await analyticsTab.isVisible({ timeout: DEFAULT_TIMEOUT }).catch(() => false);
    test.skip(!analyticsVisible, 'Analytics tab not available (appbuilder-analytics flag off)');

    const reportingRequest = page.waitForRequest(
      (request) =>
        request.url().includes('/api/commerce/reporting/data') &&
        request.method() === 'POST',
    );

    await analyticsTab.click({ force: true });

    console.log('Step 4: Verify business analytics section...');
    const businessPanel = page.getByTestId('business-analytics-panel');
    await expect(businessPanel).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.getByText('Business Analytics')).toBeVisible();
    await expect(businessPanel.getByText('Sales Overview')).toBeVisible();
    await expect(businessPanel.getByText('$99.00')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await reportingRequest;

    console.log('  Business analytics section loaded with mocked sales data');
  });
});
