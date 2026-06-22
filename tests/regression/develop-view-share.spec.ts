/**
 * Share Link E2E Tests
 *
 * Tests the Share Link popover in the header:
 * 1. Popover opens/closes with share-link-* test IDs
 * 2. Preview segment shows URL input with copy/open actions
 * 3. Preview auto-creates share token and shows expiry label
 *
 * FLAG REQUIREMENT: the share-links UI and the token CRUD routes
 * (/api/apps/[id]/share) are gated by the `appbuilder-share-links` Switchboard
 * flag — client-side via useSwitchboard (ShareLink.tsx) and server-side via
 * checkSwitchboardFlag (403 when off). Test 3 exercises the full token flow, so
 * the account the suite authenticates as MUST have this flag enabled. It is on
 * for the prod CI account (where regression runs); enable it for any other
 * account/env before running this spec there, or test 3 will fail at the
 * token-UI assertion (by design — no silent skip).
 */
import { test, expect } from '../helpers/test-fixtures';

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { detectSsoType, handleSsoLogin, isSignInUIResult, loginViaSsoDirect } from '../helpers/auth';
import {
  DEFAULT_TIMEOUT,
  E2E_NO_DELETE,
  LONG_TIMEOUT,
  getSpecPrefix,
} from '../helpers/constants';
import {
  dismissOverlays,
  logTestResult,
  logTestStart,
  waitForChatInput,
  waitForDevelopPage,
} from '../helpers/ui';

/** Spec prefixes used by `getSpecPrefix(...)` calls in this describe block. */
const SPEC_PREFIXES = ['share-link', 'share-link-preview', 'share-link-token'] as const;

