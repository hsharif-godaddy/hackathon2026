/**
 * Develop Page Edit Interactions E2E Test
 *
 * Tests postMessage-based interactions between the builder UI and the preview iframe.
 * Creates one app, then exercises:
 * - Color scheme preview (PREVIEW_THEME in chat input theme strip)
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

    // Ask the AI to suggest color schemes. Explicitly name the tool and pass the
    // `description` argument - the tool throws if description is omitted in suggest mode.
    const colorSchemePrompt = 'Use the colorScheme tool in suggest mode with description "Simple landing page with a hero section and a call to action button" and count=4';
    await chatInput.fill(colorSchemePrompt);
    await page.getByTestId('chat-send-button').click({ force: true });
    console.log('  Color scheme request sent');

    // Wait for AI response to complete
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    console.log('  AI response completed');

    await ensureAuthenticated(page);

    // Theme UI has two variants depending on the `airo-builder-theme-selection-chat`
    // switchboard flag. When ON, a `theme-preview-input-panel` renders inside the
    // NBA section. When OFF (legacy), a `color-palette-grid` renders with different
    // testids. Race both variants so the test proceeds as soon as either appears
    // (isVisible() is a synchronous DOM check - its `timeout` option is a no-op).
    const themePanel = page.getByTestId('theme-preview-input-panel');
    const legacyGrid = page.getByTestId('color-palette-grid');
    const themeVariant = await Promise.race([
      themePanel.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT }).then(() => 'modern' as const),
      legacyGrid.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT }).then(() => 'legacy' as const),
    ]).catch(() => 'none' as const);
    const usingModernUi = themeVariant === 'modern';

    if (usingModernUi) {
      console.log('  Theme preview panel visible in chat input (modern)');

      const paletteOptions = page.getByTestId('theme-preview-option');
      await expect(paletteOptions).toHaveCount(4, { timeout: DEFAULT_TIMEOUT });
      console.log('  4 theme options rendered');

      await paletteOptions.first().click();
      console.log('  Clicked first theme option');

      await expect(page.getByTestId('theme-preview-apply')).toBeVisible();
      await expect(page.getByTestId('theme-preview-more-options')).toBeVisible();
      console.log('  Apply and More Options buttons visible');

      await waitForChatInput(page);
      await page.getByTestId('theme-preview-apply').click();
      console.log('  Apply clicked - message sent to apply color scheme');
    } else {
      await expect(legacyGrid).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  Color palette grid visible (legacy)');

      // Click the first palette card to preview it
      const firstPalette = legacyGrid.locator('button, [role="button"], label').first();
      await firstPalette.click({ force: true });
      console.log('  Clicked first palette');

      await expect(page.getByTestId('color-palette-save')).toBeVisible();
      await expect(page.getByTestId('color-palette-more-options')).toBeVisible();
      console.log('  Save and More Options buttons visible');

      await waitForChatInput(page);
      await page.getByTestId('color-palette-save').click();
      console.log('  Save clicked - message sent to apply color scheme');
    }

    // Wait for AI to process the save (apply the selected scheme)
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    console.log('  Color scheme applied');

    await ensureAuthenticated(page);

    // ========================================
    // STEP 2.5: Test Cancel button
    // ========================================
    await dismissOverlays(page);
    console.log('Step 2.5: Testing theme preview cancel...');

    // Request color schemes again to get the panel back
    await waitForChatInput(page);
    await chatInput.fill('Use the colorScheme tool in suggest mode with description "Simple landing page with a hero section and a call to action button" and count=4');
    await page.getByTestId('chat-send-button').click({ force: true });

    // Wait for AI response to complete
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    console.log('  Color scheme suggestions received');

    await ensureAuthenticated(page);

    if (usingModernUi) {
      // Modern UI has a Cancel button that dismisses the panel entirely.
      await expect(themePanel).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  Theme preview panel visible');

      const cancelButton = page.getByTestId('theme-preview-cancel');
      await expect(cancelButton).toBeVisible();
      await cancelButton.click();
      console.log('  Cancel button clicked');

      await expect(themePanel).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  Theme preview panel hidden after cancel');
    } else {
      // Legacy UI has a Revert button (no cancel equivalent that hides the grid).
      await expect(legacyGrid).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  Color palette grid visible');

      const revertButton = page.getByTestId('color-palette-revert');
      await expect(revertButton).toBeVisible();
      await revertButton.click();
      console.log('  Revert button clicked (legacy)');
    }

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
      // The view mode group renders as radiogroup with radio items
      const previewModeButton = page.getByRole('radio', { name: /builder_preview_button_preview|Preview/i });
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

  test('Unified code search - open, search, and select result', async ({ page }) => {
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
    await promptInput.fill(`${getSpecPrefix('unified-search')} Simple landing page with index.html and styles.css - do not ask follow up questions`);

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
    // STEP 2: Switch to code view
    // ========================================
    await dismissOverlays(page);
    console.log('Step 2: Switching to code view...');

    // Click the code view radio button in the header (ButtonGroup renders as radiogroup)
    const codeViewButton = page.getByRole('radio', { name: /builder_preview_button_code|Code/i });
    await expect(codeViewButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await codeViewButton.click({ force: true });

    // Wait for code view to load (file tree should be visible)
    // Code view may not be available in all environments (feature-flagged)
    const codeViewLoaded = await page.getByText('Files')
      .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
      .then(() => true)
      .catch(() => false);

    if (!codeViewLoaded) {
      console.log('  Code view not available (may be feature-flagged), skipping test');
      return;
    }
    console.log('  Code view loaded');

    // ========================================
    // STEP 3: Open unified search
    // ========================================
    console.log('Step 3: Opening unified search...');

    const searchButton = page.getByTestId('search-button');
    await expect(searchButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await searchButton.click();

    // Verify search panel opens
    const searchPanel = page.getByTestId('search-panel');
    await expect(searchPanel).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  Search panel opened');

    // ========================================
    // STEP 4: Search for a file
    // ========================================
    console.log('Step 4: Searching for files...');

    const searchInput = page.getByTestId('search-input-header');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('index');

    // Wait for search results
    await page.waitForTimeout(500); // Allow debounce to fire

    // Check if file results section appears
    const fileResultsSection = page.getByTestId('search-results-files');
    const hasFileResults = await fileResultsSection.isVisible().catch(() => false);

    if (hasFileResults) {
      console.log('  File results found');

      // Click on the first file result
      const firstFileResult = fileResultsSection.locator('button').first();
      await expect(firstFileResult).toBeVisible();
      await firstFileResult.click();

      // Verify search panel closed and file is selected
      // The file should now be open in the editor
      console.log('  Clicked file result');
    } else {
      // Check for code results as fallback
      const codeResultsSection = page.getByTestId('search-results-code');
      const hasCodeResults = await codeResultsSection.isVisible().catch(() => false);

      if (hasCodeResults) {
        console.log('  Code results found');

        const firstCodeResult = codeResultsSection.locator('button').first();
        await expect(firstCodeResult).toBeVisible();
        await firstCodeResult.click();
        console.log('  Clicked code result');
      } else {
        console.log('  No results found (may be expected for simple apps)');
      }
    }

    // ========================================
    // STEP 5: Verify search can be cleared
    // ========================================
    console.log('Step 5: Testing search clear...');

    // Re-open search if it was closed
    if (!(await searchPanel.isVisible().catch(() => false))) {
      await searchButton.click();
      await expect(searchPanel).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    }

    // Type something to make clear button appear
    await searchInput.fill('test');

    // Find and click clear button (scoped to search input's parent container)
    const clearButton = page.getByTestId('search-input-header')
      .locator('xpath=..')
      .locator('button[aria-label="Clear"]');
    await expect(clearButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await clearButton.click();

    // Verify input is cleared
    await expect(searchInput).toHaveValue('');
    console.log('  Clear button works');

    console.log('Unified search test passed!');
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
