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
import { test, expect } from '../helpers/test-fixtures';

import { loginViaSsoDirect } from '../helpers/auth';
import { DEFAULT_TIMEOUT, LONG_TIMEOUT } from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, switchboardFlag } from '../helpers/ui';

test.describe('Manage Plan - Deeplinks', function deeplinks() {
  test.beforeEach(async function setup({ page }, testInfo) {
    logTestStart(testInfo);
    await loginViaSsoDirect(page);
    // loginViaSsoDirect already awaits domcontentloaded, but the SSO host may
    // still be running a post-login client-side redirect when we return. A best-
    // effort 'load' wait lets that redirect settle. Safe to swallow: auth is
    // already set and the subsequent goto('/') navigates correctly regardless.
    await page.waitForLoadState('load').catch(() => {});
    // Land on the app home before the test navigates to /manage-plan.
    // Without this, the browser is still on the SSO host and the direct goto
    // to /manage-plan?... races the SSO redirect and gets ERR_ABORTED.
    await page.goto('/');

    // The credits deeplink is gated by the `appbuilder-credits-deeplink`
    // Switchboard flag (useCreditsDeeplink.ts). In TEST it resolves true only
    // for three-letter/employee shoppers in a percentage bucket, so for the
    // standard CI account the modal never opens — asserting it would be a
    // false failure, not a product regression. Read it from the same GasketData
    // source the app hook uses.
    //
    // `undefined` means the read itself failed (GasketData missing, timing,
    // parse error) — fail on that rather than skip, otherwise a broken read
    // would silently green-by-skip forever, the exact rot this suite guards
    // against. Skip ONLY on a genuine resolved `false`.
    const deeplinkEnabled = await switchboardFlag(page, 'appbuilder-credits-deeplink');
    expect(deeplinkEnabled, 'appbuilder-credits-deeplink should be readable from GasketData on /').not.toBeUndefined();
    test.skip(deeplinkEnabled === false, 'appbuilder-credits-deeplink flag off for this account');
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
    await expect(page.getByTestId('credits-modal-container')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('✅ Credits modal is visible');

    // The deeplink handler strips action and source from the URL immediately
    // after triggering openCredits (in the try/finally block).
    const url = new URL(page.url());
    expect(url.searchParams.has('action')).toBe(false);
    expect(url.searchParams.has('source')).toBe(false);
    console.log('✅ Deeplink params stripped from URL');
  });
});
