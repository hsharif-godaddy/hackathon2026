/**
 * E2E Critical Path Test (Single App)
 *
 * Consolidated test that creates ONE app and exercises all critical features
 * sequentially. Designed for fast validation (post-deploy, CI, manual).
 *
 * Coverage (10 sequential steps, see test.step blocks below):
 *  1. Homepage + SSO Login + App Creation
 *  2. Verify develop page components (header, preview, chat)
 *  3. Preview controls (refresh, device selector) + auto-publish verification
 *  4. Chat input states (disabled/enabled, multi-line)
 *  5. Send message via send button click
 *  6. Send message via Enter key
 *  7. Edit mode toggle
 *  8. Code view + unified search
 *  9. Publish button verification
 * 10. Page refresh recovery
 *
 * Strategy:
 * - Single login, single app, single continuous flow
 * - Each step wrapped in test.step() so failures land at the failing step
 *   in the HTML report (named entries, scoped screenshots, trace segments)
 *   instead of the catch-all outer test
 * - Feature-flagged capabilities are required on prod and optional elsewhere
 *   so a selector regression on prod fails the test instead of silently skipping
 * - ensureAuthenticated() called after long AI waits
 */
import { test, expect } from '@playwright/test';

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { detectSsoType, handleSsoLogin, isSignInUIResult, ensureAuthenticated } from '../helpers/auth';
import {
  AI_RESPONSE_TIMEOUT_MS,
  CHAT_INPUT_TIMEOUT,
  DEFAULT_TIMEOUT,
  E2E_NO_DELETE,
  LONG_TIMEOUT,
  PREVIEW_TIMEOUT,
  PUBLISH_TIMEOUT_MS,
  getEnvConfig,
  getSpecPrefix,
} from '../helpers/constants';
import {
  dismissOverlays,
  expectPublishSuccessVisible,
  logTestResult,
  logTestStart,
  waitForChatInput,
  waitForDevelopPage,
} from '../helpers/ui';

/**
 * Spec prefixes used by `getSpecPrefix(...)` calls inside this describe block.
 * Kept in sync with the prompts in each `test()` so per-spec cleanup deletes
 * exactly the apps THIS spec created — never another worker's apps. Add new
 * names here whenever a new `getSpecPrefix(...)` arg is introduced below.
 */
const SPEC_PREFIXES = ['e2e'] as const;

