/**
 * Publish Flow E2E Tests
 *
 * Tests automatic publishing via AI agent:
 * 1. Creates an app with prompt to publish
 * 2. Waits for AI agent to auto-publish
 * 3. Verifies success via publish button state and first-publish congrats modal or
 *    success Growl (first publish suppresses the growl in favor of the modal)
 *
 * Second test: after publish, publish popover → Pre-Launch Check → SEO prompt in chat
 * (injected `askQuestion` in chat; `data-testid` on option buttons, e.g. post-publish-prelaunch-seo-run-button).
 *
 * Strategy:
 * - AI agent handles publishing automatically
 * - No manual publish clicks needed
 */
import { test, expect } from '../helpers/test-fixtures';

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit, waitForPublishedUrl } from '../helpers/api';
import { detectSsoType, ensureAuthenticated, handleSsoLogin, isSignInUIResult, loginViaSsoDirect } from '../helpers/auth';
import {
  AI_RESPONSE_TIMEOUT_MS,
  DEFAULT_TIMEOUT,
  DEPLOYMENT_TIMEOUT_MS,
  E2E_NO_DELETE,
  LONG_TIMEOUT,
  PUBLISH_TIMEOUT_MS,
  getSpecPrefix,
} from '../helpers/constants';
import {
  approveAgentPublish,
  dismissOverlays,
  logTestResult,
  logTestStart,
  waitForChatInput,
  waitForDevelopPage,
} from '../helpers/ui';

/** Spec prefixes used by `getSpecPrefix(...)` calls in this describe block. */
const SPEC_PREFIXES = ['publish', 'publish-seo', 'publish-dns-conflict'] as const;

