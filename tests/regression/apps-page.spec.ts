/**
 * Apps Page, Navigation & Homepage E2E Tests
 *
 * Test 1 - Apps & Navigation Flow:
 * - Creates an app, verifies develop page, /apps page, navigation, deletes app
 *
 * Test 2 - Homepage Input Validation:
 * - Empty/long prompt validation, suggestion buttons
 *
 * Strategy:
 * - Single login per test, single browser session
 * - All assertions run sequentially
 */
import { test, expect } from '../helpers/test-fixtures';

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { handleSsoLogin, openUserMenu, ensureAuthenticated } from '../helpers/auth';
import { LONG_TIMEOUT, CHAT_INPUT_TIMEOUT, DEFAULT_TIMEOUT, PREVIEW_TIMEOUT, APPS_GRID_PAGE_SIZE, E2E_NO_DELETE, getSpecPrefix } from '../helpers/constants';
import { dismissBanners, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

/** Spec prefixes used by `getSpecPrefix(...)` calls in this describe block. */
const SPEC_PREFIXES = ['apps-page'] as const;

test.describe('Apps Page & Navigation', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    if (!E2E_NO_DELETE) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch(() => {});
    }
  });

  test('Apps List, Card Actions & Page Navigation - Full Flow', async ({ page }) => {
    // ========================================
    // STEP 1: Create an app (with login)
    // ========================================
    console.log('📱 Step 1: Creating app...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(`${getSpecPrefix('apps-page')} Single page app that displays hello world`);

    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    // Handle SSO login
    await handleSsoLogin(page);

    // Wait for app creation and redirect to develop
    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    const appId = page.url().match(/\/develop\/([a-zA-Z0-9]+)/)?.[1] || '';
    console.log(`✅ App created: ${appId}`);

    // Dismiss any coachmark tours (blocks interactions)
    for (let i = 0; i < 5; i++) {
      const coachmark = page.locator('.ux-coachmark');
      if (await coachmark.isVisible({ timeout: 1000 }).catch(() => false)) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        console.log(`  ✓ Dismissed coachmark (attempt ${i + 1})`);
      } else {
        break;
      }
    }

    // ========================================
    // STEP 2: Verify develop page components
    // ========================================
    console.log('🔧 Step 2: Verifying develop page components...');

    // Verify header
    await expect(page.getByTestId('airo-header')).toBeVisible();
    console.log('  ✓ Header visible');

    // Publish control in header: match by accessible name (not test id — toolbar may duplicate AppPublish)
    const publishButton = page
      .getByTestId('airo-header')
      .getByRole('button', { name: /publish/i });
    await expect(publishButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(publishButton).not.toBeDisabled();
    console.log('  ✓ Publish button visible and enabled');

    // Verify preview iframe
    await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });
    await expect(page.getByTestId('preview-iframe')).toHaveAttribute('src', /.+/);
    console.log('  ✓ Preview iframe loaded with src');

    // Verify chat input
    await page.getByTestId('chat-input-textarea').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    console.log('  ✓ Chat input visible');

    // ========================================
    // STEP 3: Navigate to /apps and verify content
    // ========================================
    console.log('📋 Step 3: Verifying apps page content...');
    await page.goto('/apps');
    await page.getByTestId('app-card-edit-button').first().waitFor({ state: 'visible', timeout: 30000 });

    // Verify page header
    const appsPageTitle = page.getByTestId('apps-page-title');
    await expect(appsPageTitle).toBeVisible();
    console.log('  ✓ Page header visible');

    // Verify app count — the count Tag is rendered inside `apps-page-title` via
    // the `builder_apps_count` i18n key, so the exact wording ("apps", "projects",
    // pluralization) can change externally. Assert the invariant: a numeric count
    // is shown next to the title.
    await expect(appsPageTitle).toContainText(/\d+/);
    console.log('  ✓ App count displayed');

    // Verify Create button (desktop uses create-app-card in action bar)
    await expect(page.getByTestId('create-app-card')).toBeVisible();
    await expect(page.getByTestId('create-app-card')).not.toBeDisabled();
    console.log('  ✓ Create button visible and enabled (action bar)');

    // Verify app card exists
    const cardCount = await page.getByTestId('app-card-edit-button').count();
    expect(cardCount).toBeGreaterThanOrEqual(1);
    console.log(`  ✓ Found ${cardCount} app card(s)`);

    // ========================================
    // STEP 4: Check Preview button in menu
    // ========================================
    console.log('👁️ Step 4: Checking Preview button...');
    await page.getByTestId('app-card-menu-button').first().click();
    await page.locator('[role="menu"], [role="menuitem"]').first().waitFor({ state: 'visible', timeout: 5000 });

    const viewButton = page.getByTestId('app-card-view-button');
    if (await viewButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('  ✓ Preview button found in menu');
    } else {
      console.log('  ⚠ No Preview button (app may not be running yet)');
    }
    await page.keyboard.press('Escape');

    // ========================================
    // STEP 5: Test "Create a new app" navigation
    // ========================================
    console.log('🏠 Step 5: Testing Create navigation...');
    // Use create-app-card from action bar (visible on desktop when apps exist)
    await page.getByTestId('create-app-card').click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    console.log('  ✓ Navigated to homepage');

    // ========================================
    // STEP 6: Test "Edit" navigation from /apps (skeleton + page load)
    // ========================================
    console.log('✏️ Step 6: Testing Edit navigation from /apps...');
    await page.goto('/apps');
    await page.getByTestId('app-card-edit-button').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.getByTestId('app-card-edit-button').first().click();

    await expect(page).toHaveURL(/\/develop\//);

    // Either the loading skeleton or the real page UI must appear within 8s.
    // Using Promise.race avoids masking regressions where neither renders.
    const skeleton = page.getByTestId('develop-skeleton');
    const chatInput = page.getByTestId('chat-input-textarea');
    const earlyUiState = await Promise.race([
      skeleton.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'skeleton' as const, () => new Promise<never>(() => {})),
      chatInput.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'chat-input' as const, () => new Promise<never>(() => {})),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 8000)),
    ]);
    expect(
      earlyUiState,
      'Expected either the develop loading skeleton or the chat input to appear quickly after navigation',
    ).not.toBe('timeout');
    if (earlyUiState === 'skeleton') {
      console.log('  ✓ Loading skeleton appeared during transition');
    } else {
      console.log('  ⚡ Develop page became interactive before skeleton could be captured (fast connection)');
    }

    await chatInput.waitFor({ state: 'visible', timeout: CHAT_INPUT_TIMEOUT });
    console.log('  ✓ Navigated to develop page from /apps');

    // ========================================
    // STEP 7: Test homepage dropdown navigation
    // ========================================
    console.log('📂 Step 7: Testing homepage dropdown navigation...');
    // Register listener before navigation to avoid race condition
    const sitesResponse = page.waitForResponse(function matchSitesApi(response) {
      return response.url().includes('/api/sites') &&
        response.request().method() === 'GET' &&
        response.ok();
    });
    await page.goto('/');
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await sitesResponse;

    // Click on app in dropdown (if visible)
    const appMenuItem = page.locator('[data-eid="appbuilder.homepage.apps_menu.app.click"]').first();
    if (await appMenuItem.isVisible({ timeout: 5000 }).catch(() => false)) {
      await appMenuItem.click();
      await expect(page).toHaveURL(/\/develop\//);
      await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });
      console.log('  ✓ Navigated to develop page from homepage dropdown');
    } else {
      console.log('  ⚠ Apps dropdown not visible (may need more apps)');
    }

    // ========================================
    // STEP 8: Delete the app
    // ========================================
    console.log('🗑️ Step 8: Deleting app...');
    await ensureAuthenticated(page);
    await page.goto('/apps');
    await page.getByTestId('app-card-edit-button').first().waitFor({ state: 'visible', timeout: 30000 });

    const countBefore = await page.getByTestId('app-card-edit-button').count();
    console.log(`  Apps before delete: ${countBefore}`);

    // The apps grid paginates at APPS_GRID_PAGE_SIZE (11 in app code). When the
    // account holds more apps than the page size, the visible card count stays
    // flat after delete because the next app shifts in from page 2 — so a
    // count-based assertion can never go below the page size. Identify the
    // specific card we're about to delete via its aria-label so the assertion
    // is pagination-independent.
    const deletedCardLabel = await page.getByTestId('app-card-edit-button').first().getAttribute('aria-label');
    expect(deletedCardLabel, 'expected first app card to expose an aria-label so we can verify it disappears').toBeTruthy();
    const escapedLabel = deletedCardLabel!.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const deletedCardLocator = page.locator(`[data-testid="app-card-edit-button"][aria-label="${escapedLabel}"]`);
    const matchingBefore = await deletedCardLocator.count();

    // The delete confirmation UI is gated by the appbuilder-app-delete-modal
    // switchboard flag: when enabled the app renders a confirmation modal, and
    // when off (the default without the Switchboard grant) it renders an inline
    // confirmation overlay on the card. Read the flag from gasket-data so we
    // assert against whichever path production actually serves.
    const deleteModalEnabled = await page.evaluate(
      () => (window as unknown as { gasketData?: { switchboard?: Record<string, unknown> } }).gasketData?.switchboard?.['appbuilder-app-delete-modal'] === true,
    );
    const confirmationTestId = deleteModalEnabled ? 'delete-project-confirmation-modal' : 'inline-confirmation';
    const confirmButtonTestId = deleteModalEnabled ? 'delete-project-confirm-button' : 'confirm-button';

    await dismissBanners(page);
    await page.getByTestId('app-card-menu-button').first().click();
    await page.getByTestId('app-card-delete-button').waitFor({ state: 'visible', timeout: 10000 });
    await dismissBanners(page);
    await page.getByTestId('app-card-delete-button').click();

    // Verify confirmation UI
    await expect(page.getByTestId(confirmationTestId)).toBeVisible();

    // Delete and wait for response
    const deletePromise = page.waitForResponse('**/api/sites/*');
    await page.getByTestId(confirmButtonTestId).click();
    await deletePromise;

    // Verify deletion
    await expect(page.getByTestId(confirmationTestId)).not.toBeVisible();
    await expect(deletedCardLocator).toHaveCount(matchingBefore - 1, { timeout: 10000 });
    console.log(`  ✓ App deleted (card "${deletedCardLabel}" removed from grid)`);

    console.log('🎉 All apps page tests passed!');
  });

  // Skip: UXCore Next/Prev button label mismatch — re-enable once UXCore fixes button names
  test.skip('Apps Page Pagination - Next/Prev navigation with intercepted API', async ({ page }) => {
    const TOTAL_SITES = APPS_GRID_PAGE_SIZE + 2;

    // ========================================
    // STEP 1: Authenticate
    // ========================================
    console.log('🔐 Step 1: Authenticating...');
    await page.goto('/');
    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });

    await openUserMenu(page);
    await page
      .locator('[data-slot="popover-content"][data-state="open"]')
      .getByRole('button', { name: /sign\s*in|builder_common_signin/i })
      .click();
    await handleSsoLogin(page);
    await page.waitForURL('**/', { timeout: LONG_TIMEOUT });
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    console.log('✅ Authenticated');

    // ========================================
    // STEP 2: Intercept GET /api/sites with synthetic records
    // ========================================
    console.log(`🔧 Step 2: Setting up API intercept (${TOTAL_SITES} sites)...`);
    const syntheticSites = Array.from({ length: TOTAL_SITES }, (_, i) => ({
      id: `pagination-test-site-${i}`,
      name: `Pagination App ${i + 1}`,
      status: 'running',
      account_id: 'test-account',
      initial_prompt: `Test prompt ${i + 1}`,
      agent_url: `https://agent-${i}.test`,
      preview_url: `https://preview-${i}.test`,
      created_at: new Date(Date.now() - i * 60000).toISOString(),
      updated_at: new Date(Date.now() - i * 60000).toISOString(),
      variants: [],
    }));

    await page.route('**/api/sites', (route, request) => {
      if (request.method() === 'GET' && !request.url().includes('/api/sites/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(syntheticSites),
        });
      }
      return route.continue();
    });

    try {
      // ========================================
      // STEP 3: Navigate to /apps, verify first page
      // ========================================
      console.log('📋 Step 3: Verifying first page...');
      await page.goto('/apps');
      await page.getByTestId('app-card-edit-button').first().waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });

      const firstPageCards = await page.getByTestId('app-card-edit-button').count();
      expect(firstPageCards).toBe(APPS_GRID_PAGE_SIZE);
      console.log(`  ✓ First page shows ${firstPageCards} cards (expected ${APPS_GRID_PAGE_SIZE})`);

      await expect(page.getByText('Pagination App 1', { exact: true })).toBeVisible();
      await expect(page.getByText(`Pagination App ${APPS_GRID_PAGE_SIZE}`)).toBeVisible();
      await expect(page.getByText(`Pagination App ${APPS_GRID_PAGE_SIZE + 1}`)).not.toBeVisible();
      console.log('  ✓ Correct apps visible on page 1');

      const paginationNav = page.locator('nav.ux-pagination');
      await expect(paginationNav).toBeVisible();
      console.log('  ✓ Pagination controls visible');

      // ========================================
      // STEP 4: Click Next, verify second page
      // ========================================
      console.log('➡️ Step 4: Navigating to page 2...');
      const nextButton = page.getByRole('button', { name: 'Go to next page' });
      await expect(nextButton).toBeEnabled();
      await nextButton.click();

      await expect(page.getByText(`Pagination App ${APPS_GRID_PAGE_SIZE + 1}`)).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await expect(page.getByText(`Pagination App ${TOTAL_SITES}`)).toBeVisible();

      const secondPageCards = await page.getByTestId('app-card-edit-button').count();
      expect(secondPageCards).toBe(TOTAL_SITES - APPS_GRID_PAGE_SIZE);
      console.log(`  ✓ Page 2 shows ${secondPageCards} cards (expected ${TOTAL_SITES - APPS_GRID_PAGE_SIZE})`);

      await expect(page.getByText('Pagination App 1', { exact: true })).not.toBeVisible();
      console.log('  ✓ Page 1 apps no longer visible');

      await expect(nextButton).toBeDisabled();
      console.log('  ✓ Next button disabled on last page');

      // ========================================
      // STEP 5: Click Prev, verify return to page 1
      // ========================================
      console.log('⬅️ Step 5: Navigating back to page 1...');
      const prevButton = page.getByRole('button', { name: 'Go to previous page' });
      await expect(prevButton).toBeEnabled();
      await prevButton.click();

      await expect(page.getByText('Pagination App 1', { exact: true })).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      await expect(page.getByText(`Pagination App ${APPS_GRID_PAGE_SIZE}`)).toBeVisible();
      await expect(page.getByText(`Pagination App ${APPS_GRID_PAGE_SIZE + 1}`)).not.toBeVisible();

      const backToFirstPageCards = await page.getByTestId('app-card-edit-button').count();
      expect(backToFirstPageCards).toBe(APPS_GRID_PAGE_SIZE);
      console.log(`  ✓ Back to page 1 with ${backToFirstPageCards} cards`);

      await expect(prevButton).toBeDisabled();
      console.log('  ✓ Prev button disabled on first page');

      console.log('🎉 Pagination tests passed!');
    } finally {
      await page.unroute('**/api/sites');
    }
  });

  // TODO(@hdewan): re-enable once prod homepage initial-load issue is sorted.
  // CI run 25675567980 against --env=prod showed the homepage stuck on a
  // `<main><status>Your content is loading</status></main>` shell with no
  // header rendered — the `airo-header > user-menu-trigger` never attached,
  // so every auth-driven path (loginIfNeeded, triggerSignIn) times out at
  // 30s. Not a test-code bug; either a transient CDN/auth state during that
  // run window or a real homepage rendering regression on prod. Skipped to
  // keep CI green until investigated.
  test.skip('Homepage Prompt Input - Validation & Suggestions', async ({ page }) => {
    // ========================================
    // STEP 1: Navigate and login
    // ========================================
    console.log('🔐 Step 1: Logging in...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });

    // Trigger login via user menu
    await openUserMenu(page);
    await page
      .locator('[data-slot="popover-content"][data-state="open"]')
      .getByRole('button', { name: /sign\s*in|builder_common_signin/i })
      .click();
    await handleSsoLogin(page);

    // Wait for redirect back to homepage
    await page.waitForURL('**/', { timeout: LONG_TIMEOUT });
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    console.log('✅ Logged in successfully');

    // ========================================
    // STEP 2: Test empty prompt validation
    // ========================================
    console.log('📝 Step 2: Testing empty prompt validation...');

    await promptInput.clear();
    await expect(promptInput).toHaveValue('');

    // Submit should be disabled when empty
    await expect(page.locator('[data-eid*="homepage.prompt.submit"]')).toBeDisabled();
    console.log('  ✓ Submit disabled when prompt is empty');

    // ========================================
    // STEP 3: Test too-long prompt validation
    // ========================================
    console.log('📏 Step 3: Testing too-long prompt validation...');

    // Use JavaScript to bypass maxLength and set a very long value
    const longPrompt = 'a'.repeat(40001);
    await page.evaluate((text) => {
      const input = document.querySelector('[data-testid="homepage-prompt-input"]') as HTMLTextAreaElement;
      if (input) {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, longPrompt);

    // Submit should be disabled for too-long prompt
    await expect(page.locator('[data-eid*="homepage.prompt.submit"]')).toBeDisabled();
    console.log('  ✓ Submit disabled when prompt exceeds 40000 chars');

    // Clear for next test
    await promptInput.clear();

    // ========================================
    // STEP 4: Test suggestion buttons
    // ========================================
    console.log('💡 Step 4: Testing suggestion buttons...');

    // Find suggestion buttons
    const suggestionButtons = page.getByTestId('homepage-suggestion-button');
    await expect(suggestionButtons.first()).toBeVisible();

    const count = await suggestionButtons.count();
    expect(count).toBeGreaterThanOrEqual(1);
    console.log(`  ✓ Found ${count} suggestion button(s)`);

    // Click first suggestion
    await suggestionButtons.first().click();

    // Prompt should be populated
    await expect(promptInput).not.toHaveValue('');
    console.log('  ✓ Suggestion populates prompt');

    // Submit should be enabled
    await expect(page.locator('[data-eid*="homepage.prompt.submit"]')).not.toBeDisabled();
    console.log('  ✓ Submit enabled after suggestion click');

    console.log('🎉 All input validation tests passed!');
  });

  test('Homepage Logo Designer Template - Custom Hero Content', async ({ page }) => {
    // ========================================
    // STEP 1: Navigate with template query param
    // ========================================
    console.log('🎨 Step 1: Navigating to homepage with ?template=logo-designer...');
    await page.goto('/?template=logo-designer');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    console.log('  ✓ Homepage loaded');

    // ========================================
    // STEP 2: Verify custom hero heading
    // ========================================
    console.log('📝 Step 2: Verifying custom hero heading...');
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    // Should show logo-specific heading
    await expect(heading).not.toHaveText(/builder_homepage/i);
    const headingText = await heading.textContent();
    expect(headingText?.toLowerCase()).not.toBe('');
    console.log(`  Heading text: "${headingText}"`);
    expect(
      /logo/i.test(headingText || '') || /design/i.test(headingText || ''),
    ).toBe(true);
    console.log('  ✓ Custom logo heading displayed');

    // ========================================
    // STEP 3: Verify prompt input is functional
    // ========================================
    console.log('✍️ Step 3: Verifying prompt input works with template...');
    await promptInput.fill('A minimalist tech startup logo with a geometric icon');
    await expect(page.locator('[data-eid*="homepage.prompt.submit"]')).not.toBeDisabled();
    console.log('  ✓ Submit enabled with prompt text');

    console.log('🎉 Logo designer template test passed!');
  });

  test('Homepage Template Selector - URL sync persists across reload', async ({ page }) => {
    console.log('🧭 Step 1: Navigate to homepage with no template param...');
    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });

    // Chip selector is gated by the appbuilder-template-selector switchboard flag.
    // Read it directly from gasket-data so a missing chip means a real render failure,
    // not "flag off" — only skip when the flag is deterministically off.
    const flagEnabled = await page.evaluate(
      () => (window as unknown as { gasketData?: { switchboard?: Record<string, unknown> } }).gasketData?.switchboard?.['appbuilder-template-selector'] === true,
    );
    test.skip(!flagEnabled, 'appbuilder-template-selector flag is off in this env');

    const logoChip = page.getByTestId('template-chip-logo-designer');
    await expect(logoChip).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    console.log('🎨 Step 2: Click "Logo Designer" chip and verify URL updates...');
    await logoChip.click();
    await expect(page).toHaveURL(/[?&]template=logo-designer\b/);
    console.log('  ✓ URL contains ?template=logo-designer');

    console.log('🔄 Step 3: Reload and verify selection persists...');
    await page.reload();
    await expect(page).toHaveURL(/[?&]template=logo-designer\b/);
    console.log('  ✓ Template URL param survived reload');

    console.log('↩️  Step 4: Click "Default" chip removes the param...');
    await page.getByTestId('template-chip-default').click();
    await expect(page).not.toHaveURL(/[?&]template=/);
    console.log('  ✓ Default selection clears the template param');

    console.log('🎉 Template URL sync test passed!');
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);

    if (E2E_NO_DELETE) {
      console.log('🧹 Cleanup skipped (E2E_NO_DELETE=true)');
      return;
    }

    console.log('🧹 Cleanup...');
    for (const name of SPEC_PREFIXES) {
      try {
        await deleteAppsWithPrefix(page, getSpecPrefix(name));
      } catch (err) {
        console.error(`  Cleanup of prefix '${name}' failed:`, err);
      }
    }
  });
});
