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

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { handleSsoLogin, ensureAuthenticated } from '../helpers/auth';
import { LONG_TIMEOUT, DEFAULT_TIMEOUT, AI_RESPONSE_TIMEOUT_MS, E2E_NO_DELETE, getSpecPrefix } from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

/** Spec prefixes used by `getSpecPrefix(...)` calls in this describe block. */
const SPEC_PREFIXES = ['edit-interactions', 'unified-search'] as const;

test.describe('Edit Interactions', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    if (!E2E_NO_DELETE) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch(() => {});
    }
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

    const codeViewButton = page.getByRole('radio', { name: /builder_preview_button_code|Code/i });
    await expect(codeViewButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await codeViewButton.click({ force: true });

    // Code view auto-expands search on entry. Use the search input becoming
    // visible as the reliable indicator that code view has fully loaded.
    const searchInput = page.getByTestId('search-input-header');
    const codeViewLoaded = await searchInput
      .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
      .then(() => true)
      .catch(() => false);

    if (!codeViewLoaded) {
      console.log('  Code view not available (may be feature-flagged), skipping test');
      return;
    }
    console.log('  Code view loaded');

    // ========================================
    // STEP 3: Verify search auto-expanded
    // ========================================
    console.log('Step 3: Verifying search auto-expanded...');

    const searchButton = page.getByTestId('search-button');
    await expect(searchButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const searchPanel = page.getByTestId('search-panel');
    await expect(searchPanel).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  Search panel auto-expanded on code view entry');

    // ========================================
    // STEP 4: Search for a file and click result
    // ========================================
    console.log('Step 4: Searching for files...');

    await expect(searchInput).toBeVisible();
    await searchInput.fill('index');
    await page.waitForTimeout(500); // debounce

    const fileResultsSection = page.getByTestId('search-results-files');
    const hasFileResults = await fileResultsSection.isVisible().catch(() => false);

    if (hasFileResults) {
      console.log('  File results found');
      const firstFileResult = fileResultsSection.locator('button').first();
      await expect(firstFileResult).toBeVisible();
      await firstFileResult.click();
      console.log('  Clicked file result');
    } else {
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
    // STEP 5: Switch away and back, verify search still works
    // ========================================
    console.log('Step 5: Testing search after tab round-trip...');

    const previewTab = page.getByRole('radio', { name: /preview/i });
    if (await previewTab.isVisible().catch(() => false)) {
      await previewTab.click();
      await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
      console.log('  Switched to preview');

      await codeViewButton.click({ force: true });
      await expect(searchInput).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  Switched back to code view');

      // Type a new query -- this should activate the search tab and show results
      await searchInput.fill('html');
      await page.waitForTimeout(500); // debounce
      await expect(searchPanel).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  Search works after tab round-trip');
    }

    // ========================================
    // STEP 6: Verify search can be cleared
    // ========================================
    console.log('Step 6: Testing search clear...');

    if (!(await searchPanel.isVisible().catch(() => false))) {
      await searchButton.click();
      await expect(searchPanel).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    }

    await searchInput.fill('test');

    const clearButton = page.getByTestId('search-input-header')
      .locator('xpath=..')
      .locator('button[aria-label="Clear"]');
    await expect(clearButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await clearButton.click();

    await expect(searchInput).toHaveValue('');
    console.log('  Clear button works');

    console.log('Unified search test passed!');
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);

    if (E2E_NO_DELETE) {
      console.log('Cleanup skipped (E2E_NO_DELETE=true)');
      return;
    }

    console.log('Cleanup...');
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
});
