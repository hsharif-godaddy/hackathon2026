/**
 * Publish + custom domain — default `*.ai` publish verification,
 * custom-domain attach/disconnect, and page-reload `?tab=settings`
 * URL-normalization recovery.
 *
 * Coverage: legacy monolith Steps 3 (publish verification half), 11 (custom
 * domain), 12 (page reload). The page-reload test self-navigates to
 * `?tab=settings`, so it doesn't depend on the custom-domain test's end
 * state.
 *
 * Concurrency: serial within file — all three run against the shared
 * pre-published `[e2e-pool:publish-domain]` pool app (looked up in
 * `beforeAll`, seeded by the `bootstrap-pool` project), and the
 * custom-domain test mutates state (attach → disconnect). That test restores
 * pool state by disconnecting what it attaches and pre-cleans any leftover
 * from a prior interrupted run.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';

import { getPublishedUrl } from '../helpers/api';
import { ensureAuthenticated, loginViaSsoDirect } from '../helpers/auth';
import {
  CHAT_INPUT_TIMEOUT,
  DEFAULT_TIMEOUT,
  DEPLOYMENT_TIMEOUT_MS,
  LONG_TIMEOUT,
  PREVIEW_TIMEOUT,
  getEnvConfig,
} from '../helpers/constants';
import { getCachedPoolAppId } from '../helpers/pool-cache';
import {
  dismissOverlays,
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
// Attaching an EXTERNAL custom domain only completes end-to-end on prod. On
// test the domain pipeline doesn't actually connect: it requires a real
// prod-registered domain, only surfaces manual-DNS instructions, and leftover
// domains linger in a "being deleted" state that blocks re-adds — so a full
// attach → DNS → disconnect can never be reliably green there. Non-prod
// validates that the custom-domain affordance RENDERS and stops.
const customDomainAttachSupported = env === 'prod';

/**
 * Disconnect a custom domain from the currently-open Domain settings panel
 * if a row for it exists; no-op otherwise. Used to pre-clean the long-lived
 * pool app at the start of the custom-domain test — a prior run that failed
 * after attaching but before disconnecting would otherwise leave the domain
 * attached and break this run's attach step.
 *
 * Caller must have the Domain settings panel already open. `escapedTarget`
 * is the regex-escaped domain (so `.` matches literally).
 */
async function disconnectDomainIfPresent(page: Page, escapedTarget: string): Promise<void> {
  const existingRow = page
    .locator('div')
    .filter({ has: page.getByText(new RegExp(`^${escapedTarget}`)) })
    .filter({ has: page.getByRole('button', { name: /builder_common_options|^Options$/i }) })
    .last();

  // Short probe — the panel is already open, so a real leftover row is
  // visible immediately; absence is the common (clean-pool) case.
  const present = await existingRow.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!present) return;

  console.log(`  Pre-cleanup: disconnecting leftover domain from pool app`);
  await existingRow.getByRole('button', { name: /builder_common_options|^Options$/i }).click();
  await page.locator('[data-eid*="settings-domains.custom_domain.disconnect"]').click();
  const confirm = page.locator('[data-eid*="domain.disconnect.confirm"]');
  await expect(confirm).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  await confirm.click();
  await expect(existingRow).not.toBeAttached({ timeout: DEPLOYMENT_TIMEOUT_MS });
}

test.describe.configure({ mode: 'serial' });

