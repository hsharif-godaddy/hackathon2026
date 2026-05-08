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
import { test, expect } from '@playwright/test';

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { handleSsoLogin, ensureAuthenticated } from '../helpers/auth';
import { LONG_TIMEOUT, DEFAULT_TIMEOUT, AI_RESPONSE_TIMEOUT_MS, E2E_NO_DELETE, getSpecPrefix } from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

/** Spec prefixes used by `getSpecPrefix(...)` calls in this describe block. */
const SPEC_PREFIXES = ['brand-book'] as const;

test.describe('Brand Book Tab', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
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

    try {
      await page.goto('/apps');
      for (const name of SPEC_PREFIXES) {
        try {
          await deleteAppsWithPrefix(page, getSpecPrefix(name));
        } catch (err) {
          console.error(`  Cleanup of prefix '${name}' failed:`, err);
        }
      }
    } catch (err) {
      console.error('  Cleanup failed:', err);
    }
  });

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

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    await handleSsoLogin(page);

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

    // Brand Book tab is a radio button in the header ButtonGroup
    const brandBookTab = page.getByRole('radio', { name: /logo.*brand/i });

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
    // PreviewCode state) but visually hidden (opacity 0, pointer-events none)
    const previewIframe = page.getByTestId('preview-iframe');
    await expect(previewIframe).not.toBeVisible();
    console.log('  Preview iframe hidden while Brand Book active');

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
