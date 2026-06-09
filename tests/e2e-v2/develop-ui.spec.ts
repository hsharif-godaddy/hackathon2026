/**
 * Develop page UI — read-only verification suite.
 *
 * Coverage: legacy monolith Steps 2, 3 (preview controls), 4, 7, 8, 9, 10.
 * Step 12 (page-reload recovery) deliberately lives in
 * `publish-and-domain.spec.ts` so the `?tab=settings` URL-normalization
 * branch fires after Step 11 leaves the page on `?tab=settings`. Putting
 * Step 12 here on a fresh app would skip that branch.
 *
 * INVARIANT: Tests in this file MUST NOT mutate persistent app state.
 * They share one server-side app across parallel browser contexts (each
 * test runs in its own SSO session). Allowed: navigating, reading,
 * opening modals (Escape-close), clearing the chat input. Forbidden:
 * sending chat messages, publishing, attaching domains, archiving,
 * archive-restore, etc. Move those to a dedicated file with its own app.
 *
 * Concurrency: file-level parallel (fullyParallel: true). Each test's
 * `beforeEach` navigates to `/develop/<appId>` and waits for the develop
 * page; the underlying app is created once in `beforeAll` and deleted
 * once in `afterAll`.
 */
import { test, expect } from '@playwright/test';

