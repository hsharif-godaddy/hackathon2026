/**
 * Auth-at-Edge SSO — Settings panel + Publish gate E2E
 *
 * Conditionally enabled. The full flow requires an "ent persona" — i.e. an
 * AAB app whose backing subscription has `sso_required=true` in mhp-core.
 * That fixture doesn't exist in test/prod yet (Phase 1 is GoDaddy-internal
 * via admin-controlled mgmt-client), so we gate this spec on the env var
 * `AAB_E2E_SSO_PERSONA=ent` and skip otherwise. For LOCAL runs:
 *
 *   AAB_DEV_SUBSCRIPTION_POLICY=required pnpm run dev
 *   AAB_E2E_SSO_PERSONA=ent pnpm test:e2e tests/regression/develop-sso.spec.ts
 *
 * When the ent fixture lands in test/prod (Phase 1.5), drop the env-gate and
 * the spec becomes a normal regression test.
 */
import { test, expect } from '../helpers/test-fixtures';

import { evictOldestE2eAppsToFitLimit, deleteAppsWithPrefix } from '../helpers/api';
import { handleSsoLogin, ensureAuthenticated, loginIfNeeded } from '../helpers/auth';
import {
  DEFAULT_TIMEOUT,
  E2E_NO_DELETE,
  getSpecPrefix,
} from '../helpers/constants';
import {
  dismissOverlays,
  logTestResult,
  logTestStart,
  waitForDevelopPage,
} from '../helpers/ui';

const ENT_PERSONA = process.env.AAB_E2E_SSO_PERSONA === 'ent';
const SPEC_PREFIXES = ['sso'] as const;

test.describe('Auth-at-Edge SSO (ent persona)', () => {
  test.skip(!ENT_PERSONA, 'AAB_E2E_SSO_PERSONA=ent not set — requires an ent app fixture');

  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    if (!E2E_NO_DELETE) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch(() => { });
    }
    await loginIfNeeded(page);
    await handleSsoLogin(page);
    await ensureAuthenticated(page);
  });

  test.afterAll(async ({ browser }) => {
    if (E2E_NO_DELETE) return;
    const page = await browser.newPage();
    try {
      await loginIfNeeded(page);
      await handleSsoLogin(page);
      for (const prefix of SPEC_PREFIXES) {
        await deleteAppsWithPrefix(page, getSpecPrefix(prefix)).catch(() => { });
      }
    } finally {
      await page.close();
    }
  });

  test('SSO panel renders for ent apps and gates publish until Save', async ({ page }, testInfo) => {
    try {
      await waitForDevelopPage(page);
      await dismissOverlays(page);

      // Settings → SSO must be visible only when ssoRequired === true.
      // useSettingsNavItems hides the entry for non-ent apps.
      await page.getByTestId('chat-toolbar-settings-button').click();
      const ssoNavEntry = page.getByTestId('settings-nav-sso');
      await expect(ssoNavEntry).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await ssoNavEntry.click();

      // Locked alert + intro + form are present.
      await expect(page.getByTestId('sso-policy-block')).toBeVisible();
      await expect(page.getByTestId('sso-client-id')).toBeVisible();
      await expect(page.getByTestId('sso-client-secret')).toBeVisible();
      await expect(page.getByTestId('sso-save')).toBeEnabled();

      // Publish button is disabled with the SSO-required alert.
      // (Implementation detail: AppPublish renders an alert in the publish
      // popover; the button itself is `disabled`.)
      const publishButton = page.getByTestId('publish-trigger-button');
      await expect(publishButton).toBeDisabled();

      // Fill + Save credentials. The actual mTLS write hits the local
      // hosting (LCP) when running with AAB_DEV_SUBSCRIPTION_POLICY=required.
      await page.getByTestId('sso-client-id').fill('0oa1ab2cd3ef4-e2e');
      await page.getByTestId('sso-client-secret').fill('e2e-test-secret');
      await page.getByTestId('sso-save').click();

      // Success affordance + publish button enables on next interaction.
      await expect(page.getByTestId('sso-success')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      // The cross-instance refresh (`refreshAppSsoStatus`) re-fetches
      // ssoConfigured for AppPublish's hook instance, so the button enables
      // without a page reload.
      await expect(publishButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });

      logTestResult(testInfo, 'pass');
    } catch (err) {
      logTestResult(testInfo, 'fail', err);
      throw err;
    }
  });

  test('Share-link button is disabled for ent apps even after Save', async ({ page }, testInfo) => {
    try {
      // Share links bypass the IdP by design — for ent apps they're
      // permanently disabled regardless of whether SSO is configured.
      // (Distinct from publish: publish enables once configured.)
      await waitForDevelopPage(page);
      await dismissOverlays(page);

      const shareLinkButton = page.getByTestId('share-link-button');
      await expect(shareLinkButton).toBeVisible();
      await expect(shareLinkButton).toBeDisabled();

      logTestResult(testInfo, 'pass');
    } catch (err) {
      logTestResult(testInfo, 'fail', err);
      throw err;
    }
  });
});
