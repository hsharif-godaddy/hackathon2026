/**
 * Publish Flow E2E Test (Single Flow)
 *
 * Tests automatic publishing via AI agent:
 * 1. Creates an app with prompt to publish
 * 2. Waits for AI agent to auto-publish
 * 3. Verifies success via publish button state and first-publish congrats modal or
 *    success Growl (first publish suppresses the growl in favor of the modal)
 *
 * Strategy:
 * - AI agent handles publishing automatically
 * - No manual publish clicks needed
 */
import { test, expect } from '@playwright/test';

import { deleteAllSitesViaAPI } from '../helpers/api';
import { handleSsoLogin, ensureAuthenticated } from '../helpers/auth';
import { LONG_TIMEOUT, DEPLOYMENT_TIMEOUT_MS, PUBLISH_TIMEOUT_MS, getSpecPrefix } from '../helpers/constants';
import { expectPublishSuccessVisible, waitForChatInput, waitForDevelopPage } from '../helpers/ui';

test.describe('Publish Flow', () => {
  test.beforeEach(async ({}, testInfo) => {
    const fullTitle = testInfo.titlePath.join(' > ');
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🚀 STARTING TEST`);
    console.log(`📄 File: ${testInfo.file?.split('/').pop() || 'unknown'}`);
    console.log(`🧪 Test: ${fullTitle}`);
    console.log(`${'='.repeat(70)}`);
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
    const publishButton = page.locator('[data-eid*="header"][data-eid*="publish"]');
    await expect(publishButton).not.toBeDisabled({ timeout: DEPLOYMENT_TIMEOUT_MS });
    console.log('  ✓ Publish button enabled');

    await expectPublishSuccessVisible(page, PUBLISH_TIMEOUT_MS);
    console.log('  ✓ Publish success (congrats modal or growl visible)');

    console.log('🎉 Publish flow test passed!');
  });

  test.afterEach(async ({ page }, testInfo) => {
    console.log('🧹 Cleanup...');
    try {
      await page.goto('/apps');
      await deleteAllSitesViaAPI(page);
    } catch {
      console.log('  ⚠ Cleanup skipped');
    }

    // Log test result with details
    const fullTitle = testInfo.titlePath.join(' > ');
    const duration = ((testInfo.duration || 0) / 1000).toFixed(1);
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🏁 TEST COMPLETED`);
    console.log(`📄 File: ${testInfo.file?.split('/').pop() || 'unknown'}`);
    console.log(`🧪 Test: ${fullTitle}`);
    console.log(`⏱️ Duration: ${duration}s`);

    if (testInfo.status === 'passed') {
      console.log(`✅ Status: PASSED`);
    } else if (testInfo.status === 'failed') {
      console.log(`❌ Status: FAILED`);
      if (testInfo.error) {
        const errorLines = testInfo.error.message?.split('\n') || [];
        console.log(`💥 Error Type: ${testInfo.error.name || 'Error'}`);
        console.log(`💥 Message: ${errorLines[0] || 'Unknown error'}`);
        // Show locator info if present
        const locatorLine = errorLines.find(l => l.includes('Locator:'));
        if (locatorLine) console.log(`🎯 ${locatorLine.trim()}`);
        // Show expected/received if present
        const expectedLine = errorLines.find(l => l.includes('Expected:'));
        const receivedLine = errorLines.find(l => l.includes('Received:'));
        if (expectedLine) console.log(`   ${expectedLine.trim()}`);
        if (receivedLine) console.log(`   ${receivedLine.trim()}`);
        // Show file location from stack
        const stackMatch = testInfo.error.stack?.match(/at.*\((.*:\d+:\d+)\)/);
        if (stackMatch) console.log(`📍 Location: ${stackMatch[1]}`);
      }
    } else if (testInfo.status === 'skipped') {
      console.log(`⏭️ Status: SKIPPED`);
    }
    console.log(`${'='.repeat(70)}\n`);
  });
});