test.describe('Publish Flow', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    // Authenticate once here via the fast standalone-SSO login (e2e-v2 style);
    // the per-test in-body login becomes a conditional re-auth guard.
    await loginViaSsoDirect(page);
    if (!E2E_NO_DELETE) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch(() => {});
    }
  });

  // Re-enabled (VNEXT-80876). Previously skipped because expectPublishSuccessVisible()
  // waited on the EPHEMERAL publish-success UI (#first-publish-congrats-modal /
  // publish-success-alert / #app-publish-success) — those fire once and are
  // easily missed, so it hit the 420s timeout on run 25678309245. The success
  // gate is now the server-side `published_url` (waitForPublishedUrl), the
  // deterministic "publish actually landed" signal proven by the publish-domain
  // pool work.
  test('AI Auto-Publish - Create App, Deploy & Verify Live Status', async ({ page }, testInfo) => {
    testInfo.setTimeout(2 * AI_RESPONSE_TIMEOUT_MS + PUBLISH_TIMEOUT_MS);
    // ========================================
    // STEP 1: Create app with publish instruction
    // ========================================
    console.log('📱 Step 1: Creating app with publish instruction...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('publish')} Single page hello world app - do not ask follow up questions and publish this app`);

    await dismissOverlays(page);
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    // Already authenticated in beforeEach; only drive SSO if it reappeared.
    const ssoResult = await detectSsoType(page, true);
    if (isSignInUIResult(ssoResult)) {
      await handleSsoLogin(page);
    }

    // Wait for app creation and redirect to develop
    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
    console.log(`✅ App created: ${appId}`);

    // ========================================
    // STEP 2: Wait for AI to complete and publish
    // ========================================
    console.log('🤖 Step 2: Waiting for AI agent to publish...');

    // Wait for chat input to be available (AI finished processing)
    await waitForChatInput(page);
    console.log('  ✓ AI processing complete');

    // Session may have expired during AI generation + publish
    await ensureAuthenticated(page);

    // The agent publish pauses on the confirmation modal; approve it so the publish
    // work starts (otherwise it hangs until the confirmation times out as cancelled).
    await approveAgentPublish(page, PUBLISH_TIMEOUT_MS);
    console.log('  ✓ Approved agent publish confirmation');

    // ========================================
    // STEP 3: Verify publish success
    // ========================================
    console.log('✅ Step 3: Verifying publish success...');

    // Verify publish button is enabled and interactive after deploy
    const publishButton = page
      .getByTestId('airo-header')
      .getByRole('button', { name: /publish/i });
    await expect(publishButton).not.toBeDisabled({ timeout: DEPLOYMENT_TIMEOUT_MS });
    console.log('  ✓ Publish button enabled');

    // Success = the server records a `published_url`. The ephemeral
    // congrats-modal / growl is unreliable to catch (fires once); published_url
    // is the deterministic "publish actually landed" signal.
    const publishedUrl = await waitForPublishedUrl(page, appId, { timeoutMs: PUBLISH_TIMEOUT_MS });
    console.log(`  ✓ Publish landed: ${publishedUrl}`);

    // ========================================
    // STEP 4: Verify SSR HTML at the published URL
    // ========================================
    console.log('🌐 Step 4: Verifying SSR HTML at published URL...');
    let resp;
    try {
      resp = await page.request.get(publishedUrl, {
        headers: { 'User-Agent': 'SmokeSsrValidator/1.0', 'Accept': 'text/html' },
      });
    } catch (err) {
      console.log(`  ⚠ Published URL not reachable from runner - skipping SSR assertion (${err instanceof Error ? err.message : String(err)})`);
      resp = null;
    }

    if (resp) {
      expect(resp.status()).toBe(200);
      const html = await resp.text();
      const bytes = html.length;
      const hasAppRoot = html.includes('<div id="app"');
      const ssrTags = ['<header', '<main', '<section', '<footer'].filter((t) => html.includes(t));

      console.log(`  SSR response: ${bytes} bytes, app root: ${hasAppRoot}, server tags: ${ssrTags.join(',') || 'none'}`);

      expect(hasAppRoot).toBe(true);
      expect(bytes).toBeGreaterThan(500);
      expect(ssrTags.length).toBeGreaterThan(0);
      console.log('  ✓ SSR HTML contains server-rendered markup');
    }

    console.log('🎉 Publish flow test passed!');
  });

  // Re-enabled (VNEXT-80876). Previously skipped alongside Test 1 — same
  // ephemeral-modal timeout root cause. Success gate replaced with
  // waitForPublishedUrl (server-side published_url poll). The inner
  // test.skip() guard for the pre-launch feature flag is kept so the test
  // is self-documenting when the flag is off in an environment.
  test('Publish popover — Pre-Launch Check opens SEO prompt and sends SEO action', async ({ page }, testInfo) => {
    // Extra 300 s beyond PUBLISH_TIMEOUT_MS: the second publish in the same CI
    // run consistently takes longer than 600 s on prod (infrastructure queueing
    // / CDN propagation after Test 1's deploy). waitForPublishedUrl timeout is
    // widened to match.
    testInfo.setTimeout(2 * AI_RESPONSE_TIMEOUT_MS + PUBLISH_TIMEOUT_MS + 300_000);

    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    console.log('📱 Step 1: Creating app with publish instruction...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(
      `${getSpecPrefix('publish-seo')} Single page hello world app - do not ask follow up questions and publish this app`,
    );

    await dismissOverlays(page);
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    // Already authenticated in beforeEach; only drive SSO if it reappeared.
    const ssoResult = await detectSsoType(page, true);
    if (isSignInUIResult(ssoResult)) {
      await handleSsoLogin(page);
    }

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
    console.log(`✅ App created: ${appId}`);

    console.log('🤖 Step 2: Waiting for AI agent to publish...');
    await waitForChatInput(page);
    await ensureAuthenticated(page);

    // The agent publish pauses on the confirmation modal; approve it before asserting success.
    await approveAgentPublish(page, PUBLISH_TIMEOUT_MS);
    console.log('  ✓ Approved agent publish confirmation');

    const publishButton = page.getByTestId('airo-header').getByRole('button', { name: /publish/i });
    await expect(publishButton).not.toBeDisabled({ timeout: DEPLOYMENT_TIMEOUT_MS });

    const publishedUrl = await waitForPublishedUrl(page, appId, { timeoutMs: PUBLISH_TIMEOUT_MS + 300_000 });
    console.log(`  ✓ Publish landed: ${publishedUrl}`);

    console.log('📋 Step 3: Open publish popover → Pre-Launch Check → SEO prompt');
    await publishButton.click();

    await expect(
      page.getByText(/builder_publish_popover_title|Publish your (app|project)/i).first(),
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const preLaunchCheck = page.getByRole('button', {
      name: /builder_publish_prelaunch_check_button|Check SEO and Health|Run Pre-Launch Check/i,
    });

    const isPreLaunchVisible = await preLaunchCheck.isVisible({ timeout: DEFAULT_TIMEOUT }).catch(() => false);
    if (!isPreLaunchVisible) {
      console.log('  Pre-Launch Check not visible (feature flag off in this environment), skipping');
      test.skip();
      return;
    }

    await preLaunchCheck.click();

    const seoPrelaunchOption = page.getByTestId('post-publish-prelaunch-seo-run-button');
    await expect(seoPrelaunchOption).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    await seoPrelaunchOption.click();

    await expect(
      page.getByText(/Run an SEO check|builder_post_publish_prelaunch_seo_action_message/i),
    ).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });

    console.log('🎉 Post-publish Pre-Launch SEO smoke passed!');
  });

  // Re-enabled (VNEXT-80876). The deployments POST mock was using route.continue()
  // so the real deploy landed mid-test and unmounted the DNS conflict modal before
  // the assertions (CI run 25675567980). Fixed by fulfilling with a stub 200 so
  // no real deploy runs and the modal stays mounted for assertion.
  test('Publish popover — DNS conflict modal without-dns and confirm paths', async ({ page }, testInfo) => {
    // 2 × AI_RESPONSE_TIMEOUT_MS for the initial generation + 300 s for mocks,
    // reload, and DNS-conflict modal assertions.
    testInfo.setTimeout(2 * AI_RESPONSE_TIMEOUT_MS + 300_000);

    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    console.log('📱 Step 1: Creating app for DNS conflict modal flow...');
    await page.goto('/');
    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await dismissOverlays(page);

    // "Projects" popover auto-opens for authenticated users with existing apps.
    // The button renders immediately but aria-expanded becomes true only after
    // the app-list API responds. Wait for the *expanded* state specifically.
    const projectsExpanded = page.getByRole('button', { name: 'Projects', expanded: true });
    const didExpand = await projectsExpanded
      .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    if (didExpand) {
      await projectsExpanded.click();
      await page.waitForTimeout(300);
      console.log('  ✓ Collapsed Projects popover');
    }

    // No "publish this app" in this prompt — this test exercises the *manual*
    // publish-popover DNS-conflict flow. Asking the agent to publish causes a
    // real deployment to be initiated; even after dismissing the confirm modal
    // with Escape the deploy may have already been sent, leaving the app in
    // `isPublishingOrDeploying=true` state after reload → inner Publish button
    // stays disabled for the whole DEPLOYMENT_TIMEOUT_MS window.
    await promptInput.fill(
      `${getSpecPrefix('publish-dns-conflict')} Single page hello world app - do not ask follow up questions`,
    );

    const submitBtn = page.locator('[data-eid*="homepage.prompt.submit"]');
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click({ force: true });
    console.log(`  Submit clicked, waiting for navigation...`);

    // Already authenticated in beforeEach; only drive SSO if it reappeared.
    const ssoResult = await detectSsoType(page, true);
    if (isSignInUIResult(ssoResult)) {
      await handleSsoLogin(page);
    }

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    await waitForChatInput(page);
    // chat-send-button visible → streamingState === 'idle' → isConversationInProgress = false.
    // waitForChatInput only gates the textarea; the inner Publish button uses a
    // stricter condition (AppPublish.tsx:337) that requires the SSE stream to be
    // idle. Waiting here before the reload ensures the agent has finished so the
    // post-reload reconnect settles quickly rather than blocking for up to 300 s.
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: 2 * AI_RESPONSE_TIMEOUT_MS });
    await ensureAuthenticated(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
    expect(appId).toBeTruthy();

    const mockedDomain = 'example.com';
    let deploymentsPostCount = 0;
    let lastDnsConsent: boolean | undefined;

    console.log('🔧 Step 2: Mock site/domain/dns-check for conflict flow...');
    // Pre-fetch real site data so the route handler never needs route.fetch()
    // (which can fail silently in CI, causing the catch to fall back to the
    // real unmodified response — no custom domain → DNS gate returns
    // {proceed:true} without showing the modal).
    const siteResp = await page.request.get(`/api/sites/${appId}`);
    const baseSiteData: Record<string, unknown> = siteResp.ok()
      ? (await siteResp.json() as Record<string, unknown>)
      : { id: appId };

    await page.route(`**/api/sites/${appId}`, async (route, request) => {
      if (request.method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...baseSiteData,
          domains: [
            {
              fqdn: mockedDomain,
              isPrimary: true,
              domainType: null,
              status: 'active',
            },
          ],
        }),
      });
    });

    // Self-contained response (no upstream proxy) so the React Query hook
    // resolves instantly — avoids a race where Publish is clicked before
    // useDomainsQuery has completed.
    await page.route('**/api/domains**', async (route, request) => {
      if (request.method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          domains: [
            {
              domain: mockedDomain,
              hasInternalNameservers: true,
              nameservers: ['ns31.domaincontrol.com', 'ns32.domaincontrol.com'],
            },
          ],
          totalInSearch: 1,
        }),
      });
    });

    await page.route(`**/api/apps/${appId}/dns-check-conflict**`, async (route, request) => {
      if (request.method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hasProductDNSConflict: true,
          currentIps: ['93.184.216.34'],
          failedOpen: false,
        }),
      });
    });

    await page.route(`**/api/apps/${appId}/deployments**`, async (route, request) => {
      if (request.method() === 'POST') {
        deploymentsPostCount += 1;
        const payload = request.postDataJSON() as { dnsUpdateConsent?: boolean } | null;
        lastDnsConsent = payload?.dnsUpdateConsent;
        // Fulfill with a stub instead of continuing to the real server. If the
        // real deploy lands, a downstream state update unmounts the DNS conflict
        // modal before the assertions can run (CI run 25675567980 failure mode).
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ deploymentId: 'e2e-stub', status: 'queued' }),
        });
      } else if (request.method() === 'GET' && deploymentsPostCount > 0) {
        // Return the stub as 'deployed' so useDeploymentsQuery calls setPublishSuccess
        // → clears isPublishing + isDeploymentInProgress, enabling the inner Publish
        // button for Step 4 (CI run 27997507846 failure mode).
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ id: 'e2e-stub', status: 'deployed', gitHash: null }]),
        });
      } else {
        await route.continue();
      }
    });

    // Wait for both site and domain data to be served before interacting.
    await Promise.all([
      page.waitForResponse((resp) => resp.url().includes(`/api/sites/${appId}`) && resp.status() === 200),
      page.waitForResponse((resp) => resp.url().includes('/api/domains') && resp.status() === 200),
      page.reload(),
    ]);
    await waitForDevelopPage(page);
    await waitForChatInput(page);
    // AI was idle before reload; SSE reconnect settles to idle quickly.
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await ensureAuthenticated(page);

    const publishTrigger = page.getByTestId('airo-header').getByRole('button', { name: /publish/i });
    await expect(publishTrigger).not.toBeDisabled({ timeout: DEPLOYMENT_TIMEOUT_MS });

    console.log('🧪 Step 3: Publish with DNS checkbox unchecked should send dnsUpdateConsent=false...');
    await publishTrigger.click();
    // The publish UI is a ResponsivePopover (an @ux/flyout pane on desktop, a
    // bottom sheet on mobile); scope to its stable test id rather than the old
    // shadcn `data-slot="popover-content"`, which the flyout does not emit. The
    // element only renders while open, so no `[data-state="open"]` is needed.
    const publishPopover = page.locator('[data-testid="publish-popover"]');
    await expect(publishPopover.getByText(/builder_publish_popover_title|Publish your (app|project)/i)).toBeVisible({
      timeout: DEFAULT_TIMEOUT,
    });
    // The inner Publish button is disabled while
    // `isPublishingOrDeploying || isConversationInProgress` (see
    // app/src/components/layout/AppPublish.tsx:833). Wait for it to actually
    // become enabled — the publish state machine settles a couple of
    // seconds after the dialog opens.
    const dialogPublishButton = publishPopover.getByRole('button', { name: /^publish$/i });
    await expect(dialogPublishButton).toBeEnabled({ timeout: DEPLOYMENT_TIMEOUT_MS });
    await dialogPublishButton.click();

    const dnsConflictTitle = page.getByText('Publish domain with DNS update?');
    await expect(dnsConflictTitle).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // @ux/modal accessible name may not match the title prop exactly (i18n / aria-labelledby
    // computation). Use stable DOM identifiers from DnsConflictModal.tsx instead.
    await page.locator('[data-eid*="dns_conflict.confirm"]').click();

    await expect.poll(() => deploymentsPostCount, { timeout: DEFAULT_TIMEOUT }).toBeGreaterThan(0);
    expect(lastDnsConsent).toBe(false);

    // useDnsConflictGate sets isOpen:false on confirm, but React batches the
    // re-render asynchronously. Wait for the modal to fully unmount so it
    // doesn't block the popover interaction in Step 4.
    await expect(dnsConflictTitle).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // The GET deployments mock now returns 'deployed', so useDeploymentsQuery
    // calls setPublishSuccess (clears isPublishing) and setShowFirstPublishCongrats
    // (isFirstPublish=true for a fresh app). The congrats modal requires fqdn to be
    // set (populated after the fetchSite call inside useDeploymentsQuery). Wait for
    // it to appear (initial poll delay is 5 s) then dismiss it.
    const congratsModal = page.locator('#first-publish-congrats-modal');
    const congratsVisible = await congratsModal
      .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    if (congratsVisible) {
      await page.keyboard.press('Escape');
      await expect(congratsModal).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  ✓ Dismissed first-publish congrats modal after Step 3 stub deploy');
    }
    // Go-live modal may also appear if the appbuilder-go-live switchboard flag is on.
    const goLiveModalBtn = page.getByTestId('go-live-modal-later');
    if (await goLiveModalBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await goLiveModalBtn.click();
      await expect(goLiveModalBtn).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  ✓ Dismissed go-live modal after Step 3 stub deploy');
    }

    console.log('🧪 Step 4: Publish with DNS checkbox checked should send dnsUpdateConsent=true...');
    deploymentsPostCount = 0;
    lastDnsConsent = undefined;
    await expect(publishTrigger).not.toBeDisabled({ timeout: DEPLOYMENT_TIMEOUT_MS });
    await publishTrigger.click();
    await expect(publishPopover.getByText(/builder_publish_popover_title|Publish your (app|project)/i)).toBeVisible({
      timeout: DEFAULT_TIMEOUT,
    });
    await expect(dialogPublishButton).toBeEnabled({ timeout: DEPLOYMENT_TIMEOUT_MS });
    await dialogPublishButton.click();
    await expect(dnsConflictTitle).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await page.locator('#dns-update-consent').click();
    await page.locator('[data-eid*="dns_conflict.confirm"]').click();

    await expect.poll(() => deploymentsPostCount, { timeout: DEFAULT_TIMEOUT }).toBeGreaterThan(0);
    expect(lastDnsConsent).toBe(true);

    console.log('🎉 DNS conflict modal smoke passed!');
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);

    if (E2E_NO_DELETE) {
      console.log('🧹 Cleanup skipped (E2E_NO_DELETE=true)');
      return;
    }

    console.log('🧹 Cleanup...');
    // Per-prefix try/catch so one prefix failing (e.g., transient 401)
    // doesn't skip cleanup of the remaining ones — important here because
    // SPEC_PREFIXES has 3 entries and orphans on any of them accumulate.
    for (const name of SPEC_PREFIXES) {
      try {
        await deleteAppsWithPrefix(page, getSpecPrefix(name));
      } catch (err) {
        console.error(`  Cleanup of prefix '${name}' failed:`, err);
      }
    }
  });
});
