/**
 * E2E Critical Path Test (Single App)
 *
 * Consolidated test that creates ONE app and exercises all critical features
 * sequentially. Designed for fast validation (post-deploy, CI, manual).
 *
 * Coverage (12 sequential steps, see test.step blocks below):
 *  1. Homepage + SSO Login + App Creation
 *  2. Verify develop page components (header, preview, chat)
 *  3. Preview controls (refresh, device selector) + auto-publish verification
 *  4. Chat input states (disabled/enabled, multi-line)
 *  5. Send message via send button click
 *  6. Send message via Enter key
 *  7. Edit mode toggle
 *  8. Code view + unified search
 *  9. Publish button verification
 * 10. Manual feedback trigger category step
 * 11. Custom domain (e2e-{env}.airotesting.shop) — attach, verify DNS records, disconnect
 * 12. Page refresh recovery
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
  SHORT_TIMEOUT,
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
    testInfo.setTimeout(900_000); // 15 minutes (Step 3 auto-publish up to 10 min + remaining steps)

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
    // Auto-publish via AI prompt requires the full AI publish tooling available
    // on test/prod. The local dev shell (gasket) doesn't expose a real deployment
    // pipeline, so the "publish this app" instruction in the creation prompt has
    // no effect there. Step 9 exercises manual publish on every environment.
    const autoPublishSupported = env !== 'local';

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

      if (autoPublishSupported) {
        // Guard: ensure we are still on the develop page. If the test environment
        // had a session/network hiccup and redirected away, this fails fast with a
        // clear URL mismatch instead of silently burning the full PUBLISH_TIMEOUT_MS.
        await expect(page).toHaveURL(/\/develop\//, { timeout: DEFAULT_TIMEOUT });

        // Verify auto-publish succeeded (prompt instructed AI to publish)
        await expectPublishSuccessVisible(page, PUBLISH_TIMEOUT_MS);
        console.log('  Auto-publish success verified');

        // Dismiss congrats modal if visible
        const congratsModal = page.locator('#first-publish-congrats-modal');
        if (await congratsModal.isVisible().catch(() => false)) {
          await page.keyboard.press('Escape');
          await expect(congratsModal).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
        }
      } else {
        console.log('  Auto-publish skipped (local env — no deployment pipeline)');
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
      await expect(devicePopover.getByRole('button')).toHaveCount(3);
      await devicePopover.getByRole('button', { name: /mobile|builder_analytics_mobile/i }).click({ force: true });
      await expect(page.getByTestId('preview-iframe')).toBeVisible();
      console.log('  Mobile view works');

      await deviceSelectorTrigger.click({ force: true });
      await devicePopover.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
      await devicePopover.getByRole('button', { name: /tablet|builder_analytics_tablet/i }).click({ force: true });
      await expect(page.getByTestId('preview-iframe')).toBeVisible();
      console.log('  Tablet view works');

      await deviceSelectorTrigger.click({ force: true });
      await devicePopover.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
      await devicePopover
        .getByRole('button', { name: /desktop.*laptop|builder_analytics_desktop_laptop/i })
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

      const codeViewButton = page.getByTestId('airo-header').getByRole('button', { name: /builder_preview_button_code|Code/i });
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
      await expect(searchInput).toHaveValue('', { timeout: DEFAULT_TIMEOUT });
      console.log('  Search clear works');

      if (await previewTab.isVisible().catch(() => false)) {
        await previewTab.click();
        await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
      }
    });

    await test.step('Step 9: Publish button verification', async () => {
      await dismissOverlays(page);
      await ensureAuthenticated(page);

      // Auto-publish already happened during initial AI generation (Step 3).
      // A second publish through the UI is blocked by the plan-based paywall gate
      // (checkAndShowPaywall in AppPublish), so we only verify the button state.
      // The post-publish feedback auto-open flow is covered by unit tests.
      await expect(publishButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await expect(publishButton).not.toBeDisabled();
      console.log('  Publish button visible and enabled');
    });

    await test.step('Step 10: Manual feedback trigger shows category step (regression guard)', async () => {
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
      console.log('  Feedback modal opened');

      await expect(feedbackModal.getByTestId('feedback-category-support')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await expect(feedbackModal.getByTestId('feedback-category-issue')).toBeVisible();
      await expect(feedbackModal.getByTestId('feedback-category-share')).toBeVisible();
      console.log('  Manual trigger shows category step (not bypassed)');

      await page.keyboard.press('Escape');
      await expect(feedbackModal).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  Modal closed');
    });

    await test.step('Step 11: Custom domain (e2e-{env}.airotesting.shop) — attach, verify DNS, disconnect', async () => {
      // Subdomain is env-scoped so parallel CI runs across environments
      // (dev / pre-test / test / prod) never collide on the same FQDN.
      // The previous shared `e2e.airotesting.shop` left the Add button
      // disabled whenever a prior run in another env still owned the
      // domain — the validation API returns available=false until the
      // other app disconnects. Per-env subdomains sidestep that race.
      const TARGET_DOMAIN = `e2e-${env}.airotesting.shop`;
      const MAX_DOMAIN_ATTEMPTS = 3;

      const escapedTarget = TARGET_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const domainRowContainer = page
        .locator('div')
        .filter({ has: page.getByText(new RegExp(`^${escapedTarget}`)) })
        .filter({
          has: page.getByRole('button', { name: /builder_common_options|^Options$/i }),
        })
        .last();

      // Retry loop: the domain-add API in test environments is intermittently
      // slow or silently fails. Rather than a single 300s blind wait (which
      // lets auth expire), use a shorter timeout per attempt with re-auth
      // between retries.
      for (let attempt = 1; attempt <= MAX_DOMAIN_ATTEMPTS; attempt++) {
        await dismissOverlays(page);
        await ensureAuthenticated(page);

        // Open the publish popover to access "Connect a Custom Domain".
        await expect(publishButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
        await publishButton.click();

        const connectCustomDomainButton = page.getByRole('button', {
          name: /Connect a Custom Domain|builder_common_custom_domain_button/i,
        });

        // If the "Connect a Custom Domain" button isn't visible, the domain
        // may already be connected from a previous attempt (the button only
        // renders when on an Airo subdomain with no active custom domain).
        // Navigate to the domain settings panel to confirm.
        const connectButtonVisible = await connectCustomDomainButton
          .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
          .then(() => true)
          .catch(() => false);

        if (!connectButtonVisible) {
          // Close the popover and navigate to domain settings via URL
          await page.keyboard.press('Escape');
          const currentUrl = new URL(page.url());
          currentUrl.searchParams.set('tab', 'settings');
          currentUrl.searchParams.set('settings', 'domain');
          await page.goto(currentUrl.toString(), { waitUntil: 'load' });

          // Give the domain panel time to hydrate and render the row
          const rowVisible = await domainRowContainer
            .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
            .then(() => true)
            .catch(() => false);

          if (rowVisible) {
            console.log(`  Domain already connected from prior attempt (attempt ${attempt})`);
            break;
          }
          throw new Error(
            `Attempt ${attempt}: "Connect a Custom Domain" button not visible and domain row not found on settings panel. Page URL: ${page.url()}`,
          );
        }

        await connectCustomDomainButton.click();

        await expect(
          page.getByRole('heading', { name: /^Custom Domain$/i }),
        ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

        // After navigating to the domain panel, give it a moment to hydrate
        // in case a previous attempt's API call completed late.
        if (attempt > 1) {
          const alreadyVisible = await domainRowContainer
            .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT / 3 })
            .then(() => true)
            .catch(() => false);
          if (alreadyVisible) {
            console.log(`  Domain row appeared between retries (attempt ${attempt})`);
            break;
          }
        }

        // Fill the domain input and submit. The entire sequence is soft-failed
        // because a product-level race (useDomainPolling stops polling before
        // the domain record appears in mgmt-airo) can cause the form to
        // disappear mid-interaction if a prior attempt's API call lands late.
        const customDomainInput = page.locator('#custom-domain-slug');
        const inputReady = await customDomainInput
          .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
          .then(() => expect(customDomainInput).toBeEnabled())
          .then(() => true)
          .catch(() => false);

        if (!inputReady) {
          const rowLateVisible = await domainRowContainer
            .waitFor({ state: 'visible', timeout: SHORT_TIMEOUT })
            .then(() => true)
            .catch(() => false);
          if (rowLateVisible) {
            console.log(`  Domain form gone, row visible — already connected (attempt ${attempt})`);
            break;
          }
          if (attempt < MAX_DOMAIN_ATTEMPTS) {
            console.log(`  Domain input not ready (attempt ${attempt}/${MAX_DOMAIN_ATTEMPTS}), retrying...`);
            continue;
          }
          throw new Error(
            `Attempt ${attempt}: Domain input never appeared and domain row not found. Page URL: ${page.url()}`,
          );
        }

        await customDomainInput.fill(TARGET_DOMAIN);

        const addButton = page.locator('[data-eid*="settings.domains.add_domain"]');
        const addReady = await addButton
          .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
          .then(() => expect(addButton).toBeEnabled({ timeout: LONG_TIMEOUT }))
          .then(() => true)
          .catch(() => false);

        if (!addReady) {
          const rowLateVisible = await domainRowContainer
            .waitFor({ state: 'visible', timeout: SHORT_TIMEOUT })
            .then(() => true)
            .catch(() => false);
          if (rowLateVisible) {
            console.log(`  Domain row appeared while waiting for Add button (attempt ${attempt})`);
            break;
          }
          if (attempt < MAX_DOMAIN_ATTEMPTS) {
            console.log(`  Add button never ready (attempt ${attempt}/${MAX_DOMAIN_ATTEMPTS}), retrying...`);
            continue;
          }
          throw new Error(
            `Attempt ${attempt}: Add button never ready and domain row not found. Page URL: ${page.url()}`,
          );
        }

        await addButton.click();

        await expect(
          page.getByText(/builder_custom_domain_modal_title|Are you sure/i),
        ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

        const continueButton = page.locator(
          '[data-eid*="settings.domains.connect_continue"]',
        );
        await expect(continueButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
        await expect(continueButton).toBeEnabled();
        await continueButton.click();

        await expect(
          page.getByText(/builder_custom_domain_modal_title|Are you sure/i),
        ).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });

        const appeared = await domainRowContainer
          .waitFor({ state: 'visible', timeout: LONG_TIMEOUT })
          .then(() => true)
          .catch(() => false);

        if (appeared) break;

        if (attempt < MAX_DOMAIN_ATTEMPTS) {
          console.log(`  Domain row did not appear (attempt ${attempt}/${MAX_DOMAIN_ATTEMPTS}), retrying...`);
        } else {
          throw new Error(
            `Domain row not visible after ${MAX_DOMAIN_ATTEMPTS} attempts (${LONG_TIMEOUT}ms each). Page URL: ${page.url()}`,
          );
        }
      }

      // DNS instructions panel renders when the domain is external. Anchor
      // on the i18n key (untranslated) or the English fallback.
      const dnsRegion = page
        .locator('div')
        .filter({
          has: page.getByText(/builder_domain_dns_instructions|To finish connecting/i),
        })
        .first();
      await expect(dnsRegion).toBeVisible({ timeout: LONG_TIMEOUT });

      // Assert the A record renders — `getDnsRecords` in @/utils/domain
      // always returns an aRecord regardless of root-vs-subdomain or DCV
      // flag state, so this is the only DNS card guaranteed to be present
      // across environments. CNAME presence varies:
      //   - root domain → always a www CNAME (cnameRecord)
      //   - subdomain   → no www CNAME; DCV CNAME only if appbuilder-domain-dcv
      //                   is on AND the backend populated certificateValidationCname
      // The row + DNS-panel scoping above already proves the panel belongs
      // to TARGET_DOMAIN; asserting fqdn text inside the panel also doesn't
      // work for subdomains since `getDnsRecords` only puts the subdomain
      // segment (e.g. `e2e`) in the A-record name, not the full fqdn.
      await expect(dnsRegion.getByText(/^A$/, { exact: true }).first())
        .toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  Custom domain attached and DNS records visible');

      // Scope the options button to THIS row so we don't hit the auto-prefix
      // domain or any other available-customer-domain rows.
      const optionsButton = domainRowContainer.getByRole('button', {
        name: /builder_common_options|^Options$/i,
      });
      await expect(optionsButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await optionsButton.click();

      // Note hyphen variant ("settings-domains") — distinct from the dotted
      // "settings.domains.*" used by Add/Continue.
      const disconnectButton = page.locator(
        '[data-eid*="settings-domains.custom_domain.disconnect"]',
      );
      await expect(disconnectButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await expect(disconnectButton).toBeEnabled();
      // Disconnect opens the SEO warning modal (`DomainDisconnectConfirmationModal`);
      // the row is removed only after the user confirms (`executeDisconnectDomain`).
      await disconnectButton.click();

      const disconnectConfirmButton = page.locator(
        '[data-eid*="domain.disconnect.confirm"]',
      );
      await expect(disconnectConfirmButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await expect(disconnectConfirmButton).toBeEnabled();
      await disconnectConfirmButton.click();

      // `not.toBeAttached()` (vs `not.toBeVisible()`) verifies the row was
      // unmounted from the DOM, not just CSS-hidden — catches a regression
      // that would hide-but-keep the row in DOM.
      await expect(domainRowContainer).not.toBeAttached({ timeout: LONG_TIMEOUT });
      await expect(page.locator('#custom-domain-slug')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  Custom domain disconnected and input restored');
    });

    await test.step('Step 12: Page refresh recovery', async () => {
      await page.reload();

      // The SSO Deck iframe keeps VAT (info_idp_vat_time) fresh via heartbeat;
      // on reload, an in-flight heartbeat can be cancelled and VAT can briefly
      // tip past the server's 5-minute window. gasket-auth's /api/auth/validate
      // then returns 401 (authReason=3, VAT) and gasket-auth redirects the top
      // window to sso.<env>-godaddy.com/login?path=%2Fdevelop%2F<id>. The
      // session is still valid; the next heartbeat refreshes VAT. Handle the
      // bounce instead of failing the refresh step.
      await ensureAuthenticated(page);

      // Step 11 (custom domain) leaves the page on `?tab=settings`. The
      // toHaveURL check below requires the path to NOT contain query params
      // (anchored on [^?#]*), and the chat-input / preview-iframe visibility
      // checks below also depend on the develop tab being active, not the
      // settings panel. Normalize the URL before asserting.
      const currentUrl = new URL(page.url());
      if (currentUrl.searchParams.get('tab') === 'settings') {
        await page.goto(`${currentUrl.origin}${currentUrl.pathname}`, { waitUntil: 'load' });
      }

      // After ensureAuthenticated returns we should be back on the develop
      // page; guard against landing on the root or any other post-SSO target
      // by anchoring to /develop/ in the path (stop at ? or #) and rejecting
      // an sso.* host.
      await expect(page).toHaveURL(/^(?!https:\/\/sso\.)[^?#]*\/develop\//);
      await expect(airoHeader).toBeVisible();
      await chatInput.waitFor({ state: 'visible', timeout: CHAT_INPUT_TIMEOUT });
      await expect(chatInput).not.toBeDisabled({ timeout: CHAT_INPUT_TIMEOUT });
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
