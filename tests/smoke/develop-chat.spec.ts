/**
 * Develop Page E2E Test (Single Flow)
 *
 * Comprehensive test of develop page in ONE continuous flow:
 * - Header (logo, beta tag, publish, user menu, navigation)
 * - Preview pane (iframe, refresh, device selector)
 * - Chat (toolbar, input states, send messages, AI response)
 * - Loading states (page load, refresh recovery)
 *
 * Strategy:
 * - Single login, single browser session
 * - All develop page tests run sequentially
 *
 * Note: Consolidates develop-header, develop-loading, develop-preview, develop-chat
 */
import { test, expect } from '@playwright/test';

import { deleteAllSitesViaAPI } from '../helpers/api';
import { handleSsoLogin, openUserMenu } from '../helpers/auth';
import { LONG_TIMEOUT, DEFAULT_TIMEOUT, PREVIEW_TIMEOUT, AI_RESPONSE_TIMEOUT_MS, CHAT_INPUT_TIMEOUT } from '../helpers/constants';
import { waitForDevelopPage, waitForChatInput } from '../helpers/ui';

test.describe('Develop Page', () => {
  test.beforeEach(async ({}, testInfo) => {
    const fullTitle = testInfo.titlePath.join(' > ');
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🚀 STARTING TEST`);
    console.log(`📄 File: ${testInfo.file?.split('/').pop() || 'unknown'}`);
    console.log(`🧪 Test: ${fullTitle}`);
    console.log(`${'='.repeat(70)}`);
  });

  test('Header, Preview, Chat & Navigation - Full UI Flow', async ({ page }) => {
    // ========================================
    // STEP 1: Create an app (with login)
    // ========================================
    console.log('📱 Step 1: Creating app...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill('[e2e:develop] Single page hello world app - do not ask follow up questions');

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    // Handle SSO login
    await handleSsoLogin(page);

    // Wait for app creation and redirect to develop
    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
    console.log(`✅ App created: ${appId}`);

    // Dismiss any blocking overlays (coachmark tours, backdrops)
    for (let i = 0; i < 5; i++) {
      const backdrop = page.locator('.ux-disrupt-backdrop');
      if (await backdrop.isVisible({ timeout: 1000 }).catch(() => false)) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        console.log(`  ✓ Dismissed overlay (attempt ${i + 1})`);
      } else {
        break;
      }
    }

    // ========================================
    // STEP 2: Verify all components loaded
    // ========================================
    console.log('🔧 Step 2: Verifying all components loaded...');

    // Header - skip HCS header (id="hcs-header-container"), target Airo header
    const airoHeader = page.locator('header:not(#hcs-header-container)').first();
    await expect(airoHeader).toBeVisible();
    console.log('  ✓ Header visible');

    // Publish button (use data-eid to avoid matching modal buttons)
    const publishButton = page.locator('[data-eid*="header"][data-eid*="publish"]');
    await expect(publishButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(publishButton).not.toBeDisabled();
    console.log('  ✓ Publish button visible and enabled');

    // Chat input
    await page.locator('textarea[placeholder*="Ask Airo"]').waitFor({ state: 'visible', timeout: CHAT_INPUT_TIMEOUT });
    await expect(page.locator('textarea[placeholder*="Ask Airo"]')).not.toBeDisabled();
    console.log('  ✓ Chat input visible and enabled');

    // Preview iframe
    await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });
    await expect(page.locator('#preview-iframe')).toHaveAttribute('src', /.+/);
    console.log('  ✓ Preview iframe loaded with src');

    // ========================================
    // STEP 3: Test header elements
    // ========================================
    console.log('🏷️ Step 3: Testing header elements...');

    // Verify user menu shows Sign Out
    await openUserMenu(page);
    await expect(page.locator('[data-eid*="user_menu.sign_out"]')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    console.log('  ✓ User menu shows Sign Out (authenticated)');

    // ========================================
    // STEP 4: Test preview controls
    // ========================================
    console.log('🖼️ Step 4: Testing preview controls...');

    // Verify controls exist
    await expect(page.locator('[data-eid*="preview.refresh"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('[data-eid*="preview.device_selector"]')).toBeVisible();
    console.log('  ✓ Refresh and device selector visible');

    // Test refresh button
    await page.locator('[data-eid*="preview.refresh"]').click({ force: true });
    await expect(page.locator('#preview-iframe')).toBeVisible();
    console.log('  ✓ Refresh button works');

    // Test device selector - mobile view
    await page.locator('[data-eid*="preview.device_selector"]').click({ force: true });
    await page.locator('[data-radix-popper-content-wrapper]')
      .locator('[data-eid*="preview.device_select_iphone-se"]')
      .click({ force: true });
    await expect(page.locator('#preview-iframe')).toBeVisible();
    await expect(page.locator('header:not(#hcs-header-container)').first()).toBeVisible();
    console.log('  ✓ Mobile view works, header persists');

    // Test device selector - back to desktop
    await page.locator('[data-eid*="preview.device_selector"]').click({ force: true });
    await page.locator('[data-radix-popper-content-wrapper]')
      .locator('[data-eid*="preview.device_select_full"]')
      .click({ force: true });
    await expect(page.locator('#preview-iframe')).toBeVisible();
    console.log('  ✓ Desktop view restored');

    // ========================================
    // STEP 5: Test chat toolbar navigation
    // ========================================
    console.log('🔧 Step 5: Testing chat toolbar...');

    // Verify toolbar buttons
    await expect(page.locator('[data-eid*="chat_toolbar.chat"]')).toBeVisible();
    await expect(page.locator('[data-eid*="chat_toolbar.medias"]')).toBeVisible();
    await expect(page.locator('[data-eid*="chat_toolbar.history"]')).toBeVisible();
    await expect(page.locator('[data-eid*="chat_toolbar.settings"]')).toBeVisible();
    console.log('  ✓ All toolbar buttons visible');

    // Navigate to history and back
    await page.locator('[data-eid*="chat_toolbar.history"]').click({ force: true });
    await expect(page.locator('header:not(#hcs-header-container)').first()).toBeVisible();
    await page.locator('[data-eid*="chat_toolbar.chat"]').click({ force: true });
    await page.locator('textarea[placeholder*="Ask Airo"]').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    console.log('  ✓ History tab navigation works, header persists');

    // Verify medias button exists
    await expect(page.locator('[data-eid*="chat_toolbar.medias"]')).toBeVisible();
    console.log('  ✓ Media tab button visible');

    // ========================================
    // STEP 6: Test chat input states
    // ========================================
    console.log('📝 Step 6: Testing chat input states...');

    const chatInput = page.locator('#chat-input-textarea');
    await waitForChatInput(page);

    // Send button disabled when empty
    await chatInput.clear();
    await expect(page.locator('#chat-send-button')).toBeDisabled();
    console.log('  ✓ Send button disabled when empty');

    // Send button enabled when text
    await chatInput.fill('Test message');
    await expect(page.locator('#chat-send-button')).not.toBeDisabled();
    console.log('  ✓ Send button enabled when text entered');

    // Shift+Enter multiline
    await chatInput.clear();
    await chatInput.fill('Line 1');
    await chatInput.press('Shift+Enter');
    await chatInput.type('Line 2');
    const multilineValue = await chatInput.inputValue();
    expect(multilineValue).toContain('Line 1');
    expect(multilineValue).toContain('Line 2');
    console.log('  ✓ Shift+Enter creates multiline without sending');

    await chatInput.clear();

    // ========================================
    // STEP 7: Test sending message via click
    // ========================================
    console.log('🖱️ Step 7: Testing send via click...');

    // Dismiss any overlay that might be blocking
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const clickMessage = 'Add a header section';
    await chatInput.fill(clickMessage);
    await page.locator('#chat-send-button').click({ force: true });

    // Verify message appears in transcript (confirms it was sent)
    const transcript = page.getByTestId('chat-transcript');
    await expect(transcript.getByText(clickMessage, { exact: true })).toBeVisible({ timeout: 10000 });
    console.log('  ✓ Message sent via click');

    // Wait for AI response
    await expect(async () => {
      const isDisabled = await chatInput.isDisabled();
      expect(isDisabled).toBe(false);
    }).toPass({ timeout: AI_RESPONSE_TIMEOUT_MS });
    console.log('  ✓ AI response completed');

    // ========================================
    // STEP 8: Test sending message via Enter
    // ========================================
    console.log('⌨️ Step 8: Testing send via Enter...');

    const enterMessage = 'Add a footer';
    await chatInput.clear();
    await chatInput.fill(enterMessage);
    await chatInput.press('Enter');

    // Verify message appears in transcript (confirms it was sent)
    await expect(transcript.getByText(enterMessage, { exact: true })).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  ✓ Message sent via Enter');

    // Wait for AI response
    await expect(async () => {
      const isDisabled = await chatInput.isDisabled();
      expect(isDisabled).toBe(false);
    }).toPass({ timeout: AI_RESPONSE_TIMEOUT_MS });
    console.log('  ✓ AI response completed');

    // ========================================
    // STEP 9: Test page refresh recovery
    // ========================================
    console.log('🔄 Step 9: Testing page refresh...');

    await page.reload();

    await expect(page).toHaveURL(/\/develop\//);
    await expect(page.locator('header:not(#hcs-header-container)').first()).toBeVisible();
    await page.locator('textarea[placeholder*="Ask Airo"]').waitFor({ state: 'visible', timeout: CHAT_INPUT_TIMEOUT });
    await expect(page.locator('textarea[placeholder*="Ask Airo"]')).not.toBeDisabled();
    await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });
    console.log('  ✓ Page refresh maintains state');

    console.log('🎉 All develop page tests passed!');
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
