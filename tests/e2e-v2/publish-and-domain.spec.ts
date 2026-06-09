/**
 * Publish + custom domain — auto-publish verification, custom-domain
 * attach/disconnect, and page-reload recovery (Step 12 lives here so the
 * `?tab=settings` URL-normalization branch fires after the custom-domain
 * test leaves the page on `?tab=settings`).
 *
 * Coverage: legacy monolith Steps 3 (auto-publish verification half),
 * 11 (custom domain), 12 (page reload).
 *
 * Concurrency: serial within file. All three tests mutate state in
 * sequence, and Step 12's coverage of the `?tab=settings` normalization
 * branch depends on Step 11 having already navigated there. The shared
 * app is created in `beforeAll`; if `autoPublishSupported`, the
 * `beforeAll` also waits for the prompt-driven auto-publish to finish so
 * the auto-publish test below has something to verify.
 */
import { test, expect } from '@playwright/test';

import { deleteApp, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { detectSsoType, ensureAuthenticated, handleSsoLogin, isSignInUIResult, loginIfNeeded } from '../helpers/auth';
import {
  CHAT_INPUT_TIMEOUT,
  DEFAULT_TIMEOUT,
  DEPLOYMENT_TIMEOUT_MS,
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
  waitForDevelopPage,
} from '../helpers/ui';

const SPEC_NAME = 'publish-domain';

const { env } = getEnvConfig();
// Auto-publish via AI prompt requires the full AI publish tooling available
// on test/prod. The local dev shell doesn't expose a real deployment
// pipeline, so the "publish this app" instruction in the creation prompt
// has no effect there.
const autoPublishSupported = env !== 'local';

test.describe.configure({ mode: 'serial' });

test.describe('E2E v2 - Publish and custom domain', () => {
  let appId: string;

  test.beforeAll(async ({ browser }) => {
    // playwright.config.ts sets a global `timeout: 420000` (7 min) that
    // caps both tests AND hooks. The auto-publish wait below is bounded
    // by PUBLISH_TIMEOUT_MS (10 min), so without raising the hook budget
    // the wait truncates at 7 min and the hook fails before publish has
    // a real chance to land. Match the 15-min budget the legacy monolith
    // gave this flow.
    test.setTimeout(900_000);

    // No storageState — the e2e-v2 project does live SSO at every entry
    // point because storageState-cached cookies were rejected by gd-auth
    // on /develop/<id> navigations (see playwright.config.ts notes).
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto('/');
      await dismissOverlays(page);
      await loginIfNeeded(page);
      await evictOldestE2eAppsToFitLimit(page).catch(() => {});

      // App creation: use homepage submit (not API quick-create). The AI
      // auto-publish skill is only reliably triggered on apps created via
      // the homepage UI — `createSiteViaApi` + a "publish this app" prompt
      // doesn't reliably fire the publish skill, so the auto-publish wait
      // below times out. Legacy e2e.spec.ts (which passes) creates apps
      // this way; mirror it. Costs ~30–60 s of homepage submit; saves the
      // 10-min auto-publish timeout otherwise hit on slow days.
      const promptInput = page.getByTestId('homepage-prompt-input');
      await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
      await dismissOverlays(page);
      await promptInput.fill(
        `${getSpecPrefix(SPEC_NAME)} Simple landing page - do not ask follow up questions and publish this app`,
      );

      // Hydration wait — see create-flow.spec.ts for why 10 s fixed beats
      // networkidle here.
      const submitButton = page.locator('[data-eid*="homepage.prompt.submit"]');
      await expect(submitButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
      await page.waitForTimeout(10_000);
      await submitButton.click();

      // Already authed (loginIfNeeded above), so SSO should be a no-op,
      // but defend against env-specific session refreshes.
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
      console.log(`  publish-and-domain shared app: ${appId}`);

      if (autoPublishSupported) {
        // We're already on /develop/<id> after the homepage submit, so the
        // legacy navigation step is unnecessary here.
        await expectPublishSuccessVisible(page, PUBLISH_TIMEOUT_MS);
        console.log(`  Auto-publish completed for ${appId}`);
      } else {
        console.log('  Auto-publish skipped (local env — no deployment pipeline)');
      }
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

  test('Auto-publish completed successfully', async ({ page }, testInfo) => {
    testInfo.setTimeout(60_000);

    if (!autoPublishSupported) {
      console.log('Auto-publish skipped (local env)');
      return;
    }

    await dismissOverlays(page);
    await ensureAuthenticated(page);

    // Guard: ensure we are still on the develop page. If a session/network
    // hiccup redirected away, this fails fast with a clear URL mismatch.
    await expect(page).toHaveURL(/\/develop\//, { timeout: DEFAULT_TIMEOUT });

    // The beforeAll already waited for the publish-success indicator (modal
    // / popover alert / growl) in its own context. Those indicators are all
    // ephemeral, event-driven UI from `useDevelopPageStore.publishStates` —
    // they fire ONCE in the context where the publish happened and never
    // re-trigger on a fresh page load. So this test's fresh context can't
    // re-observe them; instead, verify the persistent server-side outcome:
    // the chat-transcript renders the publish tool result with a
    // "Published commit <sha>" line (PublishClientToolRenderer.tsx). That
    // tool message is part of the persisted conversation, so any later
    // context loading the develop page sees it.
    const transcript = page.getByTestId('chat-transcript');
    await expect(
      transcript.getByText(/Published commit [a-f0-9]+/i).first(),
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  });

  test('Custom domain attach + disconnect (e2e.airotesting.shop)', async ({ page }, testInfo) => {
    testInfo.setTimeout(DEPLOYMENT_TIMEOUT_MS + 120_000);

    const TARGET_DOMAIN = 'e2e.airotesting.shop';

    await dismissOverlays(page);
    await ensureAuthenticated(page);

    const airoHeader = page.getByTestId('airo-header');
    const publishButton = airoHeader.getByRole('button', { name: /publish/i });

    // Open the Domain settings panel via the desktop user-flow path:
    // header Publish button -> "Connect a Custom Domain" button in the
    // resulting popover. The button calls `handleViewDomain` in
    // `app/src/components/layout/AppPublish.tsx`, which sets
    // `activeChatTab=SETTINGS` + `activeSettingsSection=DOMAIN`. The
    // button only renders when the app is on an Airo subdomain AND has
    // published at least once — both true here after the beforeAll
    // auto-publish wait.
    await expect(publishButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await publishButton.click();

    // Translation key first as a safety net in case the rendered string
    // changes; English copy second as the runtime label.
    const connectCustomDomainButton = page.getByRole('button', {
      name: /Connect a Custom Domain|builder_common_custom_domain_button/i,
    });
    await expect(connectCustomDomainButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await connectCustomDomainButton.click();

    // Use the heading role (renders as `text.h3` in SettingsSection.tsx)
    // with an anchored regex. A bare `getByText(/Custom Domain/i).first()`
    // would also match a hidden chat-suggestion `<p>` that contains the
    // phrase, which is never visible — timing out the assertion.
    await expect(
      page.getByRole('heading', { name: /^Custom Domain$/i }),
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const customDomainInput = page.locator('#custom-domain-slug');
    await expect(customDomainInput).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(customDomainInput).toBeEnabled();
    await customDomainInput.fill(TARGET_DOMAIN);

    // Add stays disabled until the 500ms input debounce elapses AND the
    // validation API returns available=true. Asserting toBeEnabled (not
    // just toBeVisible) before clicking is the #1 defense against flake
    // here — clicking a still-disabled button silently no-ops.
    const addButton = page.locator('[data-eid*="settings.domains.add_domain"]');
    await expect(addButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(addButton).toBeEnabled({ timeout: LONG_TIMEOUT });
    await addButton.click();

    await expect(
      page.getByText(/builder_custom_domain_modal_title|Are you sure/i),
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const continueButton = page.locator('[data-eid*="settings.domains.connect_continue"]');
    await expect(continueButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    // Wait for the modal close transition before probing the next state,
    // otherwise the row-appears assertion can race the modal teardown.
    await expect(
      page.getByText(/builder_custom_domain_modal_title|Are you sure/i),
    ).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // Scope the row locator: filter divs to those containing BOTH the
    // domain text AND the row's Options button. A bare getByText(TARGET_DOMAIN)
    // is ambiguous once DNS records render. The DNS card has no Options
    // button, so the dual filter uniquely picks the row Card.
    // TARGET_DOMAIN is escaped before being interpolated into the regex
    // so the `.` chars in `e2e.airotesting.shop` are matched literally,
    // not as the regex "any char" metachar.
    const escapedTarget = TARGET_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const domainRowContainer = page
      .locator('div')
      .filter({ has: page.getByText(new RegExp(`^${escapedTarget}`)) })
      .filter({
        has: page.getByRole('button', { name: /builder_common_options|^Options$/i }),
      })
      .last();
    await expect(domainRowContainer).toBeVisible({ timeout: DEPLOYMENT_TIMEOUT_MS });

    // DNS instructions panel renders when the domain is external. Anchor
    // on the i18n key (untranslated) or the English fallback.
    const dnsRegion = page
      .locator('div')
      .filter({
        has: page.getByText(/builder_domain_dns_instructions|To finish connecting/i),
      })
      .first();
    await expect(dnsRegion).toBeVisible({ timeout: DEPLOYMENT_TIMEOUT_MS });

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
    await expect(dnsRegion.getByText(/^A$/, { exact: true }).first()).toBeVisible({
      timeout: DEFAULT_TIMEOUT,
    });

    // Scope the options button to THIS row so we don't hit the auto-prefix
    // domain or any other available-customer-domain rows.
    const optionsButton = domainRowContainer.getByRole('button', {
      name: /builder_common_options|^Options$/i,
    });
    await expect(optionsButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await optionsButton.click();

    // Note hyphen variant ("settings-domains") — distinct from the dotted
    // "settings.domains.*" used by Add/Continue.
    const disconnectButton = page.locator('[data-eid*="settings-domains.custom_domain.disconnect"]');
    await expect(disconnectButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(disconnectButton).toBeEnabled();
    // Disconnect opens the SEO warning modal (`DomainDisconnectConfirmationModal`);
    // the row is removed only after the user confirms (`executeDisconnectDomain`).
    await disconnectButton.click();

    // data-eid is `domain.disconnect.confirm` (no `buttons.` segment) —
    // see `DomainDisconnectConfirmationModal.tsx:93`. The test previously
    // had `domain.disconnect.buttons.confirm` which never matched the
    // current modal markup.
    const disconnectConfirmButton = page.locator('[data-eid*="domain.disconnect.confirm"]');
    await expect(disconnectConfirmButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(disconnectConfirmButton).toBeEnabled();
    await disconnectConfirmButton.click();

    // `not.toBeAttached()` (vs `not.toBeVisible()`) verifies the row was
    // unmounted from the DOM, not just CSS-hidden — catches a regression
    // that would hide-but-keep the row in DOM.
    await expect(domainRowContainer).not.toBeAttached({ timeout: DEPLOYMENT_TIMEOUT_MS });
    await expect(customDomainInput).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // NOTE: this test deliberately leaves the page on `?tab=settings` so
    // the next test exercises the URL-normalization branch in develop's
    // post-reload recovery path. Do NOT navigate away here.
  });

  test('Page reload recovers state (handles ?tab=settings normalization)', async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);

    // The previous test ran in its own browser context; this test's
    // beforeEach navigated to /develop/<id> (no ?tab=settings). To exercise
    // the URL-normalization branch, explicitly navigate to ?tab=settings
    // before the reload — that's what the prior test left in flight.
    //
    // NOTE: do NOT call `waitForDevelopPage(page)` here. That helper waits
    // for `chat-input-textarea` to be visible, but the settings tab
    // deliberately hides the chat pane (chat-input remains in the DOM but
    // collapsed). Wait for the settings panel itself instead so we know the
    // page rendered before the reload below.
    await page.goto(`/develop/${appId}?tab=settings`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('airo-header').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });

    await page.reload();

    // The SSO Deck iframe keeps VAT (info_idp_vat_time) fresh via heartbeat;
    // on reload, an in-flight heartbeat can be cancelled and VAT can briefly
    // tip past the server's 5-minute window. gasket-auth's /api/auth/validate
    // then returns 401 (authReason=3, VAT) and gasket-auth redirects the top
    // window to sso.<env>-godaddy.com/login?path=%2Fdevelop%2F<id>. The
    // session is still valid; the next heartbeat refreshes VAT. Handle the
    // bounce instead of failing the refresh step.
    await ensureAuthenticated(page);

    // ?tab=settings is preserved across reload. The toHaveURL check below
    // requires the path to NOT contain query params (anchored on [^?#]*),
    // and the chat-input / preview-iframe visibility checks below also
    // depend on the develop tab being active, not the settings panel.
    // Normalize the URL before asserting.
    const currentUrl = new URL(page.url());
    if (currentUrl.searchParams.get('tab') === 'settings') {
      await page.goto(`${currentUrl.origin}${currentUrl.pathname}`, { waitUntil: 'load' });
    }

    // After ensureAuthenticated returns we should be back on the develop
    // page; guard against landing on the root or any other post-SSO target
    // by anchoring to /develop/ in the path (stop at ? or #) and rejecting
    // an sso.* host.
    await expect(page).toHaveURL(/^(?!https:\/\/sso\.)[^?#]*\/develop\//);

    const airoHeader = page.getByTestId('airo-header');
    const chatInput = page.getByTestId('chat-input-textarea');

    await expect(airoHeader).toBeVisible();
    await chatInput.waitFor({ state: 'visible', timeout: CHAT_INPUT_TIMEOUT });
    await expect(chatInput).not.toBeDisabled({ timeout: CHAT_INPUT_TIMEOUT });
    await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });
  });
});
