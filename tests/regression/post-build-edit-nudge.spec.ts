/**
 * Post-build edit nudge regression test.
 *
 * Verifies one-time nudge behavior:
 * - appears after first iframe interaction
 * - dismisses via close button
 * - does not reappear after reload once persisted in localStorage
 */
import { expect, test } from '@playwright/test';

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { ensureAuthenticated, handleSsoLogin } from '../helpers/auth';
import {
  AI_RESPONSE_TIMEOUT_MS,
  DEFAULT_TIMEOUT,
  E2E_NO_DELETE,
  LONG_TIMEOUT,
  PREVIEW_TIMEOUT,
  getSpecPrefix,
} from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

/** Spec prefixes used by `getSpecPrefix(...)` calls in this describe block. */
const SPEC_PREFIXES = ['post-build-edit-nudge'] as const;

test.describe('Post-build edit nudge', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    if (!E2E_NO_DELETE) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch(() => {});
    }
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);

    if (E2E_NO_DELETE) {
      console.log('🧹 Cleanup skipped (E2E_NO_DELETE=true)');
      return;
    }

    console.log('🧹 Cleanup...');
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

  test('shows once after iframe interaction and stays dismissed after reload', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
      const globalWindow = window as unknown as { gasketData?: { switchboard?: Record<string, boolean> } };
      globalWindow.gasketData = globalWindow.gasketData ?? {};
      globalWindow.gasketData.switchboard = {
        ...(globalWindow.gasketData.switchboard ?? {}),
        'appbuilder-post-build-edit-nudge': true,
      };
    });

    await page.goto('/');
    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('post-build-edit-nudge')} Simple landing page with hero and CTA, no follow up questions`);
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    await handleSsoLogin(page);
    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    await ensureAuthenticated(page);
    await dismissOverlays(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] ?? '';
    const storageKey = `airo-edit-nudge-shown-${appId}`;

    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });

    const previewFrame = page.frameLocator('[data-testid="preview-iframe"]');
    await previewFrame.locator('body').click({ position: { x: 24, y: 24 }, timeout: DEFAULT_TIMEOUT });

    const closeButton = page.getByTestId('post-build-edit-nudge-close');
    await expect(closeButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await closeButton.click();
    await expect(closeButton).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });

    await expect.poll(
      async () => page.evaluate((key) => window.localStorage.getItem(key), storageKey),
      { timeout: DEFAULT_TIMEOUT }
    ).toBe('true');

    await page.reload();
    await ensureAuthenticated(page);
    await waitForDevelopPage(page);
    await expect(page.getByTestId('post-build-edit-nudge-close')).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });
  });
});
