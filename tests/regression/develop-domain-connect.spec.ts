/**
 * Domain Connect UI regression tests (`appbuilder-domain-connect`).
 *
 * Exercises tabbed DomainAttach UX with mocked site/domain APIs so flows stay
 * fast and deterministic. Real attach/detach against mgmt-airo remains in
 * tests/e2e/e2e.spec.ts Step 11.
 */
import { test, expect } from '../helpers/test-fixtures';

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { handleSsoLogin, ensureAuthenticated } from '../helpers/auth';
import {
  DEFAULT_TIMEOUT,
  E2E_NO_DELETE,
  LONG_TIMEOUT,
  getSpecPrefix,
} from '../helpers/constants';
import {
  asPublishedSite,
  installSwitchboardFlagOverride,
  isDomainConnectEnabled,
  mockCustomerDomainsRoute,
  mockDomainValidationRoute,
  mockSiteRoute,
  openDomainSettingsPanel,
  selectDomainAttachTab,
  waitForDomainPanelData,
} from '../helpers/domain-panel';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

const SPEC_PREFIX = 'domain-connect';

test.describe.configure({ mode: 'serial' });

test.describe('Domain Connect UI', () => {
  let appId = '';

  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    if (!E2E_NO_DELETE && !appId) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch(() => {});
    }
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);
  });

  test.afterAll(async ({ browser }) => {
    if (E2E_NO_DELETE || !appId) {
      return;
    }
    const page = await browser.newPage();
    try {
      await page.goto('/apps');
      await deleteAppsWithPrefix(page, getSpecPrefix(SPEC_PREFIX));
    } catch (err) {
      console.error('  Domain connect cleanup failed:', err);
    } finally {
      await page.close();
    }
  });

  test('creates app fixture for domain panel tests', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    await page.goto('/');
    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix(SPEC_PREFIX)} Single page hello world - do not ask follow up questions`);

    await dismissOverlays(page);
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();
    await handleSsoLogin(page);
    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] ?? '';
    expect(appId).toBeTruthy();
    console.log(`  App created: ${appId}`);
  });

  test('shows buy tab by default when account domain list is empty', async ({ page }) => {
    test.skip(!appId, 'app fixture missing');
    await page.unrouteAll();

    await installSwitchboardFlagOverride(page, {
      'appbuilder-domain-connect': true,
      'appbuilder-domain-attach': true,
    });
    await mockCustomerDomainsRoute(page, []);
    await mockSiteRoute(page, appId, (body) => asPublishedSite(body, []));
    await openDomainSettingsPanel(page, appId);
    await waitForDomainPanelData(page, appId);
    await ensureAuthenticated(page);
    expect(await isDomainConnectEnabled(page)).toBe(true);

    await expect(
      page.getByRole('heading', { name: /^Connect a Domain Name$|builder_domain_attach_main_title/i }),
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    await expect(
      page.getByRole('tab', { name: /GoDaddy Domains|builder_domain_attach_tab_domains/i }),
    ).not.toBeVisible();

    await expect(
      page.getByText(/builder_domain_attach_buy_description|purchase a new domain/i),
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    await expect(
      page.getByRole('link', { name: /builder_domain_attach_buy_button|Buy a Domain/i }),
    ).toBeVisible();

    await selectDomainAttachTab(page, 'external');
    const externalInput = page.locator('#custom-domain-slug');
    await expect(externalInput).toBeVisible();
    await expect(
      page.getByPlaceholderText(/builder_custom_domain_input_help|example\.com/i),
    ).toBeVisible();
    await expect(
      page.locator('[data-eid*="settings.domains.add_domain"]'),
    ).toBeDisabled();
  });

  test('enables connect button after radio selection and opens confirmation modal', async ({ page }) => {
    test.skip(!appId, 'app fixture missing');
    await page.unrouteAll();

    const availableDomain = 'available-domain-connect.example';

    await installSwitchboardFlagOverride(page, {
      'appbuilder-domain-connect': true,
      'appbuilder-domain-attach': true,
    });
    await mockCustomerDomainsRoute(page, [{ domain: availableDomain }]);
    await mockSiteRoute(page, appId, (body) => asPublishedSite(body, []));
    await openDomainSettingsPanel(page, appId);
    await waitForDomainPanelData(page, appId);
    await ensureAuthenticated(page);
    expect(await isDomainConnectEnabled(page)).toBe(true);

    await expect(page.getByLabelText(availableDomain)).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const connectButton = page.locator('[data-eid*="settings.domains.connect_selected"]');
    await expect(connectButton).toBeDisabled();

    await page.getByLabelText(availableDomain).click();
    await expect(connectButton).toBeEnabled();
    await connectButton.click();

    await expect(
      page.getByText(/builder_domain_connect_confirmation_description|connect this domain/i),
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    await page.getByRole('button', { name: /builder_custom_domain_modal_button_cancel|Cancel/i }).click();
    await expect(
      page.getByText(/builder_domain_connect_confirmation_description|connect this domain/i),
    ).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
  });

  test('sends switch payload with domainsToDelete when connecting a new GoDaddy domain', async ({ page }) => {
    test.skip(!appId, 'app fixture missing');
    await page.unrouteAll();

    const activeDomain = 'connected-domain-connect.example';
    const targetDomain = 'other-domain-connect.example';
    let modifyPayload: Record<string, unknown> | null = null;

    await installSwitchboardFlagOverride(page, {
      'appbuilder-domain-connect': true,
      'appbuilder-domain-attach': true,
    });
    await mockCustomerDomainsRoute(page, [
      { domain: activeDomain },
      { domain: targetDomain },
    ]);
    await mockSiteRoute(page, appId, (body) =>
      asPublishedSite(body, [
        {
          fqdn: activeDomain,
          isPrimary: false,
          status: 'active',
          domainType: 'custom',
        },
      ]),
    );
    await page.route(`**/api/sites/${appId}/domains`, async (route, request) => {
      if (request.method() !== 'POST') {
        return route.continue();
      }
      modifyPayload = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          statusJobId: 'domain-connect-e2e-job',
          status: 'pending',
          message: 'ok',
        }),
      });
    });

    await openDomainSettingsPanel(page, appId);
    await waitForDomainPanelData(page, appId);
    await ensureAuthenticated(page);
    expect(await isDomainConnectEnabled(page)).toBe(true);

    await page.getByLabelText(targetDomain).click();
    await page.locator('[data-eid*="settings.domains.connect_selected"]').click();
    await page.locator('[data-eid*="settings.domains.connect_continue"]').click();

    await expect.poll(() => modifyPayload !== null).toBe(true);

    expect(modifyPayload).toMatchObject({
      domainsToCreate: [{ fqdn: targetDomain, primary: false }],
      domainsToDelete: [{ fqdn: activeDomain }],
      createCdn: true,
      isWildcardDomain: true,
    });
  });

  test('external tab connect uses validation and posts create payload', async ({ page }) => {
    test.skip(!appId, 'app fixture missing');
    await page.unrouteAll();

    const externalDomain = 'external-domain-connect.example';
    let modifyPayload: Record<string, unknown> | null = null;

    await installSwitchboardFlagOverride(page, {
      'appbuilder-domain-connect': true,
      'appbuilder-domain-attach': true,
    });
    await mockCustomerDomainsRoute(page, []);
    await mockDomainValidationRoute(page, appId);
    await mockSiteRoute(page, appId, (body) => asPublishedSite(body, []));
    await page.route(`**/api/sites/${appId}/domains`, async (route, request) => {
      if (request.method() !== 'POST') {
        return route.continue();
      }
      modifyPayload = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          statusJobId: 'domain-connect-external-job',
          status: 'pending',
          message: 'ok',
        }),
      });
    });

    await openDomainSettingsPanel(page, appId);
    await waitForDomainPanelData(page, appId);
    await ensureAuthenticated(page);
    expect(await isDomainConnectEnabled(page)).toBe(true);

    await selectDomainAttachTab(page, 'external');
    const externalInput = page.locator('#custom-domain-slug');
    await externalInput.fill(externalDomain);

    const addButton = page.locator('[data-eid*="settings.domains.add_domain"]');
    await expect(addButton).toBeEnabled({ timeout: LONG_TIMEOUT });
    await addButton.click();

    await expect(
      page.getByText(/builder_custom_domain_modal_title|Are you sure/i),
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await page.locator('[data-eid*="settings.domains.connect_continue"]').click();

    await expect.poll(() => modifyPayload !== null).toBe(true);
    expect(modifyPayload).toMatchObject({
      domainsToCreate: [{ fqdn: externalDomain, primary: false }],
      createCdn: true,
      isWildcardDomain: true,
    });
  });

  test('legacy domain attach UI renders without tabs when domain-connect flag is off', async ({ page }) => {
    test.skip(!appId, 'app fixture missing');
    await page.unrouteAll();

    await installSwitchboardFlagOverride(page, {
      'appbuilder-domain-connect': false,
      'appbuilder-domain-attach': true,
    });
    await mockCustomerDomainsRoute(page, []);
    await mockSiteRoute(page, appId, (body) => asPublishedSite(body, []));
    await openDomainSettingsPanel(page, appId);
    await waitForDomainPanelData(page, appId);
    await ensureAuthenticated(page);

    await expect(
      page.getByRole('heading', { name: /builder_custom_domain_title|^Custom Domain$/i }),
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.getByRole('tab')).not.toBeVisible();
    await expect(page.getByTestId('domain-attach-list')).toBeVisible();
    await expect(page.locator('#custom-domain-slug')).toBeVisible();
  });
});
