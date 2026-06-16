/**
 * Develop Page — publish lockout & attachment staging.
 *
 * Focused regression coverage for develop-page behaviors NOT exercised
 * by the e2e-v2 suite:
 *   1. History interactions (commit select, restore, date-group toggle, load
 *      more) are disabled while a publish is in flight, and re-enable when it
 *      completes.
 *   2. The chat input stages dropped / pasted file attachments and enables Send
 *      when attachments are present (prompt text optional).
 *   3. Attachment-only send (upload → transcript) on WebSocket transport.
 *
 * The previous "Full UI Flow" mega-test also covered component render, preview
 * controls, chat-input states, send-via-click/Enter and page-reload recovery —
 * all now owned by tests/e2e-v2/{develop-ui,chat-send,publish-and-domain}.spec.ts.
 * Those steps were removed here to cut the duplication and the shard-4
 * flakiness that came with stacking them into one ~10-min flow. (Dropped along
 * with them: the optional app-generation feedback banner, the user-menu item
 * check, and the settings-popover toggle mechanics — low-value chrome, not
 * re-homed.)
 *
 * Step 6c exercises attachment-only send on the default WebSocket transport;
 * SSE cohort is forced off via forceWebSocketTransport so a green run is not a
 * false positive from the SSE path. Live-agent upload remains high flake risk —
 * transcript and AI completion waits use AI_RESPONSE_TIMEOUT_MS. Prefer nightly
 * if 6c flakes in CI smoke.
 */
import type { Page } from '@playwright/test';

import { test, expect } from '../helpers/test-fixtures';

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { handleSsoLogin, ensureAuthenticated } from '../helpers/auth';
import {
  LONG_TIMEOUT,
  DEFAULT_TIMEOUT,
  PUBLISH_TIMEOUT_MS,
  AI_RESPONSE_TIMEOUT_MS,
  E2E_NO_DELETE,
  getSpecPrefix,
} from '../helpers/constants';
import {
  dismissOverlays,
  expectPublishSuccessVisible,
  expectWebSocketTransport,
  forceWebSocketTransport,
  logTestResult,
  logTestStart,
  waitForDevelopPage,
  waitForChatInput,
} from '../helpers/ui';

/** Spec prefixes used by `getSpecPrefix(...)` calls in this describe block. */
const SPEC_PREFIXES = ['develop'] as const;

/**
 * Create a fresh app from the homepage prompt and return its id, with the
 * develop page ready and the initial generation finished. Homepage submit is
 * the proven creation path for generation-gated develop tests — API
 * quick-create + a direct /develop/<id> navigation is unreliable here (see
 * tests/e2e-v2/develop-ui.spec.ts). Caller is responsible for raising the test
 * timeout to cover the initial-generation wait.
 */
async function createDevelopApp(page: Page): Promise<string> {
  // Prevent the coachmark tour from appearing.
  await page.addInitScript(() => {
    localStorage.setItem('airo-intro-tour-shown', 'true');
  });

  await page.goto('/');

  const promptInput = page.getByTestId('homepage-prompt-input');
  await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
  await promptInput.fill(`${getSpecPrefix('develop')} Single page hello world app - do not ask follow up questions`);

  await dismissOverlays(page);
  await page.locator('[data-eid*="homepage.prompt.submit"]').click();

  await handleSsoLogin(page);

  await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
  await waitForDevelopPage(page);
  await dismissOverlays(page);

  // Wait for the initial app generation to finish (send button returns to idle).
  await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
  await ensureAuthenticated(page);

  const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
  console.log(`App created: ${appId}`);
  return appId;
}

/**
 * Reveal the chat toolbar's History tab. On desktop the toolbar is already
 * visible; the expand / tools-mode steps are defensive for narrow layouts
 * where the chat pane is collapsed or the toolbar starts in CHAT mode.
 */
async function openHistoryTab(page: Page): Promise<void> {
  await dismissOverlays(page);

  const expandChatPane = page.getByTestId('airo-header').getByRole('button', {
    name: /expand|builder_preview_button_expand/i,
  });
  if (await expandChatPane.isVisible({ timeout: 2000 }).catch(() => false)) {
    await expandChatPane.click();
    await page.getByTestId('chat-input-textarea').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  }

  const toolsButton = page.getByRole('button', { name: /tools|builder_preview_button_tools/i });
  if (await toolsButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await toolsButton.click();
  }

  await page.getByRole('radio', { name: /history|builder_chat_toolbar_button_history/i }).click({ force: true });
  await expect(page.getByTestId('airo-header')).toBeVisible();
}