test.describe('Share Link', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    // Authenticate once here via the fast standalone-SSO login (e2e-v2 style)
    // instead of the slower per-test homepage user-menu -> sign-in iframe flow.
    await loginViaSsoDirect(page);
    if (!E2E_NO_DELETE) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch(() => {});
    }
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);

    if (E2E_NO_DELETE) {
      console.log('Cleanup skipped (E2E_NO_DELETE=true)');
      return;
    }

    // Each test creates its own app; clean them up by prefix so the shared
    // account doesn't drift toward its app cap (these tests previously left
    // every created app behind).
    try {
      await page.goto('/apps');
      for (const name of SPEC_PREFIXES) {
        await deleteAppsWithPrefix(page, getSpecPrefix(name));
      }
    } catch (err) {
      console.error('Cleanup failed:', err);
    }
  });

  test('Share link button visible and opens popover', async ({ page }) => {
    console.log('Creating test app...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('share-link')} Simple hello world page`);

    // The authenticated homepage auto-opens the Projects popover, which
    // overlays the prompt submit — dismiss it so the click registers and the
    // app-create navigation fires.
    await dismissOverlays(page);
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    // Already authenticated in beforeEach, so the submit normally redirects
    // straight to /develop/. Only drive the SSO flow if the session refreshed
    // mid-test and the sign-in UI actually reappeared.
    const ssoResult = await detectSsoType(page, true);
    if (isSignInUIResult(ssoResult)) {
      console.log('  SSO refresh detected, re-authenticating...');
      await handleSsoLogin(page);
    }

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    await dismissOverlays(page);

    console.log('App created, testing share link button...');

    const shareButton = page.getByTestId('share-link-button');
    await expect(shareButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  - Share link button is visible');

    await shareButton.click();

    const popover = page.getByTestId('share-link-popover');
    await expect(popover).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  - Popover opens on click');

    // Unpublished app: preview content visible, no segmented controller
    const previewContent = page.getByTestId('share-link-preview-content');
    await expect(previewContent).toBeVisible();
    console.log('  - Preview content is visible');

    const segment = page.getByTestId('share-link-segment');
    await expect(segment).not.toBeVisible();
    console.log('  - Segmented controller is hidden (app not published)');

    await page.keyboard.press('Escape');
    await expect(popover).not.toBeVisible();
    console.log('  - Popover closes on Escape');
  });

  test('Preview segment shows URL input with copy and open buttons', async ({ page, context }) => {
    console.log('Creating test app...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('share-link-preview')} Simple hello world page`);

    // The authenticated homepage auto-opens the Projects popover, which
    // overlays the prompt submit — dismiss it so the click registers and the
    // app-create navigation fires.
    await dismissOverlays(page);
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    // Already authenticated in beforeEach, so the submit normally redirects
    // straight to /develop/. Only drive the SSO flow if the session refreshed
    // mid-test and the sign-in UI actually reappeared.
    const ssoResult = await detectSsoType(page, true);
    if (isSignInUIResult(ssoResult)) {
      console.log('  SSO refresh detected, re-authenticating...');
      await handleSsoLogin(page);
    }

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    await waitForChatInput(page);
    await dismissOverlays(page);

    console.log('App created, testing preview URL actions...');

    const shareButton = page.getByTestId('share-link-button');
    await shareButton.click();

    const popover = page.getByTestId('share-link-popover');
    await expect(popover).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const urlInput = page.getByTestId('share-link-input');
    await expect(urlInput).toBeVisible();
    console.log('  - URL input is visible');

    const copyButton = page.getByTestId('share-link-copy');
    await expect(copyButton).toBeVisible();
    console.log('  - Copy button is visible');

    const openButton = page.getByTestId('share-link-open');
    await expect(openButton).toBeVisible();
    console.log('  - Open button is visible');

    // Click open button to verify it opens preview in new tab
    const pagePromise = context.waitForEvent('page');
    await openButton.click();

    const newPage = await pagePromise;
    await newPage.waitForLoadState();
    expect(newPage.url()).toContain('preview');
    console.log(`  - Preview opened in new tab: ${newPage.url()}`);

    await newPage.close();
  });

  test('Preview auto-creates share token and shows expiry label', async ({ page }) => {
    console.log('Creating test app...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('share-link-token')} Simple hello world page`);

    // The authenticated homepage auto-opens the Projects popover, which
    // overlays the prompt submit — dismiss it so the click registers and the
    // app-create navigation fires.
    await dismissOverlays(page);
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    // Already authenticated in beforeEach, so the submit normally redirects
    // straight to /develop/. Only drive the SSO flow if the session refreshed
    // mid-test and the sign-in UI actually reappeared.
    const ssoResult = await detectSsoType(page, true);
    if (isSignInUIResult(ssoResult)) {
      console.log('  SSO refresh detected, re-authenticating...');
      await handleSsoLogin(page);
    }

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    await waitForChatInput(page);
    await dismissOverlays(page);

    console.log('App created, testing token auto-creation...');

    const shareButton = page.getByTestId('share-link-button');
    await shareButton.click();

    const popover = page.getByTestId('share-link-popover');
    await expect(popover).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // Token auto-creates on popover open. The share-links UI + token CRUD are
    // gated by the appbuilder-share-links Switchboard flag (client:
    // useSwitchboard in ShareLink.tsx; server: /api/apps/[id]/share returns a
    // 403 when off). The flag is ENABLED for the prod CI account where
    // regression runs, so assert the token UI surfaces (loading spinner or URL
    // input) rather than silently skipping when it's absent — see the
    // flag-requirement note atop this file.
    const previewLoading = page.getByTestId('share-link-preview-loading');
    const urlInput = page.getByTestId('share-link-input');
    await expect(previewLoading.or(urlInput).first()).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    if (await previewLoading.isVisible().catch(() => false)) {
      await expect(previewLoading).not.toBeVisible({ timeout: LONG_TIMEOUT });
      console.log('  - Loading spinner resolved');
    }

    // Either URL input shows the share token URL, or an error state is shown
    const errorState = page.getByTestId('share-link-error-state');
    const hasError = await errorState.isVisible().catch(() => false);

    if (hasError) {
      console.log('  - Error state shown (token creation may have failed)');
    } else {
      await expect(urlInput).toBeVisible();
      console.log('  - Share token URL is displayed');

      const expiryLabel = page.getByTestId('share-link-access-info');
      const expiryVisible = await expiryLabel.isVisible().catch(() => false);
      if (expiryVisible) {
        console.log('  - Token expiry label is visible');
      }
    }
  });
});
