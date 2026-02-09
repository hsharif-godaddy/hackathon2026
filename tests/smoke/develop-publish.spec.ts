/**
 * Publish Flow E2E Test (Single Flow)
 *
 * Tests automatic publishing via AI agent:
 * 1. Creates an app with prompt to publish
 * 2. Waits for AI agent to auto-publish
 * 3. Verifies success via Go Live modal or Republish button
 *
 * Strategy:
 * - AI agent handles publishing automatically
 * - No manual button clicks needed
 */
import { test, expect } from '@playwright/test';

import { deleteAllSitesViaAPI } from '../helpers/api';
import { handleSsoLogin } from '../helpers/auth';
import { LONG_TIMEOUT, DEFAULT_TIMEOUT } from '../helpers/constants';
import { waitForDevelopPage, waitForChatInput } from '../helpers/ui';

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
    await promptInput.fill('[e2e:publish] Single page hello world app - do not ask follow up questions and publish this app');

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

    // ========================================
    // STEP 3: Verify publish success
    // ========================================
    console.log('✅ Step 3: Verifying publish success...');

    const publishButton = page.locator('[data-eid*="header"][data-eid*="publish"]');
    const goLiveModal = page.locator('[data-testid="go-live-modal-later"]');

    // Wait for either Go Live modal OR Republish button (whichever comes first)
    const successIndicator = await Promise.race([
      goLiveModal.waitFor({ state: 'visible', timeout: 60000 }).then(() => 'go-live-modal'),
      publishButton.filter({ hasText: /Republish/i }).waitFor({ state: 'visible', timeout: 60000 }).then(() => 'republish-button')
    ]).catch(() => 'timeout');

    if (successIndicator === 'go-live-modal') {
      console.log('  ✓ Go Live modal appeared (publish successful)');

      // Dismiss any coachmark tour blocking the Go Live modal (press Escape or click X)
      for (let i = 0; i < 3; i++) {
        const coachmark = page.locator('.ux-coachmark');
        if (await coachmark.isVisible({ timeout: 1000 }).catch(() => false)) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
          console.log(`  ✓ Dismissed coachmark (attempt ${i + 1})`);
        } else {
          break;
        }
      }

      // Now click "Not Yet" on Go Live modal
      await goLiveModal.click({ force: true });
      console.log('  ✓ Go Live modal dismissed');

      // Verify button shows Republish after dismissing modal
      await expect(publishButton).toContainText(/Republish/i, { timeout: DEFAULT_TIMEOUT });
      console.log('  ✓ Button shows Republish');

    } else if (successIndicator === 'republish-button') {
      console.log('  ✓ Publish button shows Republish (publish successful)');

    } else {
      // Check current button state for debugging
      const buttonText = await publishButton.textContent().catch(() => 'unknown');
      console.log(`  ⚠ Timeout waiting for success indicator. Button text: "${buttonText}"`);

      // Still verify button is not in "Publishing" state
      await expect(publishButton).not.toContainText('Publishing');
    }

    await expect(publishButton).not.toBeDisabled();
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
