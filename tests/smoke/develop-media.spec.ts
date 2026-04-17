/**
 * Media Tab E2E Smoke Test
 *
 * Tests the media panel flow:
 * - Opening media tab from toolbar
 * - Media grid loads (slots or empty state)
 * - Slot detail navigation (click slot → see detail → back)
 * - "Your Uploads" section visibility in slot detail
 * - "Use this image" button (select-then-confirm pattern)
 */
import { test, expect } from '@playwright/test';

import { deleteAllSitesViaAPI } from '../helpers/api';
import { handleSsoLogin, ensureAuthenticated } from '../helpers/auth';
import { LONG_TIMEOUT, DEFAULT_TIMEOUT, PREVIEW_TIMEOUT, AI_RESPONSE_TIMEOUT_MS, CHAT_INPUT_TIMEOUT, getSpecPrefix } from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage, waitForChatInput } from '../helpers/ui';

test.describe('Develop Page - Media Tab', () => {
  test.beforeEach(async ({}, testInfo) => {
    logTestStart(testInfo);
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

  // Skip: AI image generation timeout in CI — re-enable once generation latency is addressed
  test.skip('Media tab - open grid, navigate to slot detail, verify upload flow', async ({ page }) => {
    // ========================================
    // STEP 1: Create an app with images
    // ========================================
    console.log('📱 Step 1: Creating app with images...');

    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('media')} Simple yoga studio website with hero image and about section - do not ask follow up questions`);

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();
    await handleSsoLogin(page);

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
    console.log(`✅ App created: ${appId}`);

    // Wait for AI generation to finish
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    console.log('  ✓ Initial app generation completed');

    await ensureAuthenticated(page);
    await dismissOverlays(page);

    // ========================================
    // STEP 2: Open Media tab
    // ========================================
    console.log('🖼️ Step 2: Opening Media tab...');

    const mediaTabButton = page.getByRole('radio', { name: /media|builder_chat_toolbar_button_media/i });
    await expect(mediaTabButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await mediaTabButton.click({ force: true });
    console.log('  ✓ Media tab clicked');

    // Wait for media grid to load (either slots appear or empty state)
    // Allow time for manifest fetch
    await page.waitForTimeout(3000);

    // Check if media slots loaded (grid items) or empty state is shown
    const gridButtons = page.locator('[data-eid*="develop.media_panel.slot"]');
    const emptyState = page.getByText(/no images/i);

    const hasSlots = await gridButtons.first().isVisible().catch(() => false);
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    expect(hasSlots || hasEmptyState).toBe(true);
    console.log(hasSlots ? `  ✓ Media grid loaded with slots` : '  ✓ Media grid shows empty state');

    // ========================================
    // STEP 3: Navigate to slot detail (if slots exist)
    // ========================================
    if (hasSlots) {
      console.log('📸 Step 3: Testing slot detail navigation...');

      // Click first slot
      await gridButtons.first().click();
      console.log('  ✓ Clicked first slot');

      // Verify slot detail loaded — check for Upload button and "Use this image" button
      const uploadButton = page.locator('[data-eid*="develop.media_slot_detail.upload"]');
      const useImageButton = page.locator('[data-eid*="develop.media_slot_detail.use"]');

      await expect(uploadButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await expect(useImageButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  ✓ Slot detail shows Upload and Use this image buttons');

      // Verify "Your Uploads" section exists
      const uploadsSection = page.getByText(/your uploads/i);
      const hasUploadsSection = await uploadsSection.isVisible().catch(() => false);
      console.log(hasUploadsSection ? '  ✓ Your Uploads section visible' : '  ℹ No Your Uploads section (no uploads yet)');

      // Verify "Use this image" button is disabled when no selection made
      // (select-then-confirm pattern)
      await expect(useImageButton).toBeDisabled();
      console.log('  ✓ Use this image button disabled (no selection) — select-then-confirm pattern works');

      // If Getty alternatives exist, test selection
      const gettyImages = page.locator('[data-eid*="develop.media_slot_detail.image_option.click"]');
      const hasGettyImages = await gettyImages.first().isVisible().catch(() => false);

      if (hasGettyImages) {
        console.log('  🎨 Getty alternatives found, testing select-then-confirm...');

        // Click a Getty alternative (not the first which is current/selected)
        const secondImage = gettyImages.nth(1);
        const hasSecondImage = await secondImage.isVisible().catch(() => false);

        if (hasSecondImage) {
          await secondImage.click();
          console.log('  ✓ Selected a Getty alternative');

          // Verify "Use this image" is now enabled
          await expect(useImageButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
          console.log('  ✓ Use this image button enabled after selection');
        }
      }

      // Navigate back to grid
      const backButton = page.locator('button').filter({ has: page.locator('[class*="chevron"]') }).first();
      const hasBackButton = await backButton.isVisible().catch(() => false);
      if (hasBackButton) {
        await backButton.click();
        console.log('  ✓ Navigated back to media grid');
      }
    } else {
      console.log('ℹ Step 3: Skipped (no media slots in generated app)');
    }

    // ========================================
    // STEP 4: Switch back to chat tab
    // ========================================
    console.log('💬 Step 4: Switching back to chat...');
    const chatTabButton = page.getByRole('radio', { name: /chat|builder_chat_toolbar_button_chat/i });
    await chatTabButton.click({ force: true });

    await waitForChatInput(page);
    console.log('  ✓ Chat tab restored');

    // ========================================
    // CLEANUP
    // ========================================
    console.log('🧹 Cleanup: Deleting test app...');
    await deleteAllSitesViaAPI(page, `${getSpecPrefix('media')}`);
    console.log('✅ Test complete');
  });

  test.skip('Logo grid — select variant, Save, slot swap and placement follow-up', async () => {
    // Skip reason: Needs a develop session where media__generate_logo completed in chat (same
    // AI latency / flake constraints as the image flow test above). Enable when smoke env can
    // reliably finish logo generation or when a fixture app exposes the logo grid widget.
    //
    // Target flow when implemented:
    // 1. Open develop for an app whose chat shows the logo tool result grid.
    // 2. Click a non-default thumbnail if multiple logos exist.
    // 3. Click Save (builder_common_save); expect slot PUT success and optional preview RELOAD_MEDIA_SLOT.
    // 4. Confirm chat shows the short placement user line and agent run without queue errors.
  });
});
