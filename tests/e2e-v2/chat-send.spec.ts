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
 * Concurrency: serial within file. The two tests share one long-lived pool
 * app (`[e2e-pool:chat-send]`, resolved from the on-disk cache by the
 * `pool-resolve` setup project) and each test's transcript assertion expects
 * the message it just sent. Using a pre-generated pool app removes the ~7 min
 * cold initial-generation wait the old per-run app paid — the readiness gate
 * is now just "app idle", not "wait out a fresh build" (that cold wait was the
 * prod flake this migration fixes). e2e-v2 runs are serialized per env, so two
 * runs never write this shared app's transcript concurrently.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';

import { ensureAuthenticated, loginViaSsoDirect } from '../helpers/auth';
import {
  AI_RESPONSE_TIMEOUT_MS,
  DEFAULT_TIMEOUT,
  getEnvConfig,
} from '../helpers/constants';
import { getCachedPoolAppId } from '../helpers/pool-cache';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

const { env } = getEnvConfig();

/**
 * Make each sent message unique per test execution. The chat-send pool app is
 * long-lived and its transcript ACCUMULATES across runs, so a fixed message
 * ("Add a footer") would match multiple transcript entries on the second run
 * (strict-mode violation). A per-execution tag (regenerated on retries too)
 * keeps the "message landed in transcript" assertion matching exactly one. The
 * agent treats the bracketed tag as a no-op label.
 *
 * (Transcript growth is bounded operationally: bootstrap-pool re-seeds the app
 * if it's ever left stuck, and it can be deleted to force a fresh, small one.)
 */
function uniqueMessage(base: string): string {
  const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return `${base} [e2e ${tag}]`;
}

/**
 * Send one chat message and wait for the AI response to finish — robustly.
 *
 * The send/stop control is a SINGLE button element whose `data-testid` is
 * swapped imperatively in a useEffect (ChatInput.tsx) between
 * `chat-send-button` (idle) and `chat-stop-button` (awaiting/streaming), and
 * the send button only exists once the input has text. So:
 *
 *  - Readiness: gate on the input being present and the stop button being
 *    HIDDEN (no in-flight generation). The input stays enabled while a stream
 *    is awaited, so "input enabled" alone does not mean idle.
 *  - Submit: after filling text, gate the send button on `toBeEnabled` — a
 *    visible-but-disabled send button makes Enter/click a silent no-op (the
 *    message never reaches the transcript).
 *  - Response done: wait for a NEW response to reach the "Completed" status
 *    (`data-testid="response-metadata-status"`) — the deterministic
 *    generation-done signal the regression suite uses. This avoids racing the
 *    imperative send/stop testid swap. The pool app's transcript accumulates
 *    across runs, so we wait for the Completed count to INCREASE, not an
 *    absolute value.
 */
async function sendChatMessage(
  page: Page,
  opts: { message: string; via: 'enter' | 'button'; readyTimeoutMs: number },
): Promise<void> {
  const chatInput = page.getByTestId('chat-input-textarea');
  const transcript = page.getByTestId('chat-transcript');
  const sendButton = page.getByTestId('chat-send-button');
  const stopButton = page.getByTestId('chat-stop-button');

  // Ready to send means: the chat input exists AND no generation is in flight.
  // Two ChatInput.tsx subtleties make the naive gates wrong:
  //   - The send button (chat-send-button) is rendered only once the input has
  //     TEXT, so waiting for it on an empty input hangs forever.
  //   - While a generation is awaited or streaming (isAwaitingStream/isStreaming)
  //     the action button is a "stop" button — but the input stays ENABLED in
  //     the awaiting state, so gating on the input being enabled is NOT enough.
  // So gate on the input being present and the stop button being absent (idle),
  // which is the only reliable "no in-flight generation" signal.
  await expect(chatInput).toBeVisible({ timeout: opts.readyTimeoutMs });
  await expect(stopButton).toBeHidden({ timeout: opts.readyTimeoutMs });

  await chatInput.clear();
  await chatInput.fill(opts.message);

  // Now that the input has text the send button renders. Must be ENABLED before
  // submit — a visible-but-disabled send button makes Enter/click a silent
  // no-op (the root cause of the transcript-timeout flake).
  await expect(sendButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  await expect(sendButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });

  // Snapshot how many responses have already completed (the pool app's
  // transcript accumulates across runs), so "done" means one MORE reaches
  // Completed — not an absolute count.
  const completedStatus = page.getByTestId('response-metadata-status');
  const completedBefore = await completedStatus.count();

  if (opts.via === 'enter') await chatInput.press('Enter');
  else await sendButton.click({ force: true });

  // The submitted message lands in the transcript (fast, deterministic).
  await expect(transcript.getByText(opts.message, { exact: true })).toBeVisible({
    timeout: DEFAULT_TIMEOUT,
  });

  // Response resolved once a NEW response shows the "Completed" status — the
  // deterministic generation-done signal the regression suite uses, rather than
  // racing the imperative send/stop testid swap. `>=` (via poll) tolerates the
  // accumulating transcript and any extra status node.
  await expect
    .poll(() => completedStatus.count(), { timeout: AI_RESPONSE_TIMEOUT_MS })
    .toBeGreaterThanOrEqual(completedBefore + 1);
}

test.describe.configure({ mode: 'serial' });

test.describe('E2E v2 - Chat send', () => {
  let appId: string;

  test.beforeAll(() => {
    // Pool app: the two tests share a single long-lived, pre-generated app
    // instead of minting a fresh one and waiting out its cold initial AI
    // generation (the old per-run beforeAll paid ~2 min and the first test's
    // readiness gate then waited up to ~7 min for the build to settle — the
    // prod timeout this migration fixes). The id is resolved ONCE by the
    // `pool-resolve` setup project and read here from the on-disk cache (no
    // network, no login). getCachedPoolAppId throws a clear hint if the cache
    // is missing (pool-resolve didn't run, or bootstrap-pool never seeded it).
    appId = getCachedPoolAppId(env, 'chat-send');
    console.log(`  chat-send pool app (cached): ${appId}`);
  });

  // No afterAll cleanup — pool apps are long-lived and reused across runs.
  // They carry the [e2e-pool:*] prefix, which the eviction guard skips.

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

  test('Send message via Enter key (default user path)', { tag: ['@thorough', '@chat'] }, async ({ page }, testInfo) => {
    // Budget: readiness (idle pool app, or a settling prior stream) + own
    // response + slack. No cold initial-gen wait — the pool app is
    // pre-generated, so the readiness gate is fast.
    testInfo.setTimeout(2 * AI_RESPONSE_TIMEOUT_MS + 60_000);

    await dismissOverlays(page);

    // First send: the pool app is already idle on load, so readiness resolves
    // quickly (it only waits if a prior stream is still settling). Exercises
    // the Enter-key submit + full send→stream→idle cycle. The helper gates on
    // an ENABLED send button before pressing Enter so a visible-but-disabled
    // button can't silently swallow the submit.
    await sendChatMessage(page, {
      message: uniqueMessage('Add a footer'),
      via: 'enter',
      readyTimeoutMs: AI_RESPONSE_TIMEOUT_MS,
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
      message: uniqueMessage('Add a header section'),
      via: 'button',
      readyTimeoutMs: AI_RESPONSE_TIMEOUT_MS,
    });
  });
});
