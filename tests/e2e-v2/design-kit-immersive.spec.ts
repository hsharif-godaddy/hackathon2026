/**
 * initial-agent-design-kit immersive layout — v2 happy-path smoke (AIROBUILD-2899).
 *
 * The v2 canonical-CI guard for the design-kit guided flow's immersive layout: a
 * design-kit build (agent profile `initial-agent-design-kit`, wizard phase `brand`)
 * renders in `BuilderLayout.Immersive` with the wizard docked and the full builder
 * chrome hidden.
 *
 * NOT the homepage "Design Kit Gallery" (`appbuilder-design-kit-gallery`) — that's
 * a separate feature. The profile gate + layout are both CLIENT-read Switchboard
 * values, so we force `appbuilder-agent-profile=initial-agent-design-kit` and
 * `appbuilder-server-driven-layout` on (the `window.gasketData.switchboard`
 * injection pattern) and drive the real `PUT /api/design-kit/:id/wizard-step`
 * endpoint — which persists `designKitLayoutForPhase(true, phase)` and emits the
 * `builder_layout` SSE — then reload so the app-record path renders immersive.
 * Deterministic: no LLM wait, no TLA account, no route mocks.
 *
 * Owns its app (drives layout state) — it can NOT use the read-only pool app.
 * Deeper transition coverage lives in tests/regression/develop-design-kit.spec.ts.
 */
import { test, expect } from '../helpers/test-fixtures';

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { ensureAuthenticated, loginViaSsoDirect } from '../helpers/auth';
import { AI_RESPONSE_TIMEOUT_MS, DEFAULT_TIMEOUT, E2E_NO_DELETE, LONG_TIMEOUT, getSpecPrefix } from '../helpers/constants';
import { DESIGN_KIT_FLAGS, driveWizardPhase } from '../helpers/design-kit';
import { dismissOverlays, expectClientFlags, forceClientFlags, logTestResult, logTestStart, submitHomepage, waitForDevelopPage } from '../helpers/ui';

/** Spec prefixes used by `getSpecPrefix(...)` calls below. */
const SPEC_PREFIXES = ['dk-immersive'] as const;

test.describe.configure({ mode: 'serial' });

test.describe('Design Kit immersive layout (v2 smoke)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    await loginViaSsoDirect(page);
    if (!E2E_NO_DELETE) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch((err) => console.warn('  eviction skipped:', err));
    }
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);
    if (E2E_NO_DELETE) return;
    for (const name of SPEC_PREFIXES) {
      try {
        await deleteAppsWithPrefix(page, getSpecPrefix(name));
      } catch (err) {
        console.error(`  Cleanup of prefix '${name}' failed:`, err);
      }
    }
  });

  test('design-kit build renders the immersive shell with chrome hidden', async ({ page }, testInfo) => {
    testInfo.setTimeout(AI_RESPONSE_TIMEOUT_MS + 90_000);

    await forceClientFlags(page, DESIGN_KIT_FLAGS);
    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    await page.goto('/');
    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('dk-immersive')} Simple bakery landing page - do not ask follow up questions`);
    await submitHomepage(page);

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
    expect(appId).not.toBe('');
    await ensureAuthenticated(page);

    // Persist + emit the immersive descriptor for the `brand` phase.
    await driveWizardPhase(page, appId, 'brand');

    // Reload so useBuilderLayout resolves immersive from GET /apps/:id.
    await page.reload();
    await dismissOverlays(page);

    // Prove the injected flags are live so the immersive assertions can't
    // false-pass via the legacy phase-inference path (which renders the same shell).
    await expectClientFlags(page, DESIGN_KIT_FLAGS);
    await expect(page.getByTestId('immersive-header')).toBeVisible({ timeout: LONG_TIMEOUT });
    await expect(page.getByTestId('design-kit-wizard')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // Immersive takes over — the full builder header tabs are not rendered.
    await expect(page.getByTestId('header-tab-preview')).toHaveCount(0);
  });
});
