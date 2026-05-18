/**
 * View & Share Menu E2E Tests
 *
 * Tests the View & Share popover in the header:
 * 1. Preview Site - opens preview URL in new window
 * 2. See Published Site - opens published URL (after publish)
 * 3. Share publicly - text input with copy button to create/copy shareable link (feature flagged)
 *
 * Note: Share link tests require the 'appbuilder-share-links' feature flag.
 */
import { test, expect } from '@playwright/test';

import { handleSsoLogin, ensureAuthenticated } from '../helpers/auth';
import {
  DEFAULT_TIMEOUT,
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

test.describe('View & Share Menu', () => {
  test.beforeEach(async ({}, testInfo) => {
    logTestStart(testInfo);
  });

  test('View & Share button visible and opens popover', async ({ page }) => {
    // Create a simple app
    console.log('📱 Creating test app...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('view-share')} Simple hello world page`);

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();
    await handleSsoLogin(page);

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    await dismissOverlays(page);

    console.log('✅ App created, testing View & Share button...');

    // Find the View & Share button in header
    const header = page.getByTestId('airo-header');
    const viewShareButton = page.getByTestId('header-view-share-button');

    // Button should be visible
    await expect(viewShareButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  ✓ View & Share button is visible');

    // Click to open popover
    await viewShareButton.click();

    // Popover should appear
    const popover = page.getByTestId('header-view-share-popover');
    await expect(popover).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  ✓ Popover opens on click');

    // Preview row should be visible
    const previewRow = page.getByTestId('header-view-share-preview');
    await expect(previewRow).toBeVisible();
    expect(await previewRow.textContent()).toContain('Preview Site');
    console.log('  ✓ Preview row is visible');

    // Published row should NOT be visible for unpublished apps
    const publishedRow = page.getByTestId('header-view-share-published');
    await expect(publishedRow).not.toBeVisible();
    console.log('  ✓ Published row is hidden (app not published)');

    // Click outside to close popover
    await page.keyboard.press('Escape');
    await expect(popover).not.toBeVisible();
    console.log('  ✓ Popover closes on Escape');

    logTestResult('View & Share button visible and opens popover', true);
  });

  test('Preview link opens in new window', async ({ page, context }) => {
    // Create a simple app
    console.log('📱 Creating test app...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('view-share-preview')} Simple hello world page`);

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();
    await handleSsoLogin(page);

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    await waitForChatInput(page);
    await dismissOverlays(page);

    console.log('✅ App created, testing Preview link...');

    // Open View & Share popover
    const viewShareButton = page.getByTestId('header-view-share-button');
    await viewShareButton.click();

    const popover = page.getByTestId('header-view-share-popover');
    await expect(popover).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // Listen for new page (popup window)
    const pagePromise = context.waitForEvent('page');

    // Click preview row
    const previewRow = page.getByTestId('header-view-share-preview');
    await previewRow.click();

    // Wait for new window to open
    const newPage = await pagePromise;
    await newPage.waitForLoadState();

    // Verify preview URL was opened
    const newUrl = newPage.url();
    expect(newUrl).toContain('preview');
    console.log(`  ✓ Preview opened in new window: ${newUrl}`);

    // Popover should close after clicking
    await expect(popover).not.toBeVisible();
    console.log('  ✓ Popover closed after click');

    await newPage.close();
    logTestResult('Preview link opens in new window', true);
  });

  test('Share publicly section shows text input and copy button', async ({ page }) => {
    // Note: This test requires the appbuilder-share-links feature flag to be enabled
    console.log('📱 Creating test app...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('view-share-token')} Simple hello world page`);

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();
    await handleSsoLogin(page);

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    await waitForChatInput(page);
    await dismissOverlays(page);

    console.log('✅ App created, testing Share publicly section...');

    // Open View & Share popover
    const viewShareButton = page.getByTestId('header-view-share-button');
    await viewShareButton.click();

    const popover = page.getByTestId('header-view-share-popover');
    await expect(popover).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // Check if share section is visible (depends on feature flag)
    const shareInput = page.getByTestId('header-view-share-input');
    const copyButton = page.getByTestId('header-view-share-copy');
    const countdownLabel = page.getByTestId('header-view-share-countdown');

    const inputVisible = await shareInput.isVisible().catch(() => false);
    const copyVisible = await copyButton.isVisible().catch(() => false);

    if (inputVisible && copyVisible) {
      console.log('  ✓ Share publicly text input is visible');
      console.log('  ✓ Copy button is visible');

      // Verify countdown label shows "Share this link for 7 days" (no token yet)
      const countdownVisible = await countdownLabel.isVisible().catch(() => false);
      if (countdownVisible) {
        const labelText = await countdownLabel.textContent();
        expect(labelText).toContain('Share this link');
        console.log(`  ✓ Countdown label visible: ${labelText}`);
      }

      // Verify input shows a cosmetic URL preview
      const inputValue = await shareInput.inputValue();
      expect(inputValue).toContain('...');
      console.log(`  ✓ Input shows cosmetic URL preview: ${inputValue}`);
    } else {
      console.log('  ⚠ Share section not visible (feature flag may be disabled)');
      test.skip();
      return;
    }

    logTestResult('Share publicly section shows text input and copy button', true);
  });
});
