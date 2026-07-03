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
 *   3. Attachment-only send (upload → transcript).
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
 * Step 6c exercises attachment-only send (SSE transport). Live-agent upload
 * remains high flake risk — transcript and AI completion waits use
 * AI_RESPONSE_TIMEOUT_MS. Prefer nightly if 6c flakes in CI smoke.
 */
import type { Page } from '@playwright/test';

import { test, expect } from '../helpers/test-fixtures';

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { detectSsoType, ensureAuthenticated, handleSsoLogin, isSignInUIResult, loginViaSsoDirect } from '../helpers/auth';
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
  // Minimal prompt so the initial AI build finishes fast (page content is
  // irrelevant to these tests) — matches the develop-edit-interactions specs.
  await promptInput.fill(`${getSpecPrefix('develop')} Hello world app - do it very quickly and keep it minimal, no other sections, do not ask follow up questions`);

  await dismissOverlays(page);
  await page.getByTestId('homepage-prompt-submit').click();

  // Already authenticated in beforeEach (fast standalone-SSO login), so the
  // submit normally redirects straight to /develop/. Only drive the SSO flow
  // if the session refreshed mid-test and the sign-in UI reappeared.
  const ssoResult = await detectSsoType(page, true);
  if (isSignInUIResult(ssoResult)) {
    await handleSsoLogin(page);
  }

  await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
  await waitForDevelopPage(page);
  await dismissOverlays(page);

  // Wait for the initial app generation to finish (send button returns to idle).
  // Allow two AI cycles — prod/test generation has been observed to exceed one
  // 5-min cycle under congestion (it timed out the bare wait here on run
  // 27627575651), matching the develop-edit-interactions specs.
  await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: 2 * AI_RESPONSE_TIMEOUT_MS });
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

  await page.getByTestId('chat-toolbar-history-tab').click({ force: true });
  await expect(page.getByTestId('airo-header')).toBeVisible();
}

