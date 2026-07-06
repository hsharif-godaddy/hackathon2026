/**
 * Authentication E2E Tests (Single Flow)
 *
 * Two main flows:
 * 1. Authenticated flow - tests logged-in user experience
 * 2. Unauthenticated flow - tests logged-out user experience
 *
 * Each flow runs as a single continuous test with one login/no-login.
 */
import { test, expect } from '../helpers/test-fixtures';

import { clearAuthState, detectSsoType, loginViaSsoDirect, openUserMenu, userMenuTrigger, verifyAuthenticated } from '../helpers/auth';
import { LONG_TIMEOUT, DEFAULT_TIMEOUT } from '../helpers/constants';
import { logTestResult, logTestStart, submitHomepage } from '../helpers/ui';

test.describe('Authentication', () => {
  test.beforeEach(async ({}, testInfo) => {
    logTestStart(testInfo);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);
  });

  /**
   * AUTHENTICATED FLOW
   * Tests all authenticated user scenarios in one continuous session
   */
  test('Logged-In User - SSO Login, Session, Menu & Sign Out', async ({ page, context }) => {
    // ========================================
    // STEP 1: Login and verify homepage
    // ========================================
    console.log('🔐 Step 1: Logging in...');
    await loginViaSsoDirect(page);

    await page.goto('/');
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    console.log('✅ Logged in successfully');

    // ========================================
    // STEP 2: Verify authenticated homepage
    // ========================================
    console.log('🏠 Step 2: Verifying authenticated homepage...');
    await expect(page.getByTestId('airo-header')).toBeVisible();
    await verifyAuthenticated(page);
    console.log('  ✓ User menu shows Sign Out (authenticated)');

    // ========================================
    // STEP 3: Check apps dropdown (if user has apps)
    // ========================================
    console.log('📱 Step 3: Checking apps dropdown...');
    const appsMenuItem = page.locator('[data-eid*="apps_menu.app"]').first();
    if (await appsMenuItem.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(page.locator('[data-eid*="apps_menu.see_all"]')).toBeVisible();
      console.log('  ✓ Apps menu visible with See All button');

      // Test See All navigation
      await page.locator('[data-eid*="apps_menu.see_all"]').click();
      await expect(page).toHaveURL(/\/apps/);
      await expect(page.getByTestId('projects-page-title')).toBeVisible();
      console.log('  ✓ See All navigates to /apps');
    } else {
      console.log('  ⚠ No apps menu (user has no apps)');
    }

    // ========================================
    // STEP 4: Session persistence across navigation
    // ========================================
    console.log('🔄 Step 4: Testing session persistence...');
    await page.goto('/');
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });

    await page.goto('/apps');
    await expect(page.getByTestId('projects-page-title')).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    await page.goto('/');
    await verifyAuthenticated(page);
    console.log('  ✓ Session persists across navigations');

    // ========================================
    // STEP 5: Protected content after refresh
    // ========================================
    console.log('🔃 Step 5: Testing protected content after refresh...');
    await page.goto('/apps');
    await expect(page.getByTestId('projects-page-title')).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    await page.reload();
    await expect(page.getByTestId('projects-page-title')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  ✓ Protected content persists after refresh');

    // ========================================
    // STEP 6: Invalid auth triggers SSO via ProtectedRoute
    // ========================================
    // In the new auth model (Gasket Auth as single source of truth), SSO is
    // triggered when AuthRequired sees invalid authState and renders its
    // `alt` = SsoLoginPrompt, which calls useSsoSignIn().signIn() on mount.
    // signIn() branches by env (see useSsoSignIn.ts):
    //   - prod / local dev: open SSO Deck iframe modal in-place
    //   - deployed test/dev: full-page redirect to login URL (PNA blocks
    //     the iframe since the SSO host is a private IP)
    // The old AuthBoundary "Sign In Required" fallback is gone.
    console.log('🔓 Step 6: Testing invalid-auth SSO trigger via ProtectedRoute...');

    await page.route('**/api/auth/validate*', (route) => {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized', authReason: 2 }),
      });
    });

    // Navigate to a protected route. AuthRequired polls /api/auth/validate,
    // sees 401, renders SsoLoginPrompt, which triggers the env-appropriate
    // SSO path.
    await page.goto('/apps');

    // Detect SSO trigger. Three env-dependent outcomes:
    //   'modal'    - prod (post-29-Apr-2026): GoDaddy universal sign-in
    //                rendered directly in parent page DOM
    //   'iframe'   - legacy SsoDeck cross-origin iframe (kept as fallback)
    //   'redirect' - deployed test/dev: browser navigates to login URL
    // Match both the legacy named iframe and the post-29-Apr-2026 generic
    // `<dialog>`-wrapped unnamed iframe in a single locator.
    const ssoIframe = page.locator('iframe[title="Container for sign in"], [role="dialog"] iframe').first();
    const ssoModal = page.locator('.sso-login-modal');

    const authUiState = await detectSsoType(page, false, DEFAULT_TIMEOUT);

    // detectSsoType called with includeAuthenticatedCheck=false returns null
    // (never 'timeout') when no SSO surface appears within the timeout, so
    // a single not-null assertion covers both no-match and miss cases.
    expect(authUiState, 'Expected SSO iframe/modal or redirect to login URL').not.toBeNull();
    console.log(`  [6a] Auth UI detected: ${authUiState}`);

    // Clean up the mock before returning. The 401 was only mocked client-side,
    // so the real session is still valid and the server will authenticate us.
    await page.unroute('**/api/auth/validate*');

    if (authUiState === 'iframe' || authUiState === 'modal') {
      // Dismiss SSO - should close the modal with no fallback (AuthBoundary gone).
      const closeButton = page.getByRole('button', { name: /close/i });
      if (await closeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await closeButton.click();
      } else {
        await page.mouse.click(10, 10);
      }
      const ssoSurface = authUiState === 'iframe' ? ssoIframe : ssoModal;
      await expect(ssoSurface).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  [6b] SSO Deck dismissed (no fallback modal in new flow)');
    } else {
      // Redirect mode: browser is on the SSO login page. Navigate back to the
      // app; real session is still valid so /api/auth/validate now returns OK.
      console.log('  [6b] Full-page redirect to login URL (deployed test/dev env)');
    }

    await page.goto('/');
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    console.log('  ✓ Invalid-auth SSO trigger verified');

    // ========================================
    // STEP 7: Sign out
    // ========================================
    console.log('🚪 Step 7: Testing sign out...');
    await page.goto('/');
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    console.log(`  [7.1] Homepage loaded, url=${page.url()}`);

    await openUserMenu(page);
    console.log('  [7.2] User menu opened');

    const signOutLocator = page.getByTestId('user-menu-item-sign-out');
    await expect(signOutLocator).toBeVisible();
    console.log('  [7.3] Sign Out button visible');

    // noWaitAfter: sign-out triggers a cross-origin redirect (SSO/godaddy.com)
    // that Playwright's auto-wait-for-navigation can't resolve, causing a 30s hang.
    await signOutLocator.click({ force: true, noWaitAfter: true });
    console.log('  [7.4] Sign Out clicked');

    await page.waitForURL(
      (url) => url.href.includes('sso') || url.href.includes('logout') || url.href.includes('godaddy.com'),
      { timeout: DEFAULT_TIMEOUT }
    );
    console.log(`  [7.5] Post sign-out url=${page.url()}`);
    console.log('  ✓ Sign out redirects to SSO/logout');

    console.log('🎉 Authenticated flow complete!');
  });

  /**
   * UNAUTHENTICATED FLOW
   * Tests all unauthenticated user scenarios in one continuous session
   */
  test('Guest User — unauthenticated homepage, user-menu Sign In, and SSO trigger', async ({ page, context }) => {
    // Clear any existing auth state
    await clearAuthState(context);

    // ========================================
    // STEP 1: Homepage without auth
    // ========================================
    console.log('🏠 Step 1: Checking unauthenticated homepage...');
    await page.goto('/');
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    console.log('  ✓ Homepage loaded');

    // SSO modal should NOT appear on initial load
    await expect(page.locator('iframe[src*="sso"]')).not.toBeVisible();
    console.log('  ✓ Homepage loads without SSO modal');

    // ========================================
    // STEP 2: Sign In option in user menu
    // ========================================
    console.log('👤 Step 2: Checking user menu (unauthenticated)...');
    const menuTrigger = userMenuTrigger(page);
    await menuTrigger.click({ force: true });
    await page.getByTestId('user-menu-item-sign-in').waitFor({ state: 'visible', timeout: 5000 });
    console.log('  ✓ Sign In option visible in user menu');
    await page.click('body', { position: { x: 0, y: 0 } });

    // ========================================
    // STEP 3: Apps menu NOT visible when unauthenticated
    // ========================================
    console.log('📱 Step 3: Checking apps menu (should be hidden)...');
    await expect(page.locator('[data-eid*="apps_menu.app"]')).not.toBeVisible();
    console.log('  ✓ Apps menu hidden for unauthenticated user');

    // ========================================
    // STEP 4: SSO triggers on Sign In click
    // ========================================
    console.log('🔐 Step 4: Testing Sign In button triggers SSO...');
    await menuTrigger.click({ force: true });
    await page.getByTestId('user-menu-item-sign-in').click();

    // SSO can appear as the post-29-Apr-2026 in-page modal (prod), the legacy
    // SsoDeck cross-origin iframe, the new <dialog>-wrapped unnamed iframe,
    // or a full-page redirect (deployed test/dev). Use the shared detector
    // so this stays in sync with handleSsoLogin and Steps 5/6 below.
    const ssoAppeared = await detectSsoType(page, false, DEFAULT_TIMEOUT);

    if (ssoAppeared === 'iframe' || ssoAppeared === 'modal') {
      console.log('  ✓ SSO modal/iframe appears');
    } else if (ssoAppeared === 'redirect') {
      console.log('  ✓ Redirected to SSO page');
    } else {
      throw new Error(`SSO did not appear (got: ${ssoAppeared})`);
    }

    // Go back to homepage for next test
    await page.goto('/');
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });

    // ========================================
    // STEP 5: SSO triggers on app creation attempt
    // ========================================
    console.log('📝 Step 5: Testing SSO on app creation...');
    await page.getByTestId('homepage-prompt-input').fill('A simple page that displays hello world');
    await submitHomepage(page);

    // SSO can appear as the post-29-Apr-2026 in-page modal (prod), the legacy
    // cross-origin SsoDeck iframe, or a full-page redirect (deployed test/dev
    // where PNA blocks the iframe). Use the shared detector so this stays in
    // sync with handleSsoLogin and the e2e suite.
    const ssoOnSubmit = await detectSsoType(page, false, DEFAULT_TIMEOUT);

    if (ssoOnSubmit === 'iframe' || ssoOnSubmit === 'modal') {
      console.log('  ✓ SSO modal appears on submit');
    } else if (ssoOnSubmit === 'redirect') {
      console.log('  ✓ Redirected to SSO on submit');
    } else {
      throw new Error(`SSO did not appear on submit (got: ${ssoOnSubmit})`);
    }

    // ========================================
    // STEP 6: Protected route /apps
    // ========================================
    console.log('🔒 Step 6: Testing protected route /apps...');
    await page.goto('/apps');
    await page.waitForLoadState('domcontentloaded');

    // Unauthenticated access to a protected route must trigger SSO (full-page
    // redirect or in-page surface). Soft-assert the gate — the old body-text
    // check keyed on "Sign In" (always in the header menu), so it never failed.
    const appsSsoSurface = page
      .locator('iframe[title="Container for sign in"], [role="dialog"] iframe, .sso-login-modal')
      .first();
    const appsGated = await Promise.race([
      page.waitForURL(/sso|login|sign-in|auth/i, { timeout: DEFAULT_TIMEOUT }).then(() => true).catch(() => false),
      appsSsoSurface.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT }).then(() => true).catch(() => false),
    ]);
    expect.soft(appsGated, 'Step 6: protected /apps should gate an unauthenticated user (SSO redirect or SSO surface)').toBe(true);

    // ========================================
    // STEP 7: Protected route /develop
    // ========================================
    console.log('🔒 Step 7: Testing protected route /develop...');
    await page.goto('/develop/test-123');
    await page.waitForLoadState('domcontentloaded');

    // Same SSO gate as Step 6 (redirect or in-page surface), soft-asserted.
    const developSsoSurface = page
      .locator('iframe[title="Container for sign in"], [role="dialog"] iframe, .sso-login-modal')
      .first();
    const developGated = await Promise.race([
      page.waitForURL(/sso|login|sign-in|auth/i, { timeout: DEFAULT_TIMEOUT }).then(() => true).catch(() => false),
      developSsoSurface.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT }).then(() => true).catch(() => false),
    ]);
    expect.soft(developGated, 'Step 7: protected /develop should gate an unauthenticated user (SSO redirect or SSO surface)').toBe(true);

    // ========================================
    // STEP 8: Auth API error handling
    // ========================================
    console.log('⚠️ Step 8: Testing auth API error handling...');
    await page.route('**/api/auth/**', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal Server Error' }),
      });
    });

    await page.goto('/');
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    console.log('  ✓ Homepage loads despite auth API error');

    console.log('🎉 Unauthenticated flow complete!');
  });
});
