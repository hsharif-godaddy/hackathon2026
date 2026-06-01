/**
 * Manage Plan - Deeplinks
 *
 * Covers the credits-deeplink happy path: visiting
 * /manage-plan?action=showCredits&source=bell_campaign opens the credits
 * modal and strips the params from the URL.
 *
 * Prerequisite: the `appbuilder-credits-deeplink` Switchboard flag must be
 * enabled for the test account. See app/CLAUDE.md for setup instructions.
 */
import { expect, test } from '@playwright/test';

import { loginIfNeeded } from '../helpers/auth';
import { DEFAULT_TIMEOUT, LONG_TIMEOUT } from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart } from '../helpers/ui';

test.describe('Manage Plan - Deeplinks', function deeplinks() {
  test.beforeEach(async function setup({ page }, testInfo) {
    logTestStart(testInfo);
    await page.goto('/');
    // loginIfNeeded checks the user-menu state and signs in only when required,
    // making this safe regardless of prior auth state in the test run.
    await loginIfNeeded(page);
  });

  test.afterEach(async function teardown({ page }, testInfo) {
    await logTestResult(page, testInfo);
  });

  test('credits deeplink opens modal and strips URL params', async function creditsDeeplink({ page }) {
    console.log('🔗 Navigating to manage-plan with credits deeplink params...');
    await page.goto('/manage-plan?action=showCredits&source=bell_campaign');
    await page.waitForURL(/\/manage-plan/, { timeout: LONG_TIMEOUT });

    // Dismiss cookie banners and coachmarks before the modal opens.
    // The credits modal is gated on subscription data loading
    // (!isSubscriptionLoading), so it has not appeared yet at this point.
    await dismissOverlays(page);

    console.log('⏳ Waiting for credits modal to open...');
    // The modal opens once subscription data loads. DEFAULT_TIMEOUT (30s)
    // covers the subscription fetch in every environment.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('✅ Credits modal is visible');

    // The deeplink handler strips action and source from the URL immediately
    // after triggering openCredits (in the try/finally block).
    const url = new URL(page.url());
    expect(url.searchParams.has('action')).toBe(false);
    expect(url.searchParams.has('source')).toBe(false);
    console.log('✅ Deeplink params stripped from URL');
  });
});
