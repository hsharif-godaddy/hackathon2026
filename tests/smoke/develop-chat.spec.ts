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
 *
 * Coverage gap: staged-file send (uploadChatFiles → agent multipart) is not exercised here —
 * depends on a live agent and is high flake risk in smoke. Step 6b only validates drop/paste
 * staging; add a dedicated integration or nightly test if we need upload path coverage.
 */
import { test, expect } from '@playwright/test';

import { deleteAllSitesViaAPI } from '../helpers/api';
import { handleSsoLogin, openUserMenu, ensureAuthenticated } from '../helpers/auth';
import { LONG_TIMEOUT, DEFAULT_TIMEOUT, PREVIEW_TIMEOUT, AI_RESPONSE_TIMEOUT_MS, CHAT_INPUT_TIMEOUT, getSpecPrefix } from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage, waitForChatInput } from '../helpers/ui';

test.describe('Develop Page', () => {
  test.beforeEach(async ({}, testInfo) => {
    logTestStart(testInfo);
  });

  test('Header, Preview, Chat & Navigation - Full UI Flow', async ({ page }) => {
    // ========================================
    // STEP 1: Create an app (with login)
    // ========================================
    console.log('📱 Step 1: Creating app...');

    // Prevent coachmark tour from appearing
    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('develop')} Single page hello world app - do not ask follow up questions`);

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    // Handle SSO login
    await handleSsoLogin(page);

    // Wait for app creation and redirect to develop
    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
    console.log(`✅ App created: ${appId}`);

    await dismissOverlays(page);

    // ========================================
    // STEP 2: Verify all components loaded
    // ========================================
    console.log('🔧 Step 2: Verifying all components loaded...');

    // Header
    const airoHeader = page.getByTestId('airo-header');
    await expect(airoHeader).toBeVisible();
    console.log('  ✓ Header visible');

    // Publish button (use data-eid to avoid matching modal buttons)
    const publishButton = page.locator('[data-eid*="header"][data-eid*="publish"]');
    await expect(publishButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(publishButton).not.toBeDisabled();
    console.log('  ✓ Publish button visible and enabled');

    // Chat input
    await page.getByTestId('chat-input-textarea').waitFor({ state: 'visible', timeout: CHAT_INPUT_TIMEOUT });
    await expect(page.getByTestId('chat-input-textarea')).not.toBeDisabled();
    console.log('  ✓ Chat input visible and enabled');

    // Preview iframe
    await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });
    await expect(page.getByTestId('preview-iframe')).toHaveAttribute('src', /.+/);
    console.log('  ✓ Preview iframe loaded with src');

    // ========================================
    // STEP 3: Test header elements
    // ========================================
    await dismissOverlays(page);
    console.log('🏷️ Step 3: Testing header elements...');

    // Verify user menu shows expected items for authenticated users
    await openUserMenu(page);
    await expect(page.locator('[data-eid*="user_menu.sign_out"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-eid*="user_menu.my_products"]')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    console.log('  ✓ User menu shows Sign Out and My Products (authenticated)');

    // ========================================
    // STEP 4: Test preview controls
    // ========================================
    await dismissOverlays(page);

    // Wait for initial app generation to finish before interacting with preview
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    console.log('  ✓ Initial app generation completed');

    // Session may have expired during AI generation
    await ensureAuthenticated(page);

    console.log('🖼️ Step 4: Testing preview controls...');

    // Verify controls exist
    await expect(page.locator('[data-eid*="header.refresh"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('[data-eid*="preview.device_selector"]')).toBeVisible();
    console.log('  ✓ Refresh and device selector visible');

    // Test refresh button
    await page.locator('[data-eid*="header.refresh"]').click({ force: true });
    await expect(page.getByTestId('preview-iframe')).toBeVisible();
    console.log('  ✓ Refresh button works');

    // Test device selector - mobile view
    await page.locator('[data-eid*="preview.device_selector"]').click({ force: true });
    await page.locator('[data-radix-popper-content-wrapper]').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await page.locator('[data-radix-popper-content-wrapper]')
      .locator('[data-eid*="preview.device_select_iphone-se"]')
      .click({ force: true });
    await expect(page.getByTestId('preview-iframe')).toBeVisible();
    await expect(page.getByTestId('airo-header')).toBeVisible();
    console.log('  ✓ Mobile view works, header persists');

    // Test device selector - back to desktop
    await page.locator('[data-eid*="preview.device_selector"]').click({ force: true });
    await page.locator('[data-radix-popper-content-wrapper]').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await page.locator('[data-radix-popper-content-wrapper]')
      .locator('[data-eid*="preview.device_select_full"]')
      .click({ force: true });
    await expect(page.getByTestId('preview-iframe')).toBeVisible();
    console.log('  ✓ Desktop view restored');

    // ========================================
    // STEP 5: Test chat toolbar navigation
    // ========================================
    await dismissOverlays(page);
    console.log('🔧 Step 5: Testing chat toolbar...');

    // Verify toolbar buttons
    await expect(page.locator('[data-eid*="chat_toolbar.chat"]')).toBeVisible();
    await expect(page.locator('[data-eid*="chat_toolbar.history"]')).toBeVisible();
    await expect(page.locator('[data-eid*="chat_toolbar.settings"]')).toBeVisible();
    console.log('  ✓ All toolbar buttons visible');

    // Navigate to history and back
    await page.locator('[data-eid*="chat_toolbar.history"]').click({ force: true });
    await expect(page.getByTestId('airo-header')).toBeVisible();
    await page.locator('[data-eid*="chat_toolbar.chat"]').click({ force: true });
    await page.getByTestId('chat-input-textarea').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    console.log('  ✓ History tab navigation works, header persists');



    // ========================================
    // STEP 6: Test chat input states
    // ========================================
    await dismissOverlays(page);
    console.log('📝 Step 6: Testing chat input states...');

    const chatInput = page.getByTestId('chat-input-textarea');
    await waitForChatInput(page);

    // Send button disabled when empty
    await chatInput.clear();
    await expect(page.getByTestId('chat-send-button')).toBeDisabled();
    console.log('  ✓ Send button disabled when empty');

    // Send button enabled when text
    await chatInput.fill('Test message');
    await expect(page.getByTestId('chat-send-button')).not.toBeDisabled();
    console.log('  ✓ Send button enabled when text entered');

    // Shift+Enter multiline
    await chatInput.clear();
    await chatInput.click();
    await chatInput.pressSequentially('Line 1');
    await chatInput.press('Shift+Enter');
    await chatInput.pressSequentially('Line 2');
    const multilineValue = await chatInput.inputValue();
    expect(multilineValue).toContain('Line 1');
    expect(multilineValue).toContain('Line 2');
    console.log('  ✓ Shift+Enter creates multiline without sending');

    await chatInput.clear();

    // ========================================
    // STEP 6b: Chat input — file drop and clipboard paste staging
    // ========================================
    await dismissOverlays(page);
    console.log('📎 Step 6b: Staging attachments via drop and paste...');

    const chatInputCard = page.getByTestId('chat-input-card');
    await expect(chatInputCard).toBeVisible();

    await chatInput.clear();
    await expect(page.getByTestId('chat-send-button')).toBeDisabled();

    const tinyPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    await chatInputCard.evaluate((el, b64: string) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], 'e2e-drop.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
      );
    }, tinyPngBase64);

    await expect(page.getByTestId('chat-send-button')).not.toBeDisabled();
    await expect(chatInputCard.getByRole('img', { name: 'e2e-drop.png' })).toBeVisible({
      timeout: DEFAULT_TIMEOUT,
    });
    console.log('  ✓ Drop onto chat input stages file and enables send');

    await page.getByTestId('chat-staged-file-clear').first().click();
    await expect(page.getByTestId('chat-send-button')).toBeDisabled();
    console.log('  ✓ Cleared staged drop attachment');

    await chatInput.click();
    await chatInput.evaluate((el) => {
      const file = new File(['e2e-paste'], 'e2e-paste.txt', { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      el.dispatchEvent(ev);
    });

    await expect(page.getByTestId('chat-send-button')).not.toBeDisabled();
    await expect(page.getByText('e2e-paste.txt', { exact: true })).toBeVisible({
      timeout: DEFAULT_TIMEOUT,
    });
    console.log('  ✓ Paste file from clipboard stages attachment');

    await page.getByTestId('chat-staged-file-clear').first().click();
    await chatInput.clear();
    console.log('  ✓ Cleared staged paste attachment');

    // ========================================
    // STEP 7: Test sending message via click
    // ========================================
    await dismissOverlays(page);
    console.log('🖱️ Step 7: Testing send via click...');

    const clickMessage = 'Add a header section';
    await chatInput.fill(clickMessage);
    await page.getByTestId('chat-send-button').click({ force: true });

    // Verify message appears in transcript (confirms it was sent)
    const transcript = page.getByTestId('chat-transcript');
    await expect(transcript.getByText(clickMessage, { exact: true })).toBeVisible({ timeout: 10000 });
    console.log('  ✓ Message sent via click');

    // Wait for AI response to complete (send button reappears when done)
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    console.log('  ✓ AI response completed');

    // ========================================
    // STEP 8: Test sending message via Enter
    // ========================================
    await dismissOverlays(page);
    console.log('⌨️ Step 8: Testing send via Enter...');

    const enterMessage = 'Add a footer';
    await chatInput.clear();
    await chatInput.fill(enterMessage);
    await chatInput.press('Enter');

    // Verify message appears in transcript (confirms it was sent)
    await expect(transcript.getByText(enterMessage, { exact: true })).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  ✓ Message sent via Enter');

    // Wait for AI response to complete (send button reappears when done)
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    console.log('  ✓ AI response completed');

    // Session may have expired during AI interactions (Steps 5–9)
    await ensureAuthenticated(page);

    // ========================================
    // STEP 10: Test page refresh recovery
    // ========================================
    console.log('🔄 Step 10: Testing page refresh...');

    await page.reload();

    await expect(page).toHaveURL(/\/develop\//);
    await expect(page.getByTestId('airo-header')).toBeVisible();
    await page.getByTestId('chat-input-textarea').waitFor({ state: 'visible', timeout: CHAT_INPUT_TIMEOUT });
    await expect(page.getByTestId('chat-input-textarea')).not.toBeDisabled();
    await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });
    console.log('  ✓ Page refresh maintains state');

    console.log('🎉 All develop page tests passed!');
  });

  // Skip: backend does not reliably cancel agent — re-enable once AIROBUILD-1235 is fixed
  test.skip('Stop button during streaming', async ({ page }) => {
    await page.goto('/');
    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill('Create a long detailed blog post');
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();
    await handleSsoLogin(page);
    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    const chatInput = await waitForChatInput(page);
    const transcript = page.getByTestId('chat-transcript');

    const stopMessage = 'Create a long detailed blog post';
    await chatInput.clear();
    await chatInput.fill(stopMessage);
    await chatInput.press('Enter');

    await expect(transcript.getByText(stopMessage, { exact: true })).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    const stopButton = page.getByTestId('chat-stop-button');
    await expect(stopButton).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    await expect(page.getByTestId('chat-send-button')).not.toBeVisible();
    await stopButton.click({ force: true });
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    await expect(chatInput).not.toBeDisabled();
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
