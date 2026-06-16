/**
 * Chat send — Enter key (default user path) + Send button click (regression
 * guard). Coverage: legacy monolith Steps 5 and 6.
 *
 * The Enter-key path is the dominant user behavior; the button-click path
 * exists as a regression guard against handler regressions in the chat
 * toolbar. Both run against the same app, in serial, because each chat
 * round-trip mutates the app's transcript state and the order matters for
 * deterministic transcript reads.
 *
 * Concurrency: serial within file. The two tests share one server-side app
 * (created in `beforeAll`, deleted in `afterAll`) and each test's
 * transcript assertion expects the message it just sent.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';

import { deleteApp, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { detectSsoType, ensureAuthenticated, handleSsoLogin, isSignInUIResult, loginViaSsoDirect } from '../helpers/auth';
import {
  AI_RESPONSE_TIMEOUT_MS,
  DEFAULT_TIMEOUT,
  E2E_NO_DELETE,
  LONG_TIMEOUT,
  getSpecPrefix,
} from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

const SPEC_NAME = 'chat-send';

/**
 * Send one chat message and wait for the AI response to finish — robustly.
 *
 * The send/stop control is a SINGLE button element whose `data-testid` is
 * swapped imperatively in a useEffect (ChatInput.tsx) between
 * `chat-send-button` (idle) and `chat-stop-button` (awaiting/streaming). Two
 * flakes this guards against, both seen on prod runs:
 *
 *  1. The idle send button can be VISIBLE BUT DISABLED — submit stays gated
 *     until the input validates. Pressing Enter / clicking while disabled is a
 *     silent no-op, so the message never reaches the transcript and the
 *     transcript assertion times out. Gate on `toBeEnabled` (after filling),
 *     not just `toBeVisible`, before submitting.
 *  2. Re-querying `chat-send-button` for "stream ended" races the imperative
 *     testid swap. Track the stop button instead: it becomes visible when the
 *     response starts streaming and `toBeHidden` once it ends (toBeHidden also
 *     tolerates the element no longer existing after it flips back to send).
 *
 * appbuilder-queue caveat (AIROBUILD-1944): with the queue flag on AND text in
 * the input, ChatInput swaps the action button back to `chat-send-button`
 * mid-stream (Send-to-queue mode). This helper clears the input as soon as it
 * submits, so the input is empty while the response streams and the button
 * stays `chat-stop-button` as the stop-button gate expects.
 */
async function sendChatMessage(
  page: Page,
  opts: { message: string; via: 'enter' | 'button'; readyTimeoutMs: number },
): Promise<void> {
  const chatInput = page.getByTestId('chat-input-textarea');
  const transcript = page.getByTestId('chat-transcript');
  const sendButton = page.getByTestId('chat-send-button');
  const stopButton = page.getByTestId('chat-stop-button');

  // Ready for input: idle send button present (initial app gen / prior stream
  // finished — while either is in flight the button carries the stop testid).
  await expect(sendButton).toBeVisible({ timeout: opts.readyTimeoutMs });

  await chatInput.clear();
  await chatInput.fill(opts.message);

  // Must be ENABLED before submit — a visible-but-disabled send button makes
  // Enter/click a silent no-op (the root cause of the transcript-timeout flake).
  await expect(sendButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });

  if (opts.via === 'enter') await chatInput.press('Enter');
  else await sendButton.click({ force: true });

  // The submitted message lands in the transcript (fast, deterministic).
  await expect(transcript.getByText(opts.message, { exact: true })).toBeVisible({
    timeout: DEFAULT_TIMEOUT,
  });

  // Response streaming started (stop button shown) then ended (stop hidden).
  // Splitting these gives a faster, more diagnostic signal than waiting on the
  // idle send button to reappear, and the long timeout applies only to the
  // actual AI response phase.
  await expect(stopButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  await expect(stopButton).toBeHidden({ timeout: AI_RESPONSE_TIMEOUT_MS });
}

test.describe.configure({ mode: 'serial' });

