/**
 * Publish Flow E2E Tests
 *
 * Tests automatic publishing via AI agent:
 * 1. Creates an app with prompt to publish
 * 2. Waits for AI agent to auto-publish
 * 3. Verifies success via publish button state and first-publish congrats modal or
 *    success Growl (first publish suppresses the growl in favor of the modal)
 *
 * Second test: after publish, publish popover → Pre-Launch Check → SEO prompt in chat
 * (`post-publish-feature-selection`, `post-publish-prelaunch-seo-prompt`).
 *
 * Strategy:
 * - AI agent handles publishing automatically
 * - No manual publish clicks needed
 */
import { test, expect } from '@playwright/test';

import { deleteAllSitesViaAPI } from '../helpers/api';
import { handleSsoLogin, ensureAuthenticated } from '../helpers/auth';
import {
  AI_RESPONSE_TIMEOUT_MS,
  DEFAULT_TIMEOUT,
  DEPLOYMENT_TIMEOUT_MS,
  LONG_TIMEOUT,
  PUBLISH_TIMEOUT_MS,
  getSpecPrefix,
} from '../helpers/constants';
import {
  dismissGoLiveModalIfPresent,
  dismissOverlays,
  expectPublishSuccessVisible,
  logTestResult,
  logTestStart,
  waitForChatInput,
  waitForDevelopPage,
} from '../helpers/ui';

test.describe('Publish Flow', () => {
  test.beforeEach(async ({}, testInfo) => {
    logTestStart(testInfo);
  });

  test('AI Auto-Publish - Create App, Deploy & Verify Live Status', async ({ page }) => {
    // ========================================
    // STEP 1: Create app with publish instruction
    // ========================================
    console.log('📱 Step 1: Creating app with publish instruction...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('publish')} Single page hello world app - do not ask follow up questions and publish this app`);

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    // Handle SSO login
    await handleSsoLogin(page);

    // Wait for app creation and redirect to develop
    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
    console.log(`✅ App created: ${appId}`);

    // ========================================
    // STEP 2: Wait for AI to complete and publish
    // ========================================
    console.log('🤖 Step 2: Waiting for AI agent to publish...');

    // Wait for chat input to be available (AI finished processing)
    await waitForChatInput(page);
    console.log('  ✓ AI processing complete');

    // Session may have expired during AI generation + publish
    await ensureAuthenticated(page);

    // ========================================
    // STEP 3: Verify publish success
    // ========================================
    console.log('✅ Step 3: Verifying publish success...');

    // Verify publish button is enabled and interactive after deploy
    const publishButton = page
      .getByTestId('airo-header')
      .getByRole('button', { name: /publish/i });
    await expect(publishButton).not.toBeDisabled({ timeout: DEPLOYMENT_TIMEOUT_MS });
    console.log('  ✓ Publish button enabled');

    await expectPublishSuccessVisible(page, PUBLISH_TIMEOUT_MS);
    console.log('  ✓ Publish success (congrats modal or growl visible)');

    console.log('🎉 Publish flow test passed!');
  });

  test('Publish popover — Pre-Launch Check opens SEO prompt and sends SEO action', async ({ page }, testInfo) => {
    testInfo.setTimeout(600_000);

    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    console.log('📱 Step 1: Creating app with publish instruction...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(
      `${getSpecPrefix('publish-seo')} Single page hello world app - do not ask follow up questions and publish this app`,
    );

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    await handleSsoLogin(page);

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    console.log('🤖 Step 2: Waiting for AI agent to publish...');
    await waitForChatInput(page);
    await ensureAuthenticated(page);

    const publishButton = page.getByTestId('airo-header').getByRole('button', { name: /publish/i });
    await expect(publishButton).not.toBeDisabled({ timeout: DEPLOYMENT_TIMEOUT_MS });

    await expectPublishSuccessVisible(page, PUBLISH_TIMEOUT_MS);
    console.log('  ✓ Publish success');

    const congratsModal = page.locator('#first-publish-congrats-modal');
    if (await congratsModal.isVisible({ timeout: DEFAULT_TIMEOUT }).catch(() => false)) {
      await page.keyboard.press('Escape');
      await expect(congratsModal).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  ✓ Dismissed first-publish congrats modal');
    }

    await dismissGoLiveModalIfPresent(page);
    await dismissOverlays(page);

    console.log('📋 Step 3: Open publish popover → Pre-Launch Check → SEO prompt');
    await publishButton.click();

    await expect(
      page.getByText(/builder_publish_popover_title|Publish Your App/i),
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const preLaunchCheck = page.getByRole('button', {
      name: /builder_golive_marketing_seo_title|SEO Optimization/i,
    });

    const isPreLaunchVisible = await preLaunchCheck.isVisible({ timeout: DEFAULT_TIMEOUT }).catch(() => false);
    if (!isPreLaunchVisible) {
      console.log('  Pre-Launch Check not visible (feature flag off in this environment), skipping');
      test.skip();
      return;
    }

    await preLaunchCheck.click();

    const featureSelection = page.getByTestId('post-publish-feature-selection');
    await expect(featureSelection).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.getByTestId('post-publish-prelaunch-seo-prompt')).toBeVisible();

    await page.getByTestId('post-publish-prelaunch-seo-run-button').getByRole('button').click();

    await expect(featureSelection).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });

    await expect(
      page.getByText(/Run an SEO check|builder_post_publish_prelaunch_seo_action_message/i),
    ).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });

    console.log('🎉 Post-publish Pre-Launch SEO smoke passed!');
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);

    console.log('🧹 Cleanup...');
    try {
      await page.goto('/apps');
      await deleteAllSitesViaAPI(page);
    } catch {
      console.log('  ⚠ Cleanup skipped');
    }
  });
});
