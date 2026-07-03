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
import { test, expect } from '../helpers/test-fixtures';

import { ensureAuthenticated, loginViaSsoDirect } from '../helpers/auth';
import {
  AI_RESPONSE_TIMEOUT_MS,
  DEFAULT_TIMEOUT,
  LONG_TIMEOUT,
  getEnvConfig,
} from '../helpers/constants';
import { getCachedPoolAppId } from '../helpers/pool-cache';
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

  test.beforeAll(() => {
    // Pool app: develop-ui's tests are read-only (see invariant comment at
    // the top of this file), so they share a single long-lived pool app
    // instead of generating a fresh one per run. This skips the ~2 min
    // homepage-submit + initial-AI-gen cost this beforeAll used to pay.
    //
    // The id is resolved ONCE by the `pool-resolve` setup project (an
    // e2e-v2 `dependencies` entry) and read here from the on-disk cache —
    // no network, no login. This is what eliminates the workers=4
    // concurrent `GET /api/sites` burst that 504'd against the test env.
    // getCachedPoolAppId throws a clear hint if the cache is missing (i.e.
    // pool-resolve didn't run, or bootstrap-pool never seeded the app).
    appId = getCachedPoolAppId(env, 'develop-ui');
    console.log(`  develop-ui pool app (cached): ${appId}`);
  });

  // No afterAll cleanup — pool apps are long-lived and reused across runs.
  // They carry the [e2e-pool:*] prefix, which the eviction guard skips.

  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    // Each parallel test gets a fresh context, so coachmark suppression
    // must be re-applied on every test.
    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });
    // Each test gets a fresh browser context (no storageState) — log in via
    // the standalone SSO page first, then go straight to /develop/<id>.
    await loginViaSsoDirect(page);
    await page.goto(`/develop/${appId}`);
    await waitForDevelopPage(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);
  });

  test('Develop page components render correctly', { tag: ['@pr-fast', '@develop'] }, async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);

    const airoHeader = page.getByTestId('airo-header');
    const publishButton = airoHeader.getByTestId('publish-trigger-button');
    const chatInput = page.getByTestId('chat-input-textarea');

    await expect(airoHeader).toBeVisible();

    await expect(publishButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(publishButton).not.toBeDisabled();

    await page.getByTestId('preview-iframe').waitFor({ state: 'visible' });
    await expect(page.getByTestId('preview-iframe')).toHaveAttribute('src', /.+/);

    await expect(chatInput).toBeVisible();
    await expect(chatInput).not.toBeDisabled();
  });

  test('Preview refresh and device selector', { tag: ['@pr-fast', '@develop'] }, async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);

    await dismissOverlays(page);

    const airoHeader = page.getByTestId('airo-header');
    const headerRefreshButton = airoHeader.getByTestId('header-refresh-button');
    const deviceSelectorTrigger = airoHeader.getByTestId('preview-device-selector-trigger');

    await expect(headerRefreshButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(deviceSelectorTrigger).toBeVisible();

    await headerRefreshButton.click({ force: true });
    await expect(page.getByTestId('preview-iframe')).toBeVisible();

    await deviceSelectorTrigger.click({ force: true });
    const devicePopover = page.getByTestId('device-selector-popover');
    await devicePopover.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await devicePopover.getByTestId('device-option-mobile').click({ force: true });
    await expect(page.getByTestId('preview-iframe')).toBeVisible();

    // Restore desktop so we don't leave the shared app's preview pinned to
    // a mobile breakpoint. Even though tests run in separate contexts,
    // restoring here keeps per-test state hygiene matching the monolith's
    // Step 3.
    await deviceSelectorTrigger.click({ force: true });
    await devicePopover.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await devicePopover.getByTestId('device-option-desktop').click({ force: true });
    await expect(page.getByTestId('preview-iframe')).toBeVisible();
  });

  test('Chat input states behave correctly', { tag: ['@pr-fast', '@develop'] }, async ({ page }, testInfo) => {
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

  test('Edit mode toggle works', { tag: ['@pr-fast', '@develop'] }, async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);

    await dismissOverlays(page);

    const editModeButton = page.getByTestId('header-tab-edit');

    if (optionalFeaturesAreRequired) {
      await expect(editModeButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    } else if (!(await editModeButton.isVisible().catch(() => false))) {
      console.log(`  Edit mode not visible in env=${env} (feature-flagged), skipping`);
      return;
    }

    await editModeButton.click({ force: true });
    await expect(page.getByTestId('preview-iframe')).toBeVisible();

    const previewModeButton = page.getByTestId('header-tab-preview');
    if (await previewModeButton.isVisible().catch(() => false)) {
      await previewModeButton.click({ force: true });
    } else {
      await editModeButton.click({ force: true });
    }
    await expect(page.getByTestId('preview-iframe')).toBeVisible();
  });

  test('Code view loads and unified search works', { tag: ['@pr-fast', '@develop'] }, async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);

    await dismissOverlays(page);

    const codeViewButton = page.getByTestId('header-tab-code');
    await expect(codeViewButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await codeViewButton.click({ force: true });

    // Code view auto-expands the search on entry (PreviewCode.tsx useEffect:
    // "!wasCode && isCode && loadingPhase === 'ready'" → expandSearch()), so the
    // "Files" sidebar heading is always hidden (opacity-0 w-0 overflow-hidden)
    // when code view first loads. Use the search input becoming visible as the
    // reliable indicator that code view has fully loaded.
    const searchInput = page.getByTestId('search-input-header');

    if (optionalFeaturesAreRequired) {
      // The search auto-expand is gated on the whole code view (Monaco + file
      // tree) reaching loadingPhase === 'ready'. On a slow/cold prod load that
      // can exceed DEFAULT_TIMEOUT (30s), leaving the input collapsed
      // (w-0 opacity-0) → toBeVisible flakes. LONG_TIMEOUT (60s) matches how
      // heavy code view is (comparable to preview load) while still leaving
      // ample room in the test's 180s budget for the rest.
      await expect(searchInput).toBeVisible({ timeout: LONG_TIMEOUT });
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
    const previewTab = page.getByTestId('header-tab-preview');
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
    const clearButton = page.getByTestId('search-clear-button');
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

  test('Publish button is visible and enabled', { tag: ['@pr-fast', '@develop'] }, async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);

    await dismissOverlays(page);
    await ensureAuthenticated(page);

    const airoHeader = page.getByTestId('airo-header');
    const publishButton = airoHeader.getByTestId('publish-trigger-button');

    // We do NOT click publish here — clicking would mutate state (trigger
    // a deploy) and violate this file's no-mutation invariant. Publish UI
    // behavior beyond visibility lives in publish-and-domain.spec.ts.
    await expect(publishButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(publishButton).not.toBeDisabled();
  });

  test('Manual feedback trigger shows category step', { tag: ['@pr-fast', '@develop'] }, async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);

    // Stay on the chat tab. The settings popover is opened by the toolbar
    // button, NOT by navigating to ?tab=settings — that URL switches the chat
    // pane to the settings *panel* (Purge Cache / Download / etc.), which has no
    // chat input, so the beforeEach/waitForDevelopPage readiness gate could never
    // pass there. beforeEach already navigated to /develop/<id> and waited.
    await dismissOverlays(page);

    // Open the Settings popover from the toolbar. The button lives in a
    // controlled ButtonGroup whose click takes the onChange branch
    // (ButtonGroup.tsx handleClick: `if (controlled) onChange(value)` — the
    // item's own onClick never fires here), and onChange → togglePopover does a
    // single setOpen(!prev). So one click opens it. The flake is hydration: a
    // force-click that lands before the toolbar wires its handler silently
    // no-ops and burns the popover wait. toBeEnabled() doesn't catch this (the
    // button has no disabled prop, so it reads enabled pre-hydration). Poll
    // instead: click only while the popover is closed, then assert it opened.
    // Idempotent against the toggle (never double-clicks an open popover) and
    // retries through the hydration gap.
    const settingsButton = page.getByTestId('chat-toolbar-settings-button');
    await expect(settingsButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const settingsPopover = page.locator('[data-slot="popover-content"][data-state="open"]');
    await expect(async () => {
      if (!(await settingsPopover.isVisible().catch(() => false))) {
        await settingsButton.click({ force: true });
      }
      await expect(settingsPopover).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: DEFAULT_TIMEOUT });

    // Click "Feedback" item in the open settings popover.
    // Scope to the popover because publish-success-alert can also render a
    // feedback button after auto-publish in test/prod.
    // useSettingsNavItems.handleFeedbackClick clears localStorage guard internally
    // and calls openFeedbackModal(FEEDBACK_ID, 'Settings') with NO initialStep.
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
