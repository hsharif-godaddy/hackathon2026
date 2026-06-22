/**
 * Brand Book Tab E2E Smoke Test
 *
 * Tests the Brand Book tab in the develop page header:
 * - Tab renders when appbuilder-brandbook flag is enabled
 * - Clicking the tab shows the Brand Book view (loading or populated)
 * - Switching back to Preview restores the preview iframe
 *
 * Strategy:
 * - Single login, single app creation
 * - Tests Brand Book tab interaction against the created app
 */
import { test, expect } from '../helpers/test-fixtures';

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { loginViaSsoDirect, ensureAuthenticated } from '../helpers/auth';
import { LONG_TIMEOUT, DEFAULT_TIMEOUT, AI_RESPONSE_TIMEOUT_MS, E2E_NO_DELETE, getSpecPrefix } from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

/** Spec prefixes used by `getSpecPrefix(...)` calls in this describe block. */
const SPEC_PREFIXES = ['brand-book'] as const;

test.describe('Brand Book Tab', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    await loginViaSsoDirect(page);
    // loginViaSsoDirect already awaits domcontentloaded, but the SSO host may
    // still be running a post-login client-side redirect when we return. A best-
    // effort 'load' wait lets that redirect settle so the subsequent page.goto('/')
    // doesn't race it and get ERR_ABORTED. Safe to swallow: auth is already set
    // and page.goto('/') will navigate correctly regardless.
    await page.waitForLoadState('load').catch(() => {});
    if (!E2E_NO_DELETE) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch(() => {});
    }
  });

  test.afterEach(async ({ page }) => {
    if (E2E_NO_DELETE) {
      console.log('🧹 Cleanup skipped (E2E_NO_DELETE=true)');
      return;
    }

    for (const name of SPEC_PREFIXES) {
      try {
        await deleteAppsWithPrefix(page, getSpecPrefix(name));
      } catch (err) {
        console.error(`  Cleanup of prefix '${name}' failed:`, err);
      }
    }
  });

  // Re-enabled (VNEXT-80875). The original skip (CI run 25675567980) had two
  // root causes: (1) handleSsoLogin timed out because the homepage submit
  // landed on an unhydrated shell — fixed by pre-authenticating via
  // loginViaSsoDirect in beforeEach (same pattern as develop-edit-interactions
  // VNEXT-80873), and (2) the submit button was clicked before React hydration
  // completed — fixed by gating on toBeEnabled + a 10s hydration wait before
  // clicking (matching develop-edit-interactions). The underlying homepage
  // load issue is sidestepped rather than fixed: logging in before navigation
  // ensures the page hydrates fully as an authenticated user.
  test('Brand Book tab switch and content render', async ({ page }, testInfo) => {
    // AI_RESPONSE_TIMEOUT_MS (300s) is just the wait budget for initial
    // generation; add headroom for login, navigation and the brand-book steps.
    testInfo.setTimeout(AI_RESPONSE_TIMEOUT_MS + 60_000);

    // ========================================
    // STEP 1: Create an app
    // ========================================
    console.log('Step 1: Creating app...');

    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('brand-book')} Simple pet photography business - do not ask follow up questions`);

    const submitButton = page.locator('[data-eid*="homepage.prompt.submit"]');
    await expect(submitButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
    // The disabled→enabled flip is server-rendered, so toBeEnabled alone is not
    // proof that React has hydrated. Without this wait, clicks land on the shell
    // before event handlers attach and silently no-op (see authentication.spec.ts).
    await page.waitForTimeout(10_000);
    await submitButton.click();

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
    console.log(`  App created: ${appId}`);

    // Wait for initial generation to complete
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    console.log('  Initial generation completed');

    await ensureAuthenticated(page);

    // ========================================
    // STEP 2: Find and click Brand Book tab
    // ========================================
    await dismissOverlays(page);
    console.log('Step 2: Switching to Brand Book tab...');

    // Brand Book tab is a button in the header ButtonGroup (role="group" wrapper since #4291).
    const brandBookTab = page.getByRole('button', { name: /logo.*brand/i });

    // If the flag is not enabled, the tab won't exist — skip gracefully
    const tabVisible = await brandBookTab.isVisible().catch(() => false);
    if (!tabVisible) {
      console.log('  Brand Book tab not visible (flag may be disabled). Skipping.');
      await logTestResult(page, testInfo);
      return;
    }

    await brandBookTab.click();
    console.log('  Clicked Brand Book tab');

    // ========================================
    // STEP 3: Verify Brand Book content renders
    // ========================================
    console.log('Step 3: Verifying Brand Book content...');

    // Either the loading state or the populated view should be visible
    const brandBookView = page.getByTestId('brand-book-view');
    const brandBookLoading = page.getByTestId('brand-book-loading');

    await expect(brandBookView.or(brandBookLoading)).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  Brand Book content visible (view or loading state)');

    // Preview iframe is still in the DOM (overlay architecture preserves
    // PreviewCode state) but rendered behind the Brand Book overlay with
    // `inert=""` and `aria-hidden="true"` so it can't receive input. Playwright's
    // `.not.toBeVisible()` only checks display/visibility/opacity, not these
    // attrs — the iframe still has non-zero box, so toBeVisible passes.
    // Assert the actual hidden-mode contract instead.
    const previewIframe = page.getByTestId('preview-iframe');
    await expect(previewIframe).toHaveAttribute('inert', '');
    await expect(previewIframe).toHaveAttribute('aria-hidden', 'true');
    console.log('  Preview iframe inert + aria-hidden while Brand Book active');

    // ========================================
    // STEP 4: Switch back to Preview
    // ========================================
    console.log('Step 4: Switching back to Preview...');

    const previewTab = page.getByRole('radio', { name: /preview/i });
    await previewTab.click();

    await previewIframe.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    console.log('  Preview iframe restored');

    // Brand Book should no longer be visible
    await expect(brandBookView).not.toBeVisible();
    console.log('  Brand Book view hidden after switching back');

    await logTestResult(page, testInfo);
  });
});
