/**
 * initial-agent-design-kit guided-flow regression coverage (AIROBUILD-2899).
 *
 * The "design-kit guided flow" is the internal-employee-gated, experimental
 * onboarding that runs when the agent profile is `initial-agent-design-kit`
 * (Switchboard `appbuilder-agent-profile`): an immersive, chat-led build that
 * moves through phases `gathering -> brand -> website -> ready`, renders in
 * `BuilderLayout.Immersive` (full builder chrome hidden) until `ready`, then
 * reveals the builder.
 *
 * NOTE — this is NOT the homepage "Design Kit Gallery" (`DesignKitGallery` /
 * `appbuilder-design-kit-gallery`, the "attach a pre-made style" modal). That is
 * a separate feature with a confusingly similar name.
 *
 * The profile gate is a CLIENT-read Switchboard value (`useIsDesignKitWizardProfile`
 * -> `getSwitchboardValue('appbuilder-agent-profile')`), so we force it on via the
 * `window.gasketData.switchboard` init-script injection (same pattern as
 * apps-page.spec.ts) and also force `appbuilder-server-driven-layout` on, then
 * drive the real `PUT /api/design-kit/:id/wizard-step` endpoint — which persists
 * `designKitLayoutForPhase(true, phase)` + emits the `builder_layout` SSE — so the
 * phase machine + layout transitions are deterministic: no LLM wait, no TLA
 * account, no route mocks. The full agent-driven build (real vibe pick -> brand /
 * website generation) is a future @tla-account job.
 *
 * Template: develop-brand-book.spec.ts (create-app -> assert testids -> cleanup).
 */
import { test, expect } from '../helpers/test-fixtures';

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { ensureAuthenticated, loginViaSsoDirect } from '../helpers/auth';
import { AI_RESPONSE_TIMEOUT_MS, DEFAULT_TIMEOUT, E2E_NO_DELETE, LONG_TIMEOUT, getSpecPrefix } from '../helpers/constants';
import { DESIGN_KIT_FLAGS, driveWizardPhase } from '../helpers/design-kit';
import { dismissOverlays, expectClientFlags, forceClientFlags, logTestResult, logTestStart, submitHomepage, waitForDevelopPage } from '../helpers/ui';

/** Spec prefixes used by `getSpecPrefix(...)` calls in this describe block. */
const SPEC_PREFIXES = ['design-kit'] as const;

test.describe('initial-agent-design-kit guided flow', () => {
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
    if (E2E_NO_DELETE) {
      console.log('🧹 Cleanup skipped (E2E_NO_DELETE=true)');
      return;
    }
    for (const name of SPEC_PREFIXES) {
      try {
        await deleteAppsWithPrefix(page, getSpecPrefix(name));
      } catch (err) {
        console.error(`  Cleanup of prefix '${name}' failed:`, err);
      }
    }
  });

  test('immersive layout runs the phase machine and reveals the builder at ready', async ({ page }, testInfo) => {
    // App create (+ optional generation) plus three drive+reload cycles — give it headroom.
    testInfo.setTimeout(AI_RESPONSE_TIMEOUT_MS + 120_000);

    // Force the design-kit agent profile (the flow's gate) + server-driven layout
    // (deterministic descriptor-driven docking) on, before the first navigation.
    await forceClientFlags(page, DESIGN_KIT_FLAGS);
    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    console.log('Step 1: Create an app (design-kit profile forced on)...');
    await page.goto('/');
    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('design-kit')} Simple coffee shop landing page - do not ask follow up questions`);
    await submitHomepage(page);

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
    expect(appId).not.toBe('');
    console.log(`  App created: ${appId}`);
    await ensureAuthenticated(page);

    console.log('Step 2: Drive phase -> brand and assert the immersive shell...');
    await driveWizardPhase(page, appId, 'brand');
    // Reload so useBuilderLayout resolves immersive from GET /apps/:id (app-record path).
    await page.reload();
    await dismissOverlays(page);
    // Prove the injected flags are live so the immersive assertions below can't
    // false-pass via the legacy phase-inference path (which renders the same shell).
    await expectClientFlags(page, DESIGN_KIT_FLAGS);
    await expect(page.getByTestId('immersive-header')).toBeVisible({ timeout: LONG_TIMEOUT });
    await expect(page.getByTestId('design-kit-wizard')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // Immersive hides the full builder chrome — the develop header tabs are gone.
    await expect(page.getByTestId('header-tab-preview')).toHaveCount(0);
    console.log('  Immersive shell rendered; full chrome hidden');

    console.log('Step 3: Drive phase -> website (still immersive)...');
    await driveWizardPhase(page, appId, 'website');
    await page.reload();
    await dismissOverlays(page);
    await expect(page.getByTestId('immersive-header')).toBeVisible({ timeout: LONG_TIMEOUT });
    await expect(page.getByTestId('design-kit-wizard')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  Still immersive during website build');

    console.log('Step 4: Drive phase -> ready and assert the builder is revealed...');
    await driveWizardPhase(page, appId, 'ready');
    await page.reload();
    await dismissOverlays(page);
    // ready -> descriptor `default` -> base builder: immersive chrome gone, tabs back.
    await expect(page.getByTestId('immersive-header')).toHaveCount(0, { timeout: LONG_TIMEOUT });
    await expect(page.getByTestId('header-tab-preview')).toBeVisible({ timeout: LONG_TIMEOUT });
    console.log('  Builder revealed at ready — immersive torn down');
  });
});