test.describe('E2E - Critical Path', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    // Pre-flight guard: evict oldest e2e-tagged orphans if the test account
    // has accumulated near the mgmt-airo cap. Skipped when E2E_NO_DELETE is
    // set (local/dev mode) so iterations preserve apps for inspection.
    if (!E2E_NO_DELETE) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch(() => {});
    }
  });

  test('Single app happy path - create through publish', async ({ page }, testInfo) => {
    testInfo.setTimeout(600_000); // 10 minutes

    const { env } = getEnvConfig();
    /**
     * Edit mode and code view are GA on prod. Treating a missing selector as
     * "feature-flagged, skipping" on prod silently masks selector regressions
     * in the canonical environment. On non-prod they are still optional (under
     * flags or staged rollout), so a soft-skip is fine there.
     *
     * Brand Book was previously a Step 10 here but is gated by the
     * appbuilder-brandbook switchboard flag and is not enabled for every
     * account on prod, so it now lives in the regression suite.
     */
    const optionalFeaturesAreRequired = env === 'prod';

    // Suppress coachmark tours
    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    const airoHeader = page.getByTestId('airo-header');
    const publishButton = airoHeader.getByRole('button', { name: /publish/i });
    const chatInput = page.getByTestId('chat-input-textarea');
    const transcript = page.getByTestId('chat-transcript');

    await test.step('Step 1: Homepage + SSO Login + App Creation', async () => {
      await page.goto('/');

      const promptInput = page.getByTestId('homepage-prompt-input');
      await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });

      // Dismiss any cookie banners / overlays that might block the submit button
      await dismissOverlays(page);

      await promptInput.fill(
        `${getSpecPrefix('e2e')} Simple landing page with a hero section and a call to action button - do not ask follow up questions and publish this app`,
      );

      // data-eid is server-rendered so its presence doesn't prove React hydration,
      // and the disabled-state flips synchronously even before the click handler
      // is attached. Empirically 10 s is enough to cover hydration on the slowest
      // of the four target environments (dev/pre-test/test/prod). networkidle was
      // tried (commit ee364cdee) and was unreliable because background polling
      // requests prevent the page from ever going idle. If a hydration marker is
      // ever exposed (e.g. a data-hydrated attribute on the form), prefer
      // page.waitForFunction over this fixed wait.
      const submitButton = page.locator('[data-eid*="homepage.prompt.submit"]');
      await expect(submitButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
      await page.waitForTimeout(10_000);
      console.log('  Submit button ready');

      await submitButton.click();
      console.log('  Submit clicked');

      // Handle SSO login if needed (user may already be authenticated from a previous session)
      const ssoResult = await detectSsoType(page, true);
      if (ssoResult === 'authenticated') {
        console.log('  Already authenticated, proceeding to develop page');
      } else if (isSignInUIResult(ssoResult)) {
        console.log(`  SSO detected (${ssoResult}), logging in...`);
        await handleSsoLogin(page);
      } else {
        throw new Error(`Unexpected state after submit: neither SSO nor develop page appeared (got: ${ssoResult})`);
      }

      await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
      await waitForDevelopPage(page);

      // App id in /develop/:id may be a UUID (hyphens). [a-zA-Z0-9]+ truncates
      // hyphenated UUIDs (e.g. abc12345-def6-7890 → abc12345), causing logged
      // app IDs to be wrong and any downstream string-equality checks to fail.
      const appId = page.url().match(/\/develop\/([^/?#]+)/)?.[1] ?? '';
      console.log(`  App created: ${appId}`);

      await dismissOverlays(page);
    });

    await test.step('Step 2: Verify develop page components', async () => {
      await expect(airoHeader).toBeVisible();
      console.log('  Header visible');

      await expect(publishButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await expect(publishButton).not.toBeDisabled();
      console.log('  Publish button visible and enabled');

      await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });
      await expect(page.getByTestId('preview-iframe')).toHaveAttribute('src', /.+/);
      console.log('  Preview iframe loaded');

      await chatInput.waitFor({ state: 'visible', timeout: CHAT_INPUT_TIMEOUT });
      await expect(chatInput).not.toBeDisabled();
      console.log('  Chat input visible and enabled');
    });

    await test.step('Step 3: Preview controls + auto-publish verification', async () => {
      await dismissOverlays(page);

      // Wait for initial AI generation to complete
      await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
      console.log('  Initial app generation completed');

      // Verify auto-publish succeeded (prompt instructed AI to publish)
      await expectPublishSuccessVisible(page, PUBLISH_TIMEOUT_MS);
      console.log('  Auto-publish success verified');

      // Dismiss congrats modal if visible
      const congratsModal = page.locator('#first-publish-congrats-modal');
      if (await congratsModal.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape');
        await expect(congratsModal).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
      }

      await ensureAuthenticated(page);

      const headerRefreshButton = airoHeader.getByRole('button', {
        name: /refresh|builder_preview_button_refresh/i,
      });
      const deviceSelectorTrigger = airoHeader.getByRole('button', {
        name: /device|builder_preview_button_device/i,
      });

      await expect(headerRefreshButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await expect(deviceSelectorTrigger).toBeVisible();
      console.log('  Refresh and device selector visible');

      await headerRefreshButton.click({ force: true });
      await expect(page.getByTestId('preview-iframe')).toBeVisible();
      console.log('  Refresh works');

      await deviceSelectorTrigger.click({ force: true });
      const devicePopover = page.locator('[data-slot="popover-content"][data-state="open"]');
      await devicePopover.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
      await devicePopover.getByRole('button', { name: /iphone se/i }).click({ force: true });
      await expect(page.getByTestId('preview-iframe')).toBeVisible();
      console.log('  Mobile view works');

      await deviceSelectorTrigger.click({ force: true });
      await devicePopover.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
      await devicePopover
        .getByRole('button', { name: /full size|builder_device_full_size/i })
        .click({ force: true });
      await expect(page.getByTestId('preview-iframe')).toBeVisible();
      console.log('  Desktop view restored');
    });

    await test.step('Step 4: Chat input states', async () => {
      await dismissOverlays(page);

      await waitForChatInput(page);

      // Empty = disabled
      await chatInput.clear();
      await expect(page.getByTestId('chat-send-button')).toBeDisabled();
      console.log('  Send disabled when empty');

      // Text = enabled
      await chatInput.fill('Test message');
      await expect(page.getByTestId('chat-send-button')).not.toBeDisabled();
      console.log('  Send enabled when text entered');

      // Shift+Enter = multiline
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
      console.log('  Shift+Enter creates multiline');

      await chatInput.clear();
    });

    await test.step('Step 5: Send message via click', async () => {
      await dismissOverlays(page);

      const clickMessage = 'Add a header section';
      await chatInput.fill(clickMessage);
      await page.getByTestId('chat-send-button').click({ force: true });

      await expect(transcript.getByText(clickMessage, { exact: true })).toBeVisible({ timeout: 10000 });
      console.log('  Message sent');

      await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
      console.log('  AI response completed');
    });

    await test.step('Step 6: Send message via Enter', async () => {
      await dismissOverlays(page);

      const enterMessage = 'Add a footer';
      await chatInput.clear();
      await chatInput.fill(enterMessage);
      await chatInput.press('Enter');

      await expect(transcript.getByText(enterMessage, { exact: true })).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  Message sent');

      await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
      console.log('  AI response completed');

      await ensureAuthenticated(page);
    });

    await test.step('Step 7: Edit mode toggle', async () => {
      await dismissOverlays(page);

      // The header EDIT toggle is a `role=radio` ButtonGroup item (see
      // app/src/app/[market]/develop/components/layout/Header.tsx). The
      // `develop.header.edit_mode` string is an analytics event id fired from
      // onChange, NOT a `data-eid` DOM attribute, so locating by data-eid
      // matches nothing and used to silently no-op under the soft skip.
      const editModeButton = page.getByRole('radio', { name: /builder_preview_button_edit|Edit/i });

      if (optionalFeaturesAreRequired) {
        // GA on prod — a missing selector here is a regression, not a flag.
        await expect(editModeButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      } else if (!(await editModeButton.isVisible().catch(() => false))) {
        console.log(`  Edit mode not visible in env=${env} (feature-flagged), skipping`);
        return;
      }

      await editModeButton.click({ force: true });
      await expect(page.getByTestId('preview-iframe')).toBeVisible();
      console.log('  Edit mode on');

      const previewModeButton = page.getByRole('radio', { name: /builder_preview_button_preview|Preview/i });
      if (await previewModeButton.isVisible().catch(() => false)) {
        await previewModeButton.click({ force: true });
      } else {
        await editModeButton.click({ force: true });
      }
      await expect(page.getByTestId('preview-iframe')).toBeVisible();
      console.log('  Edit mode off');
    });

    await test.step('Step 8: Code view + unified search', async () => {
      await dismissOverlays(page);

      const codeViewButton = page.getByRole('radio', { name: /builder_preview_button_code|Code/i });
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
      console.log('  Code view loaded');

      const searchButton = page.getByTestId('search-button');
      await expect(searchButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      // Search is already auto-expanded on code view entry; the panel is open.

      const searchPanel = page.getByTestId('search-panel');
      await expect(searchPanel).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  Search panel opened');

      await expect(searchInput).toBeVisible();
      await searchInput.fill('index');
      await page.waitForTimeout(500); // debounce

      const fileResults = page.getByTestId('search-results-files');
      const hasFileResults = await fileResults.isVisible().catch(() => false);
      if (hasFileResults) {
        const firstResult = fileResults.locator('button').first();
        await expect(firstResult).toBeVisible();
        await firstResult.click();
        console.log('  File search result clicked');
      } else {
        console.log('  No file results (expected for simple apps)');
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
        console.log('  Search works after tab round-trip');
      }

      // Clear search
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
      console.log('  Search clear works');

      if (await previewTab.isVisible().catch(() => false)) {
        await previewTab.click();
        await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
      }
    });

    await test.step('Step 9: Publish button verification', async () => {
      await dismissOverlays(page);

      await ensureAuthenticated(page);

      // Auto-publish already happened during initial AI generation (Step 1 prompt).
      // Just verify the publish button is present and enabled.
      await expect(publishButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await expect(publishButton).not.toBeDisabled();
      console.log('  Publish button visible and enabled');
    });

    await test.step('Step 10: Page refresh recovery', async () => {
      await page.reload();

      // The SSO Deck iframe keeps VAT (info_idp_vat_time) fresh via heartbeat;
      // on reload, an in-flight heartbeat can be cancelled and VAT can briefly
      // tip past the server's 5-minute window. gasket-auth's /api/auth/validate
      // then returns 401 (authReason=3, VAT) and gasket-auth redirects the top
      // window to sso.<env>-godaddy.com/login?path=%2Fdevelop%2F<id>. The
      // session is still valid; the next heartbeat refreshes VAT. Handle the
      // bounce instead of failing the refresh step.
      await ensureAuthenticated(page);

      // After ensureAuthenticated returns we should be back on the develop
      // page; guard against landing on the root or any other post-SSO target
      // by anchoring to /develop/ in the path (stop at ? or #) and rejecting
      // an sso.* host.
      await expect(page).toHaveURL(/^(?!https:\/\/sso\.)[^?#]*\/develop\//);
      await expect(airoHeader).toBeVisible();
      await chatInput.waitFor({ state: 'visible', timeout: CHAT_INPUT_TIMEOUT });
      await expect(chatInput).not.toBeDisabled();
      await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });
      console.log('  Page refresh maintains state');
    });

    console.log('All E2E critical path tests passed!');
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);

    if (E2E_NO_DELETE) {
      console.log('Cleanup skipped (E2E_NO_DELETE=true)');
      return;
    }

    console.log('Cleanup...');
    try {
      await page.goto('/apps');
      // Per-test cleanup: only delete apps THIS spec created. Each entry in
      // SPEC_PREFIXES corresponds to a `getSpecPrefix(...)` call above; keep
      // the two lists in sync when adding new test cases. Per-prefix
      // try/catch so one failing prefix doesn't skip cleanup of the rest.
      for (const name of SPEC_PREFIXES) {
        try {
          await deleteAppsWithPrefix(page, getSpecPrefix(name));
        } catch (err) {
          console.error(`  Cleanup of prefix '${name}' failed:`, err);
        }
      }
    } catch (err) {
      // A bare empty catch silently leaks the created app on every retry. Log
      // the actual error so quota/auth/schema regressions are debuggable.
      console.error('  Cleanup failed:', err);
    }
  });
});
