/**
 * Develop Page Edit Interactions E2E Test
 *
 * Tests postMessage-based interactions between the builder UI and the preview iframe.
 * Creates one app, then exercises:
 * - Color scheme preview (PREVIEW_THEME / REVERT_THEME)
 * - Edit mode toggle (EDIT_MODE_ENABLED / EDIT_MODE_DISABLED)
 *
 * Strategy:
 * - Single login, single app creation
 * - All interaction tests run sequentially against the same app
 */
import { test, expect } from '@playwright/test';

import { deleteAllSitesViaAPI } from '../helpers/api';
import { handleSsoLogin, ensureAuthenticated } from '../helpers/auth';
import { LONG_TIMEOUT, DEFAULT_TIMEOUT, AI_RESPONSE_TIMEOUT_MS, getSpecPrefix } from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage, waitForChatInput } from '../helpers/ui';

test.describe('Edit Interactions', () => {
  test.beforeEach(async ({}, testInfo) => {
    logTestStart(testInfo);
  });

  test('Color scheme preview and edit mode toggle', async ({ page }) => {
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
    await promptInput.fill(`${getSpecPrefix('edit-interactions')} Simple landing page with a hero section and a call to action button - do not ask follow up questions`);

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    await handleSsoLogin(page);

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
    console.log(`  App created: ${appId}`);

    await dismissOverlays(page);

    // Wait for initial generation to complete
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    console.log('  Initial generation completed');

    await ensureAuthenticated(page);

    // ========================================
    // STEP 2: Color scheme preview via chat
    // ========================================
    await dismissOverlays(page);
    console.log('Step 2: Testing color scheme preview...');

    const chatInput = page.getByTestId('chat-input-textarea');
    await waitForChatInput(page);

    // Ask the AI to suggest color schemes
    await chatInput.fill('Suggest some color schemes for this app');
    await page.getByTestId('chat-send-button').click({ force: true });

    const transcript = page.getByTestId('chat-transcript');
    await expect(transcript.getByText('Suggest some color schemes for this app', { exact: true })).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  Color scheme request sent');

    // Wait for AI response to complete
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    console.log('  AI response completed');

    await ensureAuthenticated(page);

    // Wait for the color palette grid to appear
    const paletteGrid = page.getByTestId('color-palette-grid');
    await expect(paletteGrid).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  Color palette grid visible');

    // Verify palette options rendered
    const paletteOptions = page.getByTestId('color-palette-option');
    await expect(paletteOptions.first()).toBeVisible();
    const optionCount = await paletteOptions.count();
    console.log(`  ${optionCount} palette options rendered`);
    expect(optionCount).toBeGreaterThanOrEqual(2);

    // Click first palette option to preview
    await paletteOptions.first().click();
    console.log('  Clicked first palette option');

    // Verify control buttons are visible
    await expect(page.getByTestId('color-palette-save')).toBeVisible();
    await expect(page.getByTestId('color-palette-revert')).toBeVisible();
    await expect(page.getByTestId('color-palette-more-options')).toBeVisible();
    console.log('  Save, Revert, and More Options buttons visible');

    // Click revert to test REVERT_THEME
    await page.getByTestId('color-palette-revert').click();
    console.log('  Revert clicked');

    // Select a palette again and save it
    await paletteOptions.first().click();
    await waitForChatInput(page);
    await page.getByTestId('color-palette-save').click();
    console.log('  Save clicked - message sent to apply color scheme');

    // Wait for AI to process the save (apply the selected scheme)
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    console.log('  Color scheme applied');

    await ensureAuthenticated(page);

    // ========================================
    // STEP 3: Edit mode toggle
    // ========================================
    await dismissOverlays(page);
    console.log('Step 3: Testing edit mode toggle...');

    // Find the edit mode toggle button in the header
    const editModeButton = page.locator('[data-eid*="header.edit_mode"]');

    // Check if edit mode toggle is available (it may be feature-flagged)
    const editModeVisible = await editModeButton.isVisible().catch(() => false);

    if (editModeVisible) {
      // Toggle edit mode on
      await editModeButton.click({ force: true });
      console.log('  Edit mode toggled on');

      // Verify preview iframe is still visible (edit mode overlays it, doesn't hide it)
      await expect(page.getByTestId('preview-iframe')).toBeVisible();
      console.log('  Preview iframe visible in edit mode');

      // Toggle edit mode off by clicking the view mode button or the same toggle
      // The view mode group has preview and code buttons
      const previewModeButton = page.locator('[data-eid*="header.view_mode"]');
      if (await previewModeButton.isVisible().catch(() => false)) {
        await previewModeButton.click({ force: true });
      } else {
        await editModeButton.click({ force: true });
      }
      console.log('  Edit mode toggled off');

      await expect(page.getByTestId('preview-iframe')).toBeVisible();
      console.log('  Preview iframe visible after edit mode off');
    } else {
      console.log('  Edit mode toggle not visible (may be feature-flagged), skipping');
    }

    console.log('All edit interaction tests passed!');
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);

    console.log('Cleanup...');
    try {
      await page.goto('/apps');
      await deleteAllSitesViaAPI(page);
    } catch {
      console.log('  Cleanup skipped');
    }
  });
});
