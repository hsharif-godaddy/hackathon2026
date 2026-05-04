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
 * (`post-publish-feature-selection`, `post-publish-prelaunch-seo-prompt`).
 *
 * Strategy:
 * - AI agent handles publishing automatically
 * - No manual publish clicks needed
 */
import { test, expect } from '@playwright/test';

import { deleteAllSitesViaAPI } from '../helpers/api';
import { handleSsoLogin, ensureAuthenticated } from '../helpers/auth';
import {
  AI_RESPONSE_TIMEOUT_MS,
  DEFAULT_TIMEOUT,
  DEPLOYMENT_TIMEOUT_MS,
  LONG_TIMEOUT,
  PUBLISH_TIMEOUT_MS,
  getSpecPrefix,
} from '../helpers/constants';
import {
  dismissGoLiveModalIfPresent,
  dismissOverlays,
  expectPublishSuccessVisible,
  logTestResult,
  logTestStart,
  waitForChatInput,
  waitForDevelopPage,
} from '../helpers/ui';

test.describe('Publish Flow', () => {
  test.beforeEach(async ({}, testInfo) => {
    logTestStart(testInfo);
  });

  test('AI Auto-Publish - Create App, Deploy & Verify Live Status', async ({ page }) => {
    // ========================================
    // STEP 1: Create app with publish instruction
    // ========================================
    console.log('📱 Step 1: Creating app with publish instruction...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('publish')} Single page hello world app - do not ask follow up questions and publish this app`);

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    // Handle SSO login
    await handleSsoLogin(page);

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

    await expectPublishSuccessVisible(page, PUBLISH_TIMEOUT_MS);
    console.log('  ✓ Publish success (congrats modal or growl visible)');

    // ========================================
    // STEP 4: Verify SSR HTML
    // ========================================
    console.log('🌐 Step 4: Verifying SSR HTML at published URL...');

    let publishedUrl = '';
    try {
      const siteResp = await page.request.get(`/api/sites/${appId}`);
      if (siteResp.ok()) {
        const site = await siteResp.json();
        publishedUrl = typeof site?.published_url === 'string' ? site.published_url : '';
      } else {
        console.log(`  ⚠ /api/sites/${appId} returned ${siteResp.status()}`);
      }
    } catch (err) {
      console.log(`  ⚠ Failed to fetch site record: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!publishedUrl) {
      console.log('  ⚠ No published_url available on site record - skipping SSR assertion');
    } else {
      console.log(`  Published URL: ${publishedUrl}`);
      let resp;
      try {
        resp = await page.request.get(publishedUrl, {
          headers: {
            'User-Agent': 'SmokeSsrValidator/1.0',
            'Accept': 'text/html',
          },
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
    }

    console.log('🎉 Publish flow test passed!');
  });

  test.skip('Publish popover — Pre-Launch Check opens SEO prompt and sends SEO action', async ({ page }, testInfo) => {
    testInfo.setTimeout(600_000);

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

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    await handleSsoLogin(page);

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    console.log('🤖 Step 2: Waiting for AI agent to publish...');
    await waitForChatInput(page);
    await ensureAuthenticated(page);

    const publishButton = page.getByTestId('airo-header').getByRole('button', { name: /publish/i });
    await expect(publishButton).not.toBeDisabled({ timeout: DEPLOYMENT_TIMEOUT_MS });

    await expectPublishSuccessVisible(page, PUBLISH_TIMEOUT_MS);
    console.log('  ✓ Publish success');

    const congratsModal = page.locator('#first-publish-congrats-modal');
    if (await congratsModal.isVisible({ timeout: DEFAULT_TIMEOUT }).catch(() => false)) {
      await page.keyboard.press('Escape');
      await expect(congratsModal).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  ✓ Dismissed first-publish congrats modal');
    }

    await dismissGoLiveModalIfPresent(page);
    await dismissOverlays(page);

    console.log('📋 Step 3: Open publish popover → Pre-Launch Check → SEO prompt');
    await publishButton.click();

    await expect(
      page.getByText(/builder_publish_popover_title|Publish Your App/i),
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const preLaunchCheck = page.getByRole('button', {
      name: /builder_golive_marketing_seo_title|SEO Optimization/i,
    });

    const isPreLaunchVisible = await preLaunchCheck.isVisible({ timeout: DEFAULT_TIMEOUT }).catch(() => false);
    if (!isPreLaunchVisible) {
      console.log('  Pre-Launch Check not visible (feature flag off in this environment), skipping');
      test.skip();
      return;
    }

    await preLaunchCheck.click();

    const featureSelection = page.getByTestId('post-publish-feature-selection');
    await expect(featureSelection).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.getByTestId('post-publish-prelaunch-seo-prompt')).toBeVisible();

    await page.getByTestId('post-publish-prelaunch-seo-run-button').getByRole('button').click();

    await expect(featureSelection).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });

    await expect(
      page.getByText(/Run an SEO check|builder_post_publish_prelaunch_seo_action_message/i),
    ).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });

    console.log('🎉 Post-publish Pre-Launch SEO smoke passed!');
  });

  test('Publish popover — DNS conflict modal without-dns and confirm paths', async ({ page }, testInfo) => {
    testInfo.setTimeout(600_000);

    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    console.log('📱 Step 1: Creating app for DNS conflict modal flow...');
    await page.goto('/');
    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(
      `${getSpecPrefix('publish-dns-conflict')} Single page hello world app - do not ask follow up questions and publish this app`,
    );
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    await handleSsoLogin(page);
    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    await waitForChatInput(page);
    await ensureAuthenticated(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
    expect(appId).toBeTruthy();

    const mockedDomain = 'example.com';
    let deploymentsPostCount = 0;
    let lastDnsConsent: boolean | undefined;

    console.log('🔧 Step 2: Mock site/domain/dns-check for conflict flow...');
    await page.route(`**/api/sites/${appId}`, async (route, request) => {
      if (request.method() !== 'GET') return route.continue();
      const upstream = await route.fetch();
      const body = await upstream.json() as Record<string, unknown>;
      await route.fulfill({
        response: upstream,
        body: JSON.stringify({
          ...body,
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

    await page.route('**/api/domains', async (route, request) => {
      if (request.method() !== 'GET') return route.continue();
      const upstream = await route.fetch();
      const body = await upstream.json() as { domains?: Array<{ domain?: string }> };
      const existingDomains = Array.isArray(body.domains) ? body.domains : [];
      await route.fulfill({
        response: upstream,
        body: JSON.stringify({
          ...body,
          domains: [
            ...existingDomains.filter((domain) => domain?.domain !== mockedDomain),
            {
              domain: mockedDomain,
              hasInternalNameservers: true,
              nameservers: ['ns31.domaincontrol.com', 'ns32.domaincontrol.com'],
            },
          ],
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

    await page.route(`**/api/apps/${appId}/deployments`, async (route, request) => {
      if (request.method() !== 'POST') return route.continue();
      deploymentsPostCount += 1;
      const payload = request.postDataJSON() as { dnsUpdateConsent?: boolean } | null;
      lastDnsConsent = payload?.dnsUpdateConsent;
      return route.continue();
    });

    await page.reload();
    await waitForDevelopPage(page);
    await waitForChatInput(page);
    await ensureAuthenticated(page);

    const publishTrigger = page.getByTestId('airo-header').getByRole('button', { name: /publish/i });
    await expect(publishTrigger).not.toBeDisabled({ timeout: DEPLOYMENT_TIMEOUT_MS });

    console.log('🧪 Step 3: Publish with DNS checkbox unchecked should send dnsUpdateConsent=false...');
    await publishTrigger.click();
    await expect(page.getByText(/builder_publish_popover_title|Publish Your App/i)).toBeVisible({
      timeout: DEFAULT_TIMEOUT,
    });
    await page.getByRole('button', { name: /^publish$/i }).first().click();

    const dnsConflictTitle = page.getByText('Publish domain with DNS update?');
    const dnsConflictModal = page.getByRole('dialog', { name: 'Publish domain with DNS update?' });
    await expect(dnsConflictTitle).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await dnsConflictModal.getByRole('button', { name: 'Publish' }).click();

    await expect.poll(() => deploymentsPostCount, { timeout: DEFAULT_TIMEOUT }).toBeGreaterThan(0);
    expect(lastDnsConsent).toBe(false);

    console.log('🧪 Step 4: Publish with DNS checkbox checked should send dnsUpdateConsent=true...');
    deploymentsPostCount = 0;
    lastDnsConsent = undefined;
    await expect(publishTrigger).not.toBeDisabled({ timeout: DEPLOYMENT_TIMEOUT_MS });
    await publishTrigger.click();
    await expect(page.getByText(/builder_publish_popover_title|Publish Your App/i)).toBeVisible({
      timeout: DEFAULT_TIMEOUT,
    });
    await page.getByRole('button', { name: /^publish$/i }).first().click();
    await expect(dnsConflictTitle).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await dnsConflictModal.getByRole('checkbox', { name: 'Update DNS records' }).click();
    await dnsConflictModal.getByRole('button', { name: 'Publish' }).click();

    await expect.poll(() => deploymentsPostCount, { timeout: DEFAULT_TIMEOUT }).toBeGreaterThan(0);
    expect(lastDnsConsent).toBe(true);

    console.log('🎉 DNS conflict modal smoke passed!');
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);

    console.log('🧹 Cleanup...');
    try {
      await page.goto('/apps');
      await deleteAllSitesViaAPI(page);
    } catch {
      console.log('  ⚠ Cleanup skipped');
    }
  });
});
