/**
 * Analytics Custom Period E2E Test
 *
 * Happy path for the analytics period picker custom range flyout:
 * - Open Analytics tab
 * - Open Custom flyout, set From/To dates, Apply
 * - Flyout closes and analytics GraphQL refresh is triggered
 *
 * Site publish state and ClickHouse responses are mocked so the test does not
 * depend on a live deploy or analytics backend.
 */
import { test, expect, type Page } from '@playwright/test';

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { handleSsoLogin, ensureAuthenticated } from '../helpers/auth';
import {
  AI_RESPONSE_TIMEOUT_MS,
  DEFAULT_TIMEOUT,
  E2E_NO_DELETE,
  LONG_TIMEOUT,
  getSpecPrefix,
} from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

const SPEC_PREFIX = 'analytics-period';
const MOCK_PUBLISHED_URL = 'https://e2e-analytics.c4.test-airoapp.ai/';

function isoDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function recentCustomRange(): { fromDate: string; toDate: string } {
  const to = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 14);
  return { fromDate: isoDateUtc(from), toDate: isoDateUtc(to) };
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

test.describe('Analytics Custom Period', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
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

  test('Custom date range flyout — pick dates, apply, refresh analytics', async ({ page }, testInfo) => {
    testInfo.setTimeout(AI_RESPONSE_TIMEOUT_MS + 120_000);

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
    await handleSsoLogin(page);

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] ?? '';
    expect(appId).toBeTruthy();
    console.log(`  App created: ${appId}`);

    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    await ensureAuthenticated(page);
    await dismissOverlays(page);

    console.log('Step 2: Mock published site + analytics API...');
    await mockPublishedAnalyticsSite(page, appId);
    await page.reload();
    await waitForDevelopPage(page);
    await dismissOverlays(page);

    console.log('Step 3: Open Analytics tab...');
    const analyticsTab = page.getByRole('radio', { name: /analytics|builder_settings_nav_analytics/i });
    const analyticsVisible = await analyticsTab.isVisible({ timeout: DEFAULT_TIMEOUT }).catch(() => false);
    test.skip(!analyticsVisible, 'Analytics tab not available (appbuilder-analytics flag off)');

    await analyticsTab.click({ force: true });

    const analyticsTitle = page.getByText(/analytics|builder_analytics_title/i);
    await expect(analyticsTitle.first()).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    console.log('Step 4: Open custom date flyout...');
    const customSegment = page.getByTestId('analytics-period-custom-trigger');
    await expect(customSegment).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await customSegment.click();

    const flyout = page.getByTestId('analytics-period-custom-flyout');
    await expect(flyout).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.getByRole('dialog')).toBeVisible();

    const { fromDate, toDate } = recentCustomRange();
    await page.locator('#analytics-from-date').fill(fromDate);
    await page.locator('#analytics-to-date').fill(toDate);

    console.log('Step 5: Apply custom range and verify refresh...');
    const analyticsRequest = page.waitForRequest(
      (request) =>
        request.url().includes('/api/analytics/graphql') &&
        request.method() === 'POST' &&
        request.postData()?.includes(fromDate) === true &&
        request.postData()?.includes(toDate) === true,
    );

    await page.getByRole('button', { name: /apply|builder_analytics_period_apply/i }).click();

    await expect(flyout).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await analyticsRequest;

    console.log('  Custom range applied and analytics refresh requested');
  });
});
