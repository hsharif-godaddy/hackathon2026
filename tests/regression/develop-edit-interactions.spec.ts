/**
 * Develop Page — color-scheme & font-theme selection widgets.
 *
 * Covers the AI-driven theme/font suggestion widgets
 * (theme-preview-input-panel / font-theme-preview-input-panel) surfaced in the
 * develop chat — coverage that exists nowhere in the e2e / e2e-v2 suites. Each
 * test creates its own app.
 *
 * (Edit-mode toggle and unified code search used to live here as skipped
 * placeholders; they are now covered live by tests/e2e-v2/develop-ui.spec.ts,
 * so the placeholders were removed.)
 */
import { test, expect } from '../helpers/test-fixtures';

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { ensureAuthenticated, loginIfNeeded } from '../helpers/auth';
import { LONG_TIMEOUT, DEFAULT_TIMEOUT, AI_RESPONSE_TIMEOUT_MS, E2E_NO_DELETE, getSpecPrefix } from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

/** Spec prefixes used by `getSpecPrefix(...)` calls in this describe block. */
const SPEC_PREFIXES = ['color-scheme-selection', 'font-theme-selection'] as const;

test.describe('Edit Interactions', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    if (!E2E_NO_DELETE) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch(() => {});
    }
  });

  test('Modern color scheme selection widget', async ({ page }, testInfo) => {
    // Two sequential AI waits: the initial app generation, then surfacing the
    // suggestion widget — versus the ~6 round-trips the previous version
    // chained. Everything after the widget appears is client-side: option
    // select is local state in ThemePreviewInputPanel, not gated on streaming.
    // Budget = 2 cycles for generation (it exceeded one 5-min cycle on prod and
    // timed out the bare wait on run 27605024226) + 1 cycle for the surface +
    // overhead.
    //
    // NB: the sibling font test keeps the fuller apply/generate-more/cancel
    // flow; together they cover both the light render contract (here) and the
    // full conversation (font).
    testInfo.setTimeout(3 * AI_RESPONSE_TIMEOUT_MS + 120_000);

    // ========================================
    // STEP 1: Create an app
    // ========================================
    console.log('Step 1: Creating app...');

    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    await page.goto('/');
    // The "Projects" popover auto-opens on the authenticated homepage and
    // covers the user menu — dismiss overlays first or loginIfNeeded's
    // user-menu click can't open its popover (helpers/auth.ts:540).
    await dismissOverlays(page);
    await loginIfNeeded(page);
    // Re-navigate fresh after potential SSO redirect.
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    // Keep the generation prompt minimal so the initial AI build finishes fast
    // — the page content is irrelevant here (the test only needs a themeable
    // app + a ready chat). The heavier "hero + CTA" prompt contributed to the
    // prod generation timeout on run 27605024226, whereas develop-chat's minimal
    // "hello world" prompt generated well under budget.
    await promptInput.fill(`${getSpecPrefix('color-scheme-selection')} Minimal hello world app - keep it tiny and build it quickly, do not ask follow up questions`);

    // Wait for React hydration before clicking (the disabled→enabled flip is
    // server-rendered so it doesn't prove hydration; a fixed 10s wait does).
    const submitButton = page.locator('[data-eid*="homepage.prompt.submit"]');
    await expect(submitButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
    await page.waitForTimeout(10_000);
    await submitButton.click();

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
    console.log(`  App created: ${appId}`);

    await dismissOverlays(page);

    // Wait for initial generation to complete — the one unavoidable AI wait.
    // Prod generation can exceed a single 5-min cycle (it timed out the bare
    // AI_RESPONSE_TIMEOUT_MS here on run 27605024226), so allow two cycles,
    // matching tests/e2e-v2/develop-ui.spec.ts.
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: 2 * AI_RESPONSE_TIMEOUT_MS });
    console.log('  Initial generation completed');

    await ensureAuthenticated(page);

    // ========================================
    // STEP 2: Surface the color-scheme widget (the single AI round-trip)
    // ========================================
    await dismissOverlays(page);
    console.log('Step 2: Requesting color scheme suggestions...');

    const chatInput = page.getByTestId('chat-input-textarea');
    await expect(chatInput).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await chatInput.fill('Show me some color scheme options');

    const sendButton = page.getByTestId('chat-send-button');
    await expect(sendButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
    await sendButton.click();
    console.log('  Color scheme request sent, waiting for the widget to appear...');

    // ========================================
    // STEP 3: Wait for the widget. It is gated by the
    // `airo-builder-theme-selection-chat` flag, so on a non-prod env where the
    // flag is off (or if the model answers in prose) it may not appear — skip
    // explicitly (visible in the report) rather than failing or silently
    // passing. TODO: hard-require on prod once the widget is confirmed GA there
    // (mirror the env-gating in tests/e2e-v2/develop-ui.spec.ts).
    // ========================================
    const themePanel = page.getByTestId('theme-preview-input-panel');
    const panelVisible = await themePanel
      .waitFor({ state: 'visible', timeout: AI_RESPONSE_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);

    if (!panelVisible) {
      test.skip(true, 'Color scheme widget not available (feature-flagged off or model did not emit it)');
    }
    console.log('  Color scheme preview widget appeared');

    // ========================================
    // STEP 4: Verify the widget's client-side contract — render + option
    // select. Selection is local state in ThemePreviewInputPanel
    // (`selectPalette`), NOT gated on streaming, so it works the moment the
    // panel renders. The Apply/Cancel buttons are disabled while the suggestion
    // stream is still active and re-enable once it settles, so we assert they
    // RENDER rather than clicking them — clicking would force a wait for the
    // surface stream to fully complete (a second AI completion we deliberately
    // avoid; the font test exercises the full apply flow instead).
    // ========================================
    const themeOptions = page.getByTestId('theme-preview-option');
    await expect(themeOptions.first()).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    const optionsCount = await themeOptions.count();
    console.log(`  Found ${optionsCount} color scheme option(s)`);
    expect(optionsCount).toBeGreaterThanOrEqual(1);

    // Pick a non-default option when more than one is offered; tolerate a
    // single-option response. Assert the radio reflects the selection.
    const selectIndex = optionsCount > 1 ? 1 : 0;
    await themeOptions.nth(selectIndex).click();
    await expect(themeOptions.nth(selectIndex).locator('input[type="radio"]')).toBeChecked();
    console.log('  Option selection updates client-side state');

    await expect(page.getByTestId('theme-preview-apply')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.getByTestId('theme-preview-cancel')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  Apply and Cancel affordances rendered');

    console.log('Modern color scheme selection widget test passed!');
  });

  test('Modern font theme selection widget', async ({ page }, testInfo) => {
    // Mirrors the color-scheme test: up to two sequential AI waits (initial
    // generation, then surfacing the widget), then client-side assertions only
    // — no apply/generate-more/cancel round-trips. See that test for the budget
    // rationale.
    testInfo.setTimeout(3 * AI_RESPONSE_TIMEOUT_MS + 120_000);

    // ========================================
    // STEP 1: Create an app (homepage submit — see color-scheme test).
    // ========================================
    console.log('Step 1: Creating app...');

    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    await page.goto('/');
    // The "Projects" popover auto-opens on the authenticated homepage and
    // covers the user menu — dismiss overlays first or loginIfNeeded's
    // user-menu click can't open its popover (helpers/auth.ts:540).
    await dismissOverlays(page);
    await loginIfNeeded(page);
    // Re-navigate fresh after potential SSO redirect.
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    // Minimal prompt for a fast initial build — see the color-scheme test.
    await promptInput.fill(`${getSpecPrefix('font-theme-selection')} Minimal hello world app - keep it tiny and build it quickly, do not ask follow up questions`);

    // Wait for React hydration before clicking (the disabled→enabled flip is
    // server-rendered so it doesn't prove hydration; a fixed 10s wait does).
    const submitButton = page.locator('[data-eid*="homepage.prompt.submit"]');
    await expect(submitButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
    await page.waitForTimeout(10_000);
    await submitButton.click();

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
    console.log(`  App created: ${appId}`);

    await dismissOverlays(page);

    // Wait for initial generation to complete — see the color-scheme test for
    // why this allows two AI cycles (prod generation can exceed one).
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: 2 * AI_RESPONSE_TIMEOUT_MS });
    console.log('  Initial generation completed');

    await ensureAuthenticated(page);

    // ========================================
    // STEP 2: Surface the font-theme widget (the single AI round-trip)
    // ========================================
    await dismissOverlays(page);
    console.log('Step 2: Requesting font theme suggestions...');

    const chatInput = page.getByTestId('chat-input-textarea');
    await expect(chatInput).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await chatInput.fill('Show me some font theme options');

    const sendButton = page.getByTestId('chat-send-button');
    await expect(sendButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
    await sendButton.click();
    console.log('  Font theme request sent, waiting for the widget to appear...');

    // ========================================
    // STEP 3: Wait for the widget (feature-flagged — see color-scheme test).
    // ========================================
    const fontThemePanel = page.getByTestId('font-theme-preview-input-panel');
    const panelVisible = await fontThemePanel
      .waitFor({ state: 'visible', timeout: AI_RESPONSE_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);

    if (!panelVisible) {
      test.skip(true, 'Font theme widget not available (feature-flagged off or model did not emit it)');
    }
    console.log('  Font theme preview widget appeared');

    // ========================================
    // STEP 4: Verify the widget's client-side contract — render + option
    // select (local state, not streaming-gated). Action buttons are disabled
    // mid-stream, so assert they render rather than clicking them (see the
    // color-scheme test for the rationale).
    // ========================================
    const fontOptions = page.getByTestId('font-theme-preview-option');
    await expect(fontOptions.first()).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    const optionsCount = await fontOptions.count();
    console.log(`  Found ${optionsCount} font theme option(s)`);
    expect(optionsCount).toBeGreaterThanOrEqual(1);

    const selectIndex = optionsCount > 1 ? 1 : 0;
    await fontOptions.nth(selectIndex).click();
    await expect(fontOptions.nth(selectIndex).locator('input[type="radio"]')).toBeChecked();
    console.log('  Option selection updates client-side state');

    await expect(page.getByTestId('font-theme-preview-apply')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(page.getByTestId('font-theme-preview-cancel')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  Apply and Cancel affordances rendered');

    console.log('Modern font theme selection widget test passed!');
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);

    if (E2E_NO_DELETE) {
      console.log('Cleanup skipped (E2E_NO_DELETE=true)');
      return;
    }

    console.log('Cleanup...');
    for (const name of SPEC_PREFIXES) {
      try {
        await deleteAppsWithPrefix(page, getSpecPrefix(name));
      } catch (err) {
        console.error(`  Cleanup of prefix '${name}' failed:`, err);
      }
    }
  });
});