test.describe('Develop Page', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    if (!E2E_NO_DELETE) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch(() => {});
    }
  });

  test('History interactions are disabled during an active publish', async ({ page }, testInfo) => {
    // Inherently slow: this is the one behavior that requires a real publish
    // (the lockout only manifests while a deploy is in flight). Budget for app
    // generation plus a full publish cycle.
    testInfo.setTimeout(600_000);

    await createDevelopApp(page);

    await openHistoryTab(page);

    const headerPublishButton = page.locator('#tour-publish-button');
    // Make sure no earlier publish is still in flight before we start ours.
    await expect(headerPublishButton).not.toHaveAttribute(
      'aria-label',
      /publishing|builder_publish_button_publishing/i,
      { timeout: 60000 },
    );

    // History loads with commits and its interactions are enabled pre-publish.
    const commitSelectionButton = page.getByTestId('commit-selection-button').first();
    await expect(commitSelectionButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const dateGroupToggle = page.getByTestId('date-group-toggle').first();
    await expect(dateGroupToggle).not.toBeDisabled();
    await expect(commitSelectionButton).not.toBeDisabled();
    console.log('  ✓ History interactions enabled before publish');

    // Select a non-latest commit so the Restore button appears (only when the
    // freshly-created app already has more than one commit).
    const secondCommitButton = page.getByTestId('commit-selection-button').nth(1);
    const secondCommitExists = (await secondCommitButton.count()) > 0;
    const restoreButton = page.getByRole('button', { name: /restore/i });
    if (secondCommitExists) {
      await secondCommitButton.click({ force: true });
      await expect(restoreButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await expect(restoreButton).not.toBeDisabled();
      console.log('  ✓ Restore button visible and enabled before publish');
    }

    // Start a publish (popover → Publish) but don't wait for completion yet.
    await headerPublishButton.click({ force: true });

    // Anchor "popover opened" on the popover container + its publish button
    // (role-based) rather than the localized title text — the title copy regex
    // was a flaky selector and the title still lacks a stable test id.
    const publishPopover = page.locator('[data-slot="popover-content"][data-state="open"]');
    await expect(publishPopover).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const popoverPublishButton = publishPopover.getByRole('button', {
      name: /^(?:builder_publish_button|publish|republish)$/i,
    });
    await expect(popoverPublishButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await popoverPublishButton.click({ force: true });

    await expect(headerPublishButton).toHaveAttribute(
      'aria-label',
      /publishing|builder_publish_button_publishing/i,
      { timeout: DEFAULT_TIMEOUT },
    );
    await expect(publishPopover).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  ✓ Publish started, popover remains open');

    // The lockout: the History tab stays reachable, but its interactions
    // disable while the publish runs.
    await expect(page.getByRole('radio', { name: /history|builder_chat_toolbar_button_history/i })).not.toBeDisabled();
    await expect(dateGroupToggle).toBeDisabled();
    await expect(commitSelectionButton).toBeDisabled();
    console.log('  ✓ Date-group toggle and commit selection disabled during publish');

    const loadMoreButton = page.getByRole('button', { name: /load more/i });
    if ((await loadMoreButton.count()) > 0) {
      await expect(loadMoreButton).toBeDisabled();
      console.log('  ✓ Load more disabled during publish');
    }

    if (secondCommitExists) {
      await expect(restoreButton).toBeDisabled();
      console.log('  ✓ Restore disabled during publish');
    }

    // Publish completes; interactions re-enable.
    await expectPublishSuccessVisible(page, PUBLISH_TIMEOUT_MS);
    console.log('  ✓ Publish completed');

    await page.keyboard.press('Escape');
    await expect(publishPopover).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });

    await expect(dateGroupToggle).not.toBeDisabled();
    await expect(commitSelectionButton).not.toBeDisabled();
    if (secondCommitExists) {
      await expect(restoreButton).not.toBeDisabled();
    }
    console.log('  ✓ History interactions re-enabled after publish');
  });

  test('Chat input stages dropped and pasted attachments', async ({ page }, testInfo) => {
    // One AI wait for initial generation; step 6c adds a second AI wait for attachment-only send.
    testInfo.setTimeout(AI_RESPONSE_TIMEOUT_MS * 2 + 180_000);

    await forceWebSocketTransport(page);
    await createDevelopApp(page);

    await dismissOverlays(page);

    const chatInput = page.getByTestId('chat-input-textarea');
    await waitForChatInput(page, { requirePreview: false });

    const chatInputCard = page.getByTestId('chat-input-card');
    await expect(chatInputCard).toBeVisible();

    await chatInput.clear();
    await expect(page.getByTestId('chat-send-button')).toBeDisabled();

    const tinyPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    // --- Drop a file onto the chat input ---
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
    console.log('  ✓ Drop onto chat input stages file; send enabled without prompt text');

    await chatInput.fill('e2e prompt');
    await expect(page.getByTestId('chat-send-button')).not.toBeDisabled();
    await chatInput.clear();
    await expect(page.getByTestId('chat-send-button')).not.toBeDisabled();
    console.log('  ✓ Send stays enabled with staged drop attachment when prompt text is cleared');

    await page.getByTestId('chat-staged-file-clear').first().click();
    await expect(page.getByTestId('chat-send-button')).toBeDisabled();
    console.log('  ✓ Cleared staged drop attachment');

    // --- Paste a file from the clipboard ---
    await chatInput.focus();
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
    console.log('  ✓ Paste file from clipboard stages attachment; send enabled without prompt text');

    await chatInput.fill('e2e prompt');
    await expect(page.getByTestId('chat-send-button')).not.toBeDisabled();
    await chatInput.clear();
    await expect(page.getByTestId('chat-send-button')).not.toBeDisabled();
    console.log('  ✓ Send stays enabled with pasted attachment when prompt text is cleared');

    await page.getByTestId('chat-staged-file-clear').first().click();
    await expect(page.getByTestId('chat-send-button')).toBeDisabled();
    console.log('  ✓ Cleared staged paste attachment');

    // --- Send staged attachment without prompt text (happy path, WS transport) ---
    await dismissOverlays(page);
    console.log('📎 Step 6c: Sending attachment-only message (WebSocket transport)...');

    await expectWebSocketTransport(page);

    await chatInput.clear();
    await expect(page.getByTestId('chat-send-button')).toBeDisabled();

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

    const emptyPromptText = await chatInput.evaluate((el) =>
      el instanceof HTMLTextAreaElement ? el.value : ((el as HTMLElement).innerText ?? ''),
    );
    expect(emptyPromptText.trim()).toBe('');

    await page.getByTestId('chat-send-button').click({ force: true });

    const attachmentOnlyTranscript = page.getByTestId('chat-transcript');
    await expect(attachmentOnlyTranscript.getByRole('img', { name: 'e2e-drop.png' })).toBeVisible({
      timeout: AI_RESPONSE_TIMEOUT_MS,
    });
    await expect(chatInputCard.getByRole('img', { name: 'e2e-drop.png' })).not.toBeVisible({
      timeout: DEFAULT_TIMEOUT,
    });
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    console.log('  ✓ Attachment-only send: upload completed and AI response finished');
  });

  // Skip: backend does not reliably cancel agent — re-enable once AIROBUILD-1235 is fixed.
  //
  // appbuilder-queue caveat: when re-enabling, this test as written assumes
  // chat-stop-button is the only mid-stream testid. Under appbuilder-queue
  // (AIROBUILD-1944), ChatInput swaps to chat-send-button as soon as the
  // user types text mid-stream (Send-to-queue mode). Either disable the
  // flag for this test (Switchboard override) or fill the message AFTER
  // capturing the stop button to avoid the testid flip.
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

    if (E2E_NO_DELETE) {
      console.log('🧹 Cleanup skipped (E2E_NO_DELETE=true)');
      return;
    }

    console.log('🧹 Cleanup...');
    for (const name of SPEC_PREFIXES) {
      try {
        await deleteAppsWithPrefix(page, getSpecPrefix(name));
      } catch (err) {
        console.error(`  Cleanup of prefix '${name}' failed:`, err);
      }
    }
  });
});