test.describe('Develop Page', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    // Authenticate once here via the fast standalone-SSO login (e2e-v2 style)
    // instead of the slower in-body homepage user-menu -> sign-in iframe flow;
    // createDevelopApp's post-submit step is now a conditional re-auth guard.
    await loginViaSsoDirect(page);
    if (!E2E_NO_DELETE) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch(() => {});
    }
  });

  test('History interactions are disabled during an active publish', async ({ page }, testInfo) => {
    // Inherently slow: this is the one behavior that requires a real publish
    // (the lockout only manifests while a deploy is in flight). Budget for up to
    // two AI generation cycles (createDevelopApp) plus a full publish cycle.
    testInfo.setTimeout(2 * AI_RESPONSE_TIMEOUT_MS + PUBLISH_TIMEOUT_MS);

    await createDevelopApp(page);

    await openHistoryTab(page);

    const headerPublishButton = page.getByTestId('publish-trigger-button');
    // Make sure no earlier publish is still in flight before we start ours.
    await expect(headerPublishButton).not.toHaveAttribute(
      'aria-label',
      /publishing|builder_publish_button_publishing/i,
      { timeout: 60000 },
    );

    // History loads with commits. Wait until its interactions are ENABLED
    // (not merely present): a freshly-created app runs a "Sync upstream
    // template files" rebuild shortly after the initial generation, and
    // useIsHistoryDisabled locks history controls during any build/stream. Use
    // a generous timeout so we start from a genuinely idle app rather than
    // racing that rebuild — racing it is what failed run 27622987137 (the
    // version switch below threw "can't switch versions while Airo is actively
    // building").
    const commitSelectionButton = page.getByTestId('commit-selection-button').first();
    await expect(commitSelectionButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const dateGroupToggle = page.getByTestId('date-group-toggle').first();
    await expect(dateGroupToggle).not.toBeDisabled({ timeout: 2 * AI_RESPONSE_TIMEOUT_MS });
    await expect(commitSelectionButton).not.toBeDisabled({ timeout: DEFAULT_TIMEOUT });
    console.log('  ✓ History interactions enabled before publish (app idle)');

    // NB: we deliberately do NOT select a non-latest commit / assert Restore.
    // Selecting a version is the one history operation Airo blocks during a
    // build (the template-sync rebuild above) — racy, and not needed to prove
    // the lockout. The lockout is proven by the always-present controls
    // (date-group toggle, commit selection, load-more) disabling during publish
    // and re-enabling after.

    // Start a publish (popover → Publish) but don't wait for completion yet.
    await headerPublishButton.click({ force: true });

    // Anchor "popover opened" on the popover container + its publish button
    // rather than the localized title text. The publish UI is now a
    // ResponsivePopover (@ux/flyout on desktop), so scope to its stable test id
    // rather than the old shadcn `data-slot="popover-content"` it no longer emits.
    const publishPopover = page.locator('[data-testid="publish-popover"]');
    await expect(publishPopover).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const popoverPublishButton = publishPopover.getByTestId('publish-confirm-button');
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

    const loadMoreButton = page.getByTestId('version-history-load-more');
    if ((await loadMoreButton.count()) > 0) {
      await expect(loadMoreButton).toBeDisabled();
      console.log('  ✓ Load more disabled during publish');
    }

    // Publish completes; interactions re-enable.
    await expectPublishSuccessVisible(page, PUBLISH_TIMEOUT_MS);
    console.log('  ✓ Publish completed');

    await page.keyboard.press('Escape');
    await expect(publishPopover).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });

    await expect(dateGroupToggle).not.toBeDisabled();
    await expect(commitSelectionButton).not.toBeDisabled();
    console.log('  ✓ History interactions re-enabled after publish');
  });

  test('Chat input stages dropped and pasted attachments', async ({ page }, testInfo) => {
    // Two phases, each up to two AI_RESPONSE_TIMEOUT_MS cycles: the initial
    // generation (createDevelopApp now allows 2 cycles for slow prod/test
    // builds) and step 6c's attachment-only send (a transcript wait + an
    // AI-completion wait). Budget for both so neither phase clips under
    // congestion. The staging assertions themselves are client-side.
    testInfo.setTimeout(4 * AI_RESPONSE_TIMEOUT_MS + 120_000);

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

    // --- Send staged attachment without prompt text (happy path) ---
    await dismissOverlays(page);
    console.log('📎 Step 6c: Sending attachment-only message...');

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
  // Re-enabled (VNEXT-80871). Previously skipped citing AIROBUILD-1235 (clicking
  // Stop didn't cancel the agent, so the UI flipped back to streaming). That
  // ticket is now Cancelled and the symptom no longer reproduces — verified on
  // prod that Stop cancels cleanly and the UI settles to idle and STAYS idle
  // (~40s observed). The test asserts the client stop affordance + that idle
  // sticks, which guards against the regression returning.
  test('Stop button during streaming', async ({ page }, testInfo) => {
    // Initial gen (up to 2 cycles) + the long streamed response we interrupt.
    testInfo.setTimeout(3 * AI_RESPONSE_TIMEOUT_MS + 120_000);

    await createDevelopApp(page);
    await dismissOverlays(page);

    const chatInput = page.getByTestId('chat-input-textarea');
    const transcript = page.getByTestId('chat-transcript');
    const sendButton = page.getByTestId('chat-send-button');
    const stopButton = page.getByTestId('chat-stop-button');

    // Send a long-generating follow-up so there's a real stream to interrupt.
    // "Write it directly, no questions" avoids a clarifying-question card, which
    // would collapse the chat input instead of streaming a response.
    const stopMessage =
      'Write a very long, detailed 2000-word blog post with 10 sections about gardening. ' +
      'Write the full content directly now — do not ask any questions.';
    await expect(chatInput).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
    await chatInput.fill(stopMessage);
    await expect(sendButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
    await chatInput.press('Enter');

    // The message lands, then streaming starts: the action button carries the
    // stop testid and the idle send button is gone.
    await expect(transcript.getByText(stopMessage, { exact: true })).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(stopButton).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    await expect(sendButton).not.toBeVisible();

    // Click Stop → the UI returns to idle (send button back, input enabled).
    await stopButton.click({ force: true });
    await expect(sendButton).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    await expect(chatInput).not.toBeDisabled();

    // ...and STAYS idle. If the backend resumed streaming (the AIROBUILD-1235
    // symptom), the action button would flip back to Stop — assert it doesn't.
    await page.waitForTimeout(5_000);
    await expect(stopButton).toBeHidden();
    await expect(sendButton).toBeVisible();
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
