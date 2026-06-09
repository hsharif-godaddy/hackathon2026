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
import { test, expect } from '@playwright/test';

import { deleteApp, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { detectSsoType, ensureAuthenticated, handleSsoLogin, isSignInUIResult, loginIfNeeded } from '../helpers/auth';
import {
  AI_RESPONSE_TIMEOUT_MS,
  DEFAULT_TIMEOUT,
  E2E_NO_DELETE,
  LONG_TIMEOUT,
  getSpecPrefix,
} from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

const SPEC_NAME = 'chat-send';

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
      await page.goto('/');
      await dismissOverlays(page);
      await loginIfNeeded(page);
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
      // relative URL needs a base origin, which `about:blank` doesn't
      // provide, so navigate to the app's host first.
      await page.goto('/');
      await dismissOverlays(page);
      await loginIfNeeded(page);
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
    // Each test gets a fresh browser context (no storageState) — login fresh
    // before navigating to /develop/<id>, otherwise gd-auth bounces to SSO.
    await page.goto('/');
    await dismissOverlays(page);
    await loginIfNeeded(page);
    await page.goto(`/develop/${appId}`);
    await waitForDevelopPage(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);
  });

  // Initial AI generation needs more time than a follow-up response: the
  // legacy monolith reaches this gate ~1–2 min after homepage submit (so AI
  // gen has had a head-start during SSO + navigation), but in e2e-v2 the
  // app is created via API and the test arrives at /develop/<id> within
  // seconds — the AI gen has barely started when the wait begins. On a
  // slow test env that's not enough margin within AI_RESPONSE_TIMEOUT_MS.
  // Add 2 min to cover the missing head-start.
  const INITIAL_GEN_TIMEOUT_MS = AI_RESPONSE_TIMEOUT_MS + 120_000;

  test('Send message via Enter key (default user path)', async ({ page }, testInfo) => {
    // Budget: bumped first-gate (initial gen) + second gate (own-response) + slack.
    testInfo.setTimeout(INITIAL_GEN_TIMEOUT_MS + AI_RESPONSE_TIMEOUT_MS + 60_000);

    await dismissOverlays(page);

    const chatInput = page.getByTestId('chat-input-textarea');
    const transcript = page.getByTestId('chat-transcript');
    const message = 'Add a footer';

    // Gate on chat-send-button visibility — confirms initial AI app
    // generation finished and the streaming UI rolled back to the idle
    // send button. While streaming, ChatInput renders chat-stop-button
    // instead and Enter is a no-op, so without this wait the
    // transcript-text assertion below times out at 30s on a fresh app
    // whose initial gen is still in flight.
    await expect(page.getByTestId('chat-send-button')).toBeVisible({
      timeout: INITIAL_GEN_TIMEOUT_MS,
    });

    await chatInput.clear();
    await chatInput.fill(message);
    await chatInput.press('Enter');

    await expect(transcript.getByText(message, { exact: true })).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // chat-send-button being visible again indicates the AI response stream
    // ended and the input is ready for the next message.
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });

    await ensureAuthenticated(page);
  });

  test('Send message via send button (regression guard)', async ({ page }, testInfo) => {
    // Same two-cycle budget as the Enter-key test above — see comment there.
    testInfo.setTimeout(2 * AI_RESPONSE_TIMEOUT_MS + 60_000);

    await dismissOverlays(page);

    const chatInput = page.getByTestId('chat-input-textarea');
    const transcript = page.getByTestId('chat-transcript');
    const message = 'Add a header section';

    // Gate on idle send-button before clicking — see Enter-key test above.
    await expect(page.getByTestId('chat-send-button')).toBeVisible({
      timeout: AI_RESPONSE_TIMEOUT_MS,
    });

    await chatInput.clear();
    await chatInput.fill(message);
    await page.getByTestId('chat-send-button').click({ force: true });

    await expect(transcript.getByText(message, { exact: true })).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
  });
});
