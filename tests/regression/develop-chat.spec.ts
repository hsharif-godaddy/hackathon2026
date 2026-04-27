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

  test('Header, Preview, Chat & Navigation - Full UI Flow', async ({ page }, testInfo) => {
    testInfo.setTimeout(600_000);

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
    const publishButton = page
      .getByTestId('airo-header')
      .getByRole('button', { name: /publish/i });
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
    await expect(
      page.getByRole('button', { name: /sign\s*out|builder_user_menu_sign_out/i }),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole('button', { name: /my\s*products|builder_user_menu_my_products/i }),
    ).toBeVisible({ timeout: 5000 });
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

    const headerRefreshButton = page
      .getByTestId('airo-header')
      .getByRole('button', { name: /refresh|builder_preview_button_refresh/i });

    const deviceSelectorTrigger = page
      .getByTestId('airo-header')
      .getByRole('button', { name: /device|builder_preview_button_device/i });

    // Verify controls exist
    await expect(headerRefreshButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(deviceSelectorTrigger).toBeVisible();
    console.log('  ✓ Refresh and device selector visible');

    // Test refresh button
    await headerRefreshButton.click({ force: true });
    await expect(page.getByTestId('preview-iframe')).toBeVisible();
    console.log('  ✓ Refresh button works');

    // Test device selector - mobile view
    await deviceSelectorTrigger.click({ force: true });
    const deviceSelectorPopover = page.locator('[data-slot="popover-content"][data-state="open"]');
    await deviceSelectorPopover.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await deviceSelectorPopover.getByRole('button', { name: /iphone se/i }).click({ force: true });
    await expect(page.getByTestId('preview-iframe')).toBeVisible();
    await expect(page.getByTestId('airo-header')).toBeVisible();
    console.log('  ✓ Mobile view works, header persists');

    // Test device selector - back to desktop
    await deviceSelectorTrigger.click({ force: true });
    await deviceSelectorPopover.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await deviceSelectorPopover
      .getByRole('button', { name: /full size|builder_device_full_size/i })
      .click({ force: true });
    await expect(page.getByTestId('preview-iframe')).toBeVisible();
    console.log('  ✓ Desktop view restored');

    // ========================================
    // STEP 5: Test chat toolbar navigation
    // ========================================
    await dismissOverlays(page);
    console.log('🔧 Step 5: Testing chat toolbar...');

    await expect(page).toHaveURL(new RegExp(`/develop/${appId}`));

    // Toolbar is inside the sliding chat pane; when collapsed it is off-screen with pointer-events: none.
    const expandChatPane = page.getByTestId('airo-header').getByRole('button', {
      name: /expand|builder_preview_button_expand/i,
    });
    if (await expandChatPane.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expandChatPane.click();
      await page.getByTestId('chat-input-textarea').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    }

    // Force mobile toolbar into TOOLS mode if needed (settings only appears in TOOLS mode)
    const toolsButton = page.getByRole('button', { name: /tools|builder_preview_button_tools/i });
    if (await toolsButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await toolsButton.click();
    }

    // Wait for toolbar via working radio buttons (more reliable than test-id on @ux/box)
    const chatRadioButton = page.getByRole('radio', { name: /chat|builder_chat_toolbar_button_chat/i });
    await expect(chatRadioButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // Verify toolbar buttons (aria-label is translated copy; key appears when i18n missing)s
    await expect(page.getByRole('radio', { name: /history|builder_chat_toolbar_button_history/i })).toBeVisible();

    // Settings button: PopoverAnchor's Slot wrapping breaks aria-label/data-testid forwarding on
    // the ButtonGroup.Item. It still renders as role="radio" but without a name. Locate it as the
    // last radio in the same radiogroup as Chat (which is the tools toolbar's ButtonGroup).
    const toolsRadioGroup = page
      .getByRole('radiogroup')
      .filter({ has: page.getByRole('radio', { name: /^chat$/i }) });
    const settingsButton = toolsRadioGroup.getByRole('radio').last();
    await expect(settingsButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  ✓ All toolbar buttons visible');

    const openPopover = () => page.locator('[data-slot="popover-content"][data-state="open"]');

    // Test settings menu toggle (open → close → reopen)
    await settingsButton.click({ force: true });
    await expect(openPopover()).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  ✓ Settings menu opens on first click');

    await settingsButton.click({ force: true });
    await expect(openPopover()).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });
    console.log('  ✓ Settings menu closes on second click');

    // Radix Popover suppresses its trigger briefly while the dismissible layer
    // tears down; clicking immediately after close can be swallowed. A trial
    // click waits for actionability without firing, so the real click lands
    // once the trigger is interactive again.
    await settingsButton.click({ trial: true });

    await settingsButton.click({ force: true });
    await expect(openPopover()).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // Dismiss the popover before continuing
    await page.keyboard.press('Escape');
    await expect(openPopover()).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });
    console.log('  ✓ Settings menu reopens on third click and closes on Escape');

    // Navigate to history and back
    await page.getByRole('radio', { name: /history|builder_chat_toolbar_button_history/i }).click({ force: true });
    await expect(page.getByTestId('airo-header')).toBeVisible();
    await page.getByRole('radio', { name: /chat|builder_chat_toolbar_button_chat/i }).click({ force: true });
    await page.getByTestId('chat-input-textarea').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    console.log('  ✓ History tab navigation works, header persists');

    // ========================================
    // STEP 5b: Test history interactions disabled during publish
    // ========================================
    // await dismissOverlays(page);
    // console.log('🔒 Step 5b: Testing history interactions disabled during publish...');

    // // Define publish button locator for reuse throughout this section
    // const headerPublishButton = page.locator('[data-eid*="header"][data-eid*="publish"]').first();

    // // Wait for any deployment from refresh to complete (publish button becomes enabled)
    // await expect(headerPublishButton).not.toBeDisabled({ timeout: 60000 });
    // console.log('  ✓ Previous deployment complete');

    // // Navigate to history tab
    // await page.locator('[data-eid*="chat_toolbar.history"]').click({ force: true });
    // await expect(page.getByTestId('airo-header')).toBeVisible();

    // // Wait for commits to load
    // const commitSelectionButton = page.getByTestId('commit-selection-button').first();
    // await expect(commitSelectionButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // console.log('  ✓ History tab loaded with commits');

    // // Verify history interactions are enabled before publish
    // const dateGroupToggle = page.getByTestId('date-group-toggle').first();
    // await expect(dateGroupToggle).not.toBeDisabled();
    // await expect(commitSelectionButton).not.toBeDisabled();
    // console.log('  ✓ History interactions enabled before publish');

    // // Select a non-latest commit to make the restore button appear
    // const secondCommitButton = page.getByTestId('commit-selection-button').nth(1);
    // const secondCommitExists = (await secondCommitButton.count()) > 0;
    // const restoreButton = page.getByRole('button', { name: /restore/i });
    // if (secondCommitExists) {
    //   await secondCommitButton.click({ force: true });
    //   await expect(restoreButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    //   await expect(restoreButton).not.toBeDisabled();
    //   console.log('  ✓ Selected old commit, restore button visible and enabled');
    // }

    // // Start publish (but don't wait for completion)
    // await headerPublishButton.click({ force: true });

    // // Wait for publish popover to appear
    // await page.getByText('Publish Your App', { exact: true }).waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    // console.log('  ✓ Publish popover opened');

    // // Confirm publish - click the "Publish" button inside the popover
    // // Note: Both trigger and confirm buttons have same data-eid, so use .last() to get the one in the popover
    // // Matches both first publish (app_first_publish) and republish (app_publish)
    // const popoverPublishButton = page.locator('[data-eid*="header"][data-eid*="publish.click"]').last();
    // await popoverPublishButton.click({ force: true });

    // // Verify popover stays open during publishing
    // await expect(page.getByText('Publish Your App', { exact: true })).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // console.log('  ✓ Publish started, popover remains open');

    // // Verify history tab is still accessible during publish
    // await expect(page.locator('[data-eid*="chat_toolbar.history"]')).not.toBeDisabled();
    // console.log('  ✓ History tab remains accessible during publish');

    // // Verify history interactions are disabled during publish
    // await expect(dateGroupToggle).toBeDisabled();
    // console.log('  ✓ Date group toggle disabled during publish');

    // await expect(commitSelectionButton).toBeDisabled();
    // console.log('  ✓ Commit selection disabled during publish');

    // // Check if "Load more" button exists and is disabled (may not exist if few commits)
    // const loadMoreButton = page.getByRole('button', { name: /load more/i });
    // const loadMoreCount = await loadMoreButton.count();
    // if (loadMoreCount > 0) {
    //   await expect(loadMoreButton).toBeDisabled();
    //   console.log('  ✓ Load more button disabled during publish');
    // }

    // // Check if restore button is disabled (if we selected an old commit)
    // if (secondCommitExists) {
    //   await expect(restoreButton).toBeDisabled();
    //   console.log('  ✓ Restore button disabled during publish');
    // }

    // // NOTE: Tooltip checks removed - tooltips are flaky in E2E due to hover timing,
    // // positioning delays, and browser inconsistencies. The critical behavior
    // // (buttons being disabled during publish) is already verified above.

    // // Wait for publish to complete (publish button re-enables)
    // await expect(headerPublishButton).not.toBeDisabled({ timeout: 60000 });
    // console.log('  ✓ Publish completed');

    // // Verify history interactions are re-enabled after publish
    // // Use retry logic as there may be a slight delay after publish button re-enables
    // await expect(async () => {
    //   await expect(dateGroupToggle).not.toBeDisabled({ timeout: 1000 });
    //   await expect(commitSelectionButton).not.toBeDisabled({ timeout: 1000 });
    //   if (secondCommitExists) {
    //     await expect(restoreButton).not.toBeDisabled({ timeout: 1000 });
    //   }
    // }).toPass({ timeout: 10000 });
    // console.log('  ✓ History interactions re-enabled after publish');

    // // Return to chat tab
    // await page.locator('[data-eid*="chat_toolbar.chat"]').click({ force: true });
    // await page.getByTestId('chat-input-textarea').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });

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

    await expect(page.getByTestId('chat-send-button')).toBeDisabled();
    await expect(chatInputCard.getByRole('img', { name: 'e2e-drop.png' })).toBeVisible({
      timeout: DEFAULT_TIMEOUT,
    });
    console.log('  ✓ Drop onto chat input stages file; send stays disabled until prompt text is entered');

    await chatInput.fill('e2e prompt');
    await expect(page.getByTestId('chat-send-button')).not.toBeDisabled();
    await chatInput.clear();
    await expect(page.getByTestId('chat-send-button')).toBeDisabled();
    console.log('  ✓ Send enables once prompt text is entered with staged attachment');

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

    await expect(page.getByTestId('chat-send-button')).toBeDisabled();
    await expect(page.getByText('e2e-paste.txt', { exact: true })).toBeVisible({
      timeout: DEFAULT_TIMEOUT,
    });
    console.log('  ✓ Paste file from clipboard stages attachment; send stays disabled until prompt text');

    await chatInput.fill('e2e prompt');
    await expect(page.getByTestId('chat-send-button')).not.toBeDisabled();
    await chatInput.clear();
    await expect(page.getByTestId('chat-send-button')).toBeDisabled();
    console.log('  ✓ Send enables with pasted attachment once prompt text entered');

    await page.getByTestId('chat-staged-file-clear').first().click();
    await expect(page.getByTestId('chat-send-button')).toBeDisabled();
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

    // Reload can race the SSO Deck heartbeat: VAT briefly tips past the 5-min
    // window, gasket-auth's /api/auth/validate returns 401 (authReason=3),
    // and the top window is pushed to sso.<env>-godaddy.com/login?path=
    // %2Fdevelop%2F<id>. Handle the bounce so the rest of this step doesn't
    // run against the SSO page (which has no airo-header / chat-input and
    // fails with a misleading selector error).
    await ensureAuthenticated(page);

    await expect(page).toHaveURL(/^(?!https:\/\/sso\.)[^?#]*\/develop\//);
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

    await waitForChatInput(page);
    const chatInput = page.getByTestId('chat-input-textarea');
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