test.describe('E2E v2 - Publish and custom domain', () => {
  let appId: string;

  test.beforeAll(() => {
    // Pool app: this spec used to create a fresh app and wait the full
    // auto-publish cycle (~5–7 min) in beforeAll — the single biggest
    // wall-clock cost in the whole e2e-v2 suite. The [e2e-pool:publish-domain]
    // app is pre-built AND pre-published by the `bootstrap-pool` project.
    //
    // The id is resolved ONCE by the `pool-resolve` setup project (an e2e-v2
    // `dependencies` entry) and read here from the on-disk cache — no network,
    // no login. This is what eliminates the workers=4 concurrent
    // `GET /api/sites` burst that 504'd against the test env.
    // getCachedPoolAppId throws a clear hint if the cache is missing (i.e.
    // pool-resolve didn't run, or bootstrap-pool never seeded the app).
    //
    // Coverage note: the "published to its default *.ai domain" test still
    // verifies live published state via getPublishedUrl (a single, retry-
    // protected /api/sites read at test time — not a concurrent beforeAll
    // burst). The full AI-prompt-driven auto-publish-on-create flow is still
    // exercised by the bootstrap project when it seeds the pool, and by
    // legacy e2e.spec.ts.
    appId = getCachedPoolAppId(env, 'publish-domain');
    console.log(`  publish-and-domain pool app (cached): ${appId}`);
  });

  // No afterAll cleanup — pool apps are long-lived and reused across runs
  // ([e2e-pool:*] prefix is skipped by the eviction guard). The custom-domain
  // test (below) restores pool state by disconnecting what it attaches, and
  // also pre-cleans any leftover domain at its start so a mid-test failure on
  // a prior run can't poison the next.

  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
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

  test('App is published to its default *.ai domain', { tag: ['@thorough', '@publish'] }, async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000);

    if (!autoPublishSupported) {
      console.log('Publish-state check skipped (local env — no deployment pipeline)');
      return;
    }

    await ensureAuthenticated(page);

    // Verify the pool app is PUBLISHED TO ITS DEFAULT *.ai DOMAIN via the
    // server-derived `published_url` from GET /api/sites — NOT via UI:
    //
    // - Ephemeral publish-success indicators (modal / growl) fire once in the
    //   publishing context and never re-trigger on a fresh load.
    // - The chat-transcript "Published commit <sha>" line is AI-narration-
    //   dependent (a fail-then-retry publish narrates differently).
    // - The develop-page publish popover's FQDN input is gated by the
    //   `appbuilder-publish-button` switchboard flag + async `site` load, so
    //   it's unreliable to assert against.
    //
    // `published_url` is set by the control-plane adapter once the app is
    // published; with no custom domain attached it's the default Airo *.ai
    // URL (v2-control-plane-adapter.ts). Asserting it ends with the env's
    // Airo apex (`airoapp.ai` on prod, `test-airoapp.ai` on test) directly
    // and deterministically verifies default-domain publish.
    const publishedUrl = await getPublishedUrl(page, appId);
    expect(publishedUrl, `pool app ${appId} should have a published_url (i.e. be published)`).toBeTruthy();

    const expectedAiroDomain = env === 'prod' ? 'airoapp.ai' : 'test-airoapp.ai';
    // Leading `\.` makes the apex a domain boundary, so the prod check
    // (`\.airoapp\.ai`) does NOT match a `*.test-airoapp.ai` URL (preceded
    // by `-`, not `.`). Trailing `(/|$)` allows an optional path.
    const airoDomainPattern = new RegExp(`\\.${expectedAiroDomain.replace(/\./g, '\\.')}(/|$)`);
    expect(publishedUrl).toMatch(airoDomainPattern);
  });

  test('Custom domain attach + disconnect (e2e.airotesting.shop)', { tag: ['@thorough', '@publish'] }, async ({ page }, testInfo) => {
    testInfo.setTimeout(DEPLOYMENT_TIMEOUT_MS + 120_000);

    const TARGET_DOMAIN = 'e2e.airotesting.shop';
    // Escaped once here and reused for the pre-cleanup probe and the row
    // locator below, so the `.` chars match literally, not as regex "any".
    const escapedTarget = TARGET_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    await dismissOverlays(page);
    await ensureAuthenticated(page);

    const airoHeader = page.getByTestId('airo-header');

    // Open the Domain settings panel via the header "Domain" view-mode button
    // (ViewMode.DOMAIN, gated by `appbuilder-domain-top-level`; Header.tsx).
    // This renders the SAME DomainPanel → DomainAttach (with `#custom-domain-slug`)
    // that the publish-popover "Connect a Custom Domain" entry reaches.
    //
    // We deliberately do NOT use the publish-popover path here: that popover's
    // domain affordances ("Connect a Custom Domain" / the FQDN input) depend on
    // the publish query (`appbuilder-publish-button` flag + async `site` load)
    // and rendered unreliably for the pooled app. The header Domain button is a
    // direct, stable entry point. Domain coverage is unchanged — same panel.
    const domainViewButton = airoHeader.getByTestId('develop-view-domain');
    await expect(domainViewButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await domainViewButton.click();

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

    // On non-prod the attach can't complete (see customDomainAttachSupported).
    // We've now verified the custom-domain affordance renders (heading + an
    // enabled slug input) — that's the meaningful, reliable coverage off-prod.
    // Stop before the live attach rather than drive one that never lands.
    if (!customDomainAttachSupported) {
      console.log(
        `Custom-domain attach/disconnect skipped (env=${env}); validated the Custom Domain UI renders`,
      );
      return;
    }

    // Idempotency against the long-lived pool app: clear any leftover
    // attachment from a prior run that failed mid-test before attaching.
    await disconnectDomainIfPresent(page, escapedTarget);
    await expect(customDomainInput).toBeVisible({ timeout: DEFAULT_TIMEOUT });

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
    // `escapedTarget` (defined at the top of this test) escapes the `.`
    // chars in `e2e.airotesting.shop` so they match literally in the regex,
    // not as the "any char" metachar.
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
  });

  test('Page reload recovers state (handles ?tab=settings normalization)', { tag: ['@thorough', '@publish'] }, async ({ page }, testInfo) => {
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