import { deleteApp, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { detectSsoType, ensureAuthenticated, handleSsoLogin, isSignInUIResult, loginIfNeeded } from '../helpers/auth';
import {
  AI_RESPONSE_TIMEOUT_MS,
  DEFAULT_TIMEOUT,
  E2E_NO_DELETE,
  LONG_TIMEOUT,
  getEnvConfig,
  getSpecPrefix,
} from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

const SPEC_NAME = 'develop-ui';

/**
 * Edit mode and code view are GA on prod. Treating a missing selector as
 * "feature-flagged, skipping" on prod silently masks selector regressions
 * in the canonical environment. On non-prod they are still optional (under
 * flags or staged rollout), so a soft-skip is fine there.
 */
const { env } = getEnvConfig();
const optionalFeaturesAreRequired = env === 'prod';

test.describe('E2E v2 - Develop page UI', () => {
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
    // assertions but consistently failed the Chat-input-states test that
    // waited >5 min for chat-send-button to flip to idle — the page
    // bounced to a homepage-style fallback render mid-wait. Homepage submit
    // lets the AI agent warm up during the SSO + redirect cost so the
    // streaming UI has a head-start (matches legacy e2e.spec.ts).
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
      console.log(`  develop-ui shared app: ${appId}`);
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
    // Each parallel test gets a fresh context, so coachmark suppression
    // must be re-applied on every test.
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

  test('Develop page components render correctly', async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);

    const airoHeader = page.getByTestId('airo-header');
    const publishButton = airoHeader.getByRole('button', { name: /publish/i });
    const chatInput = page.getByTestId('chat-input-textarea');

    await expect(airoHeader).toBeVisible();

    await expect(publishButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(publishButton).not.toBeDisabled();

    await page.getByTestId('preview-iframe').waitFor({ state: 'visible' });
    await expect(page.getByTestId('preview-iframe')).toHaveAttribute('src', /.+/);

    await expect(chatInput).toBeVisible();
    await expect(chatInput).not.toBeDisabled();
  });

  test('Preview refresh and device selector', async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);

    await dismissOverlays(page);

    const airoHeader = page.getByTestId('airo-header');
    const headerRefreshButton = airoHeader.getByRole('button', {
      name: /refresh|builder_preview_button_refresh/i,
    });
    const deviceSelectorTrigger = airoHeader.getByRole('button', {
      name: /device|builder_preview_button_device/i,
    });

    await expect(headerRefreshButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(deviceSelectorTrigger).toBeVisible();

    await headerRefreshButton.click({ force: true });
    await expect(page.getByTestId('preview-iframe')).toBeVisible();

    // PR #4557 replaced the long device list (iPhone SE, Pixel, etc.) with
    // a 3-row breakpoint menu: Desktop / Laptop, Tablet, Mobile. The button
    // labels come from translation keys `builder_analytics_{desktop_laptop,
    // tablet, mobile}` (DeviceSelector.tsx); match either the rendered text
    // or the key directly so the test works against both translated and
    // un-translated environments.
    await deviceSelectorTrigger.click({ force: true });
    const devicePopover = page.locator('[data-slot="popover-content"][data-state="open"]');
    await devicePopover.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await devicePopover
      .getByRole('button', { name: /^mobile$|builder_analytics_mobile/i })
      .click({ force: true });
    await expect(page.getByTestId('preview-iframe')).toBeVisible();

    // Restore desktop so we don't leave the shared app's preview pinned to
    // a mobile breakpoint. Even though tests run in separate contexts,
    // restoring here keeps per-test state hygiene matching the monolith's
    // Step 3.
    await deviceSelectorTrigger.click({ force: true });
    await devicePopover.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await devicePopover
      .getByRole('button', { name: /desktop\s*\/\s*laptop|builder_analytics_desktop_laptop/i })
      .click({ force: true });
    await expect(page.getByTestId('preview-iframe')).toBeVisible();
  });

  test('Chat input states behave correctly', async ({ page }, testInfo) => {
    // While AI is still streaming the initial app generation in this fresh
    // context, the chat-send-button is replaced by a stop/loading element.
    // The gating wait below dominates this test's wall-clock. Use double
    // AI_RESPONSE_TIMEOUT_MS (600s = 10 min) for both: the global 7-min
    // playwright timeout (`timeout: 420000`) was clipping a 5-min wait on a
    // slow env, and a single AI cycle on test-godaddy.com has been observed
    // to exceed 5 min during congestion. Test body itself is fast.
    const GATING_TIMEOUT = 2 * AI_RESPONSE_TIMEOUT_MS;
    testInfo.setTimeout(GATING_TIMEOUT + 60_000);

    await dismissOverlays(page);

    const chatInput = page.getByTestId('chat-input-textarea');

    // Gate on chat-send-button visibility — confirms initial AI generation
    // finished and the streaming UI rolled back to the idle send button.
    // Without this, the toBeDisabled() assertion below races the streaming
    // state and fails with "element(s) not found" because the stop button
    // has a different testid.
    await expect(page.getByTestId('chat-send-button')).toBeVisible({
      timeout: GATING_TIMEOUT,
    });

    await chatInput.clear();
    await expect(page.getByTestId('chat-send-button')).toBeDisabled();

    await chatInput.fill('Test message');
    await expect(page.getByTestId('chat-send-button')).not.toBeDisabled();

    await chatInput.clear();
    await chatInput.click();
    await chatInput.pressSequentially('Line 1');
    await chatInput.press('Shift+Enter');
    await chatInput.pressSequentially('Line 2');
    // chat-input-textarea is a Lexical contenteditable div, not a <textarea>,
    // so inputValue() doesn't work — read text content instead.
    const multilineValue = await chatInput.innerText();
    expect(multilineValue).toContain('Line 1');
    expect(multilineValue).toContain('Line 2');

    // Clear at the end so the shared app's chat input is empty for any
    // subsequent test that opens this app in a different context. (Each
    // context has its own draft state, but matching the monolith's hygiene.)
    await chatInput.clear();
  });

  test('Edit mode toggle works', async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);

    await dismissOverlays(page);

    // The header EDIT toggle is a `role=radio` ButtonGroup item (see
    // app/src/app/[market]/develop/components/layout/Header.tsx). The
    // `develop.header.edit_mode` string is an analytics event id fired from
    // onChange, NOT a `data-eid` DOM attribute, so locating by data-eid
    // matches nothing and used to silently no-op under the soft skip.
    const editModeButton = page.getByRole('radio', { name: /builder_preview_button_edit|Edit/i });

    if (optionalFeaturesAreRequired) {
      await expect(editModeButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    } else if (!(await editModeButton.isVisible().catch(() => false))) {
      console.log(`  Edit mode not visible in env=${env} (feature-flagged), skipping`);
      return;
    }

    await editModeButton.click({ force: true });
    await expect(page.getByTestId('preview-iframe')).toBeVisible();

    const previewModeButton = page.getByRole('radio', { name: /builder_preview_button_preview|Preview/i });
    if (await previewModeButton.isVisible().catch(() => false)) {
      await previewModeButton.click({ force: true });
    } else {
      await editModeButton.click({ force: true });
    }
    await expect(page.getByTestId('preview-iframe')).toBeVisible();
  });

  test('Code view loads and unified search works', async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);

    await dismissOverlays(page);

    // Code view lives in the secondary `ButtonGroup` (Header.tsx:182) which
    // has `role="group"` set — its items are <button>s, NOT radios. The
    // primary Edit/Preview ButtonGroup above leaves role unset and defaults
    // to radiogroup, which is why the Edit-mode test correctly uses
    // `getByRole('radio')` and this one cannot. Match legacy e2e.spec.ts:332
    // exactly: scoped to airo-header, role=button.
    const codeViewButton = page
      .getByTestId('airo-header')
      .getByRole('button', { name: /builder_preview_button_code|Code/i });
    await expect(codeViewButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await codeViewButton.click({ force: true });

    // Code view auto-expands the search on entry (PreviewCode.tsx useEffect:
    // "!wasCode && isCode && loadingPhase === 'ready'" → expandSearch()), so the
    // "Files" sidebar heading is always hidden (opacity-0 w-0 overflow-hidden)
    // when code view first loads. Use the search input becoming visible as the
    // reliable indicator that code view has fully loaded.
    const searchInput = page.getByTestId('search-input-header');

    if (optionalFeaturesAreRequired) {
      await expect(searchInput).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    } else {
      const codeViewLoaded = await searchInput
        .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
        .then(() => true)
        .catch(() => false);
      if (!codeViewLoaded) {
        console.log(`  Code view not available in env=${env} (feature-flagged), skipping`);
        return;
      }
    }

    const searchButton = page.getByTestId('search-button');
    await expect(searchButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const searchPanel = page.getByTestId('search-panel');
    await expect(searchPanel).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    await expect(searchInput).toBeVisible();
    await searchInput.fill('index');
    await page.waitForTimeout(500); // debounce

    const fileResults = page.getByTestId('search-results-files');
    const hasFileResults = await fileResults.isVisible().catch(() => false);
    if (hasFileResults) {
      const firstResult = fileResults.locator('button').first();
      await expect(firstResult).toBeVisible();
      await firstResult.click();
    }

    // Switch away to preview and back to code, then search again.
    // This verifies that typing in the header input re-activates the
    // search tab when a file result was previously selected.
    const previewTab = page.getByRole('radio', { name: /preview/i });
    if (await previewTab.isVisible().catch(() => false)) {
      await previewTab.click();
      await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });

      await codeViewButton.click({ force: true });
      await expect(searchInput).toBeVisible({ timeout: DEFAULT_TIMEOUT });

      await searchInput.fill('html');
      await page.waitForTimeout(500); // debounce
      await expect(searchPanel).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    }

    if (!(await searchPanel.isVisible().catch(() => false))) {
      await searchButton.click();
      await expect(searchPanel).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    }
    await searchInput.fill('test');
    const clearButton = page
      .getByTestId('search-input-header')
      .locator('xpath=..')
      .locator('button[aria-label="Clear"]');
    await expect(clearButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await clearButton.click();
    await expect(searchInput).toHaveValue('');

    // Restore preview tab so the shared app isn't left in code view for
    // any subsequent run (each test has its own context, but matches the
    // monolith's per-step hygiene).
    if (await previewTab.isVisible().catch(() => false)) {
      await previewTab.click();
      await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    }
  });

  test('Publish button is visible and enabled', async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);

    await dismissOverlays(page);
    await ensureAuthenticated(page);

    const airoHeader = page.getByTestId('airo-header');
    const publishButton = airoHeader.getByRole('button', { name: /publish/i });

    // We do NOT click publish here — clicking would mutate state (trigger
    // a deploy) and violate this file's no-mutation invariant. Publish UI
    // behavior beyond visibility lives in publish-and-domain.spec.ts.
    await expect(publishButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(publishButton).not.toBeDisabled();
  });

  test('Manual feedback trigger shows category step', async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);

    await dismissOverlays(page);

    // Open Settings menu popover via the toolbar button
    await page.getByTestId('chat-toolbar-settings-button').click({ force: true });

    // Click "Feedback" item in the open settings popover.
    // Scope to the popover because publish-success-alert can also render a
    // feedback button after auto-publish in test/prod.
    // useSettingsNavItems.handleFeedbackClick clears localStorage guard internally
    // and calls openFeedbackModal(FEEDBACK_ID, 'Settings') with NO initialStep.
    const settingsPopover = page.locator('[data-slot="popover-content"][data-state="open"]');
    await settingsPopover.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await settingsPopover.getByTestId('settings-feedback-item').click({ force: true });

    // Modal should open at category step (manual trigger = no initialStep).
    // The three test ids below are rendered only by CategorySelectStep, not by
    // FeedbackLegacy, and are stable against externally-managed i18n copy changes.
    const feedbackModal = page.locator('#feedback-modal');
    await feedbackModal.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });

    await expect(feedbackModal.getByTestId('feedback-category-support')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(feedbackModal.getByTestId('feedback-category-issue')).toBeVisible();
    await expect(feedbackModal.getByTestId('feedback-category-share')).toBeVisible();

    // Escape closes the modal — does not mutate persistent app state.
    await page.keyboard.press('Escape');
    await expect(feedbackModal).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
  });
});