test.describe('E2E v2 - Chat send', () => {
  let appId: string;

  test.beforeAll(async ({ browser }) => {
    // Reserve enough time for the homepage submit + AI initial gen so
    // tests starting their own gating wait don't race a still-streaming app.
    test.setTimeout(600_000);

    // No storageState — the e2e-v2 project does live SSO at every entry
    // point because storageState-cached cookies were rejected by gd-auth
    // on /develop/<id> navigations (see playwright.config.ts notes).
    //
    // App creation: use homepage submit (not API quick-create). API-created
    // apps + a direct /develop/<id> navigation worked for short-lived
    // assertions but consistently failed any test that waited >5 min for
    // chat-send-button to flip to idle — the page bounced to a
    // homepage-style fallback render mid-wait. Homepage submit lets the
    // AI agent warm up during the SSO + redirect cost, so by the time
    // tests gate on chat-send-button visibility the streaming UI has had
    // a head-start (matches legacy e2e.spec.ts and create-flow.spec.ts).
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      // Authenticate on the standalone SSO page (top-level, not the app's
      // cross-origin iframe) so parallel workers don't contend on iframe
      // credential fills. Then the app loads already signed in.
      await loginViaSsoDirect(page);
      await page.goto('/');
      await dismissOverlays(page);
      await evictOldestE2eAppsToFitLimit(page).catch(() => {});

      const promptInput = page.getByTestId('homepage-prompt-input');
      await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
      await dismissOverlays(page);
      await promptInput.fill(
        `${getSpecPrefix(SPEC_NAME)} Simple landing page with a hero section`,
      );

      // Hydration wait — see create-flow.spec.ts for why 10 s fixed beats
      // networkidle here.
      const submitButton = page.locator('[data-eid*="homepage.prompt.submit"]');
      await expect(submitButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
      await page.waitForTimeout(10_000);
      await submitButton.click();

      const ssoResult = await detectSsoType(page, true);
      if (isSignInUIResult(ssoResult)) {
        console.log(`  SSO refresh detected (${ssoResult}), re-authenticating...`);
        await handleSsoLogin(page);
      }

      await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
      await waitForDevelopPage(page);

      const matched = page.url().match(/\/develop\/([^/?#]+)/);
      appId = matched?.[1] ?? '';
      expect(appId, 'develop URL should contain an app id').not.toBe('');
      console.log(`  chat-send shared app: ${appId}`);
    } finally {
      await ctx.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    if (E2E_NO_DELETE) {
      console.log('Cleanup skipped (E2E_NO_DELETE=true)');
      return;
    }
    if (!appId) {
      console.log('  No appId captured — skipping cleanup');
      return;
    }
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      // deleteApp uses page.evaluate(fetch('/api/sites/<id>'…)). The
      // relative URL needs a base origin, so authenticate then land on the
      // app host first.
      await loginViaSsoDirect(page);
      await page.goto('/');
      await dismissOverlays(page);
      await deleteApp(page, appId);
    } catch (err) {
      console.error(`  Cleanup of app ${appId} failed:`, err);
    } finally {
      await ctx.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });
    // Each test gets a fresh browser context (no storageState) — log in via
    // the standalone SSO page first, then go straight to /develop/<id>
    // (already authenticated, so gd-auth doesn't bounce us to SSO).
    await loginViaSsoDirect(page);
    await page.goto(`/develop/${appId}`);
    await waitForDevelopPage(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);
  });

  // Initial AI generation needs more time than a follow-up response: the
  // legacy monolith reaches this gate ~1–2 min after homepage submit (so AI
  // gen has had a head-start during SSO + navigation). This spec creates its
  // app via homepage submit in beforeAll too, but each test then re-enters
  // via /develop/<id> in a fresh context, so its own gating wait can begin
  // while AI gen is still early. On a slow test env that's not enough margin
  // within AI_RESPONSE_TIMEOUT_MS. Add 2 min to cover the missing head-start.
  const INITIAL_GEN_TIMEOUT_MS = AI_RESPONSE_TIMEOUT_MS + 120_000;

  test('Send message via Enter key (default user path)', { tag: ['@thorough', '@chat'] }, async ({ page }, testInfo) => {
    // Budget: bumped first-gate (initial gen) + second gate (own-response) + slack.
    testInfo.setTimeout(INITIAL_GEN_TIMEOUT_MS + AI_RESPONSE_TIMEOUT_MS + 60_000);

    await dismissOverlays(page);

    // First send waits out the fresh app's initial AI generation (readiness),
    // then exercises the Enter-key submit + full send→stream→idle cycle. The
    // helper gates on an ENABLED send button before pressing Enter so a
    // visible-but-disabled button can't silently swallow the submit.
    await sendChatMessage(page, {
      message: 'Add a footer',
      via: 'enter',
      readyTimeoutMs: INITIAL_GEN_TIMEOUT_MS,
    });

    await ensureAuthenticated(page);
  });

  test('Send message via send button (regression guard)', { tag: ['@thorough', '@chat'] }, async ({ page }, testInfo) => {
    // Same two-cycle budget as the Enter-key test above — see comment there.
    testInfo.setTimeout(2 * AI_RESPONSE_TIMEOUT_MS + 60_000);

    await dismissOverlays(page);

    // Runs after the Enter-key test (serial, same app), so initial gen is done
    // — readiness is the prior stream settling, not a cold gen. Exercises the
    // send-button click path through the same robust send→stream→idle cycle.
    await sendChatMessage(page, {
      message: 'Add a header section',
      via: 'button',
      readyTimeoutMs: AI_RESPONSE_TIMEOUT_MS,
    });
  });
});
