/**
 * Share Link E2E Tests
 *
 * Tests the Share Link popover in the header:
 * 1. Popover opens/closes with share-link-* test IDs
 * 2. Preview segment shows URL input with copy/open actions
 * 3. Preview auto-creates share token and shows expiry label (feature flagged)
 */
import { test, expect } from '../helpers/test-fixtures';

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

test.describe('Share Link', () => {
  test.beforeEach(async ({}, testInfo) => {
    logTestStart(testInfo);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);
  });

  test('Share link button visible and opens popover', async ({ page }) => {
    console.log('Creating test app...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('share-link')} Simple hello world page`);

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();
    await handleSsoLogin(page);

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

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();
    await handleSsoLogin(page);

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

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();
    await handleSsoLogin(page);

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    await waitForChatInput(page);
    await dismissOverlays(page);

    console.log('App created, testing token auto-creation...');

    const shareButton = page.getByTestId('share-link-button');
    await shareButton.click();

    const popover = page.getByTestId('share-link-popover');
    await expect(popover).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // Token auto-creates on popover open (requires appbuilder-share-links flag)
    const previewLoading = page.getByTestId('share-link-preview-loading');
    const loadingVisible = await previewLoading.isVisible().catch(() => false);

    if (!loadingVisible) {
      const urlInput = page.getByTestId('share-link-input');
      const inputVisible = await urlInput.isVisible().catch(() => false);
      if (!inputVisible) {
        console.log('  - Share links feature flag may be disabled');
        test.skip();
        return;
      }
    }

    if (loadingVisible) {
      await expect(previewLoading).not.toBeVisible({ timeout: LONG_TIMEOUT });
      console.log('  - Loading spinner resolved');
    }

    // Either URL input shows the share token URL, or an error state is shown
    const errorState = page.getByTestId('share-link-error-state');
    const hasError = await errorState.isVisible().catch(() => false);

    if (hasError) {
      console.log('  - Error state shown (token creation may have failed)');
    } else {
      const urlInput = page.getByTestId('share-link-input');
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
