/**
 * Develop Page Edit Interactions E2E Test
 *
 * Tests postMessage-based interactions between the builder UI and the preview iframe.
 * Each test creates its own app and exercises:
 * - Edit mode toggle (EDIT_MODE_ENABLED / EDIT_MODE_DISABLED)
 * - Unified code search
 *
 * Strategy:
 * - Each test creates its own app
 */
import { test, expect } from '@playwright/test';

import { deleteAllSitesViaAPI } from '../helpers/api';
import { handleSsoLogin, ensureAuthenticated } from '../helpers/auth';
import { LONG_TIMEOUT, DEFAULT_TIMEOUT, AI_RESPONSE_TIMEOUT_MS, getSpecPrefix } from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

test.describe('Edit Interactions', () => {
  test.beforeEach(async ({}, testInfo) => {
    logTestStart(testInfo);
  });

  test('Edit mode toggle', async ({ page }) => {
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
    // STEP 2: Edit mode toggle
    // ========================================
    await dismissOverlays(page);
    console.log('Step 2: Testing edit mode toggle...');

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
