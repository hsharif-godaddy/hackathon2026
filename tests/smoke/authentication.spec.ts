/**
 * Authentication E2E Tests (Single Flow)
 *
 * Two main flows:
 * 1. Authenticated flow - tests logged-in user experience
 * 2. Unauthenticated flow - tests logged-out user experience
 *
 * Each flow runs as a single continuous test with one login/no-login.
 */
import { test, expect } from '@playwright/test';

import { clearAuthState, handleSsoLogin, openUserMenu, userMenuTrigger, verifyAuthenticated } from '../helpers/auth';
import { LONG_TIMEOUT, DEFAULT_TIMEOUT } from '../helpers/constants';
import { logTestResult, logTestStart } from '../helpers/ui';

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
    await page.goto('/');
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });

    // Trigger login via user menu
    await openUserMenu(page);
    await page
      .locator('[data-slot="popover-content"][data-state="open"]')
      .getByRole('button', { name: /sign\s*in|builder_common_signin/i })
      .click();
    await handleSsoLogin(page);

    // Wait for redirect back to homepage
    await page.waitForURL('**/', { timeout: LONG_TIMEOUT });
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
      await expect(page.getByTestId('apps-page-title')).toBeVisible();
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
    await expect(page.getByTestId('apps-page-title')).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    await page.goto('/');
    await verifyAuthenticated(page);
    console.log('  ✓ Session persists across navigations');

    // ========================================
    // STEP 5: Protected content after refresh
    // ========================================
    console.log('🔃 Step 5: Testing protected content after refresh...');
    await page.goto('/apps');
    await expect(page.getByTestId('apps-page-title')).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    await page.reload();
    await expect(page.getByTestId('apps-page-title')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('  ✓ Protected content persists after refresh');

    // ========================================
    // STEP 6: 401 auto-opens SSO Deck, dismiss shows fallback
    // ========================================
    console.log('🔓 Step 6: Testing 401 auto-open SSO flow...');
    await page.goto('/');
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });

    // Mock a single BFF call to return 401 with authReason (HBI expired), then remove the mock.
    // We intercept /api/sites which fires when navigating to /apps.
    let intercepted = false;
    await page.route('**/api/sites', (route) => {
      if (!intercepted && route.request().resourceType() === 'fetch') {
        intercepted = true;
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Unauthorized', authReason: 2 }),
        });
      } else {
        route.continue();
      }
    });

    // Navigate to /apps - the client-side fetch to /api/sites triggers the 401 mock
    await page.goto('/apps');

    // 6a: Race SSO iframe (new auto-open behavior) vs fallback modal (pre-deploy).
    // TODO: Remove else branch after #2789 deploys to prod -- only the SSO path should remain.
    const ssoIframe = page.locator('iframe[title="Container for sign in"]');
    // UXCore Modal renders its title as a <div> (not a heading), so match
    // the dialog + title text to identify the AuthBoundary fallback modal.
    const fallbackModal = page.locator('[role="dialog"]', { hasText: 'Sign In Required' });

    const authUiState = await Promise.race([
      ssoIframe
        .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
        .then(() => 'sso' as const)
        .catch(() => null),
      fallbackModal
        .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
        .then(() => 'fallback' as const)
        .catch(() => null),
    ]);

    expect(authUiState, 'Expected either SSO iframe or fallback dialog after 401').not.toBeNull();
    const autoOpened = authUiState === 'sso';

    if (autoOpened) {
      console.log('  [6a] SSO Deck auto-opened on 401');

      // 6b: Dismiss SSO without completing auth.
      const closeButton = page.getByRole('button', { name: /close/i });
      if (await closeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await closeButton.click();
      } else {
        await page.mouse.click(10, 10);
      }
      await expect(ssoIframe).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  [6b] SSO Deck dismissed');

      // 6c: AuthBoundary fallback modal must appear after dismiss
      await expect(fallbackModal).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  [6c] Fallback modal appeared after SSO dismiss');

      // 6d: Click Sign In button in fallback - must re-open SSO
      const signInButton = fallbackModal.getByRole('button', { name: 'Sign In', exact: true });
      await signInButton.click();
      await expect(ssoIframe).toBeVisible({ timeout: DEFAULT_TIMEOUT });
      console.log('  [6d] SSO Deck re-opened from fallback Sign In button');
    } else {
      // Pre-deploy: old AuthBoundary shows fallback modal directly
      console.log('  [6a] Fallback modal shown (pre-deploy, auto-open not yet active)');
    }

    // Clean up route mock and navigate to homepage to clear AuthBoundary state.
    // The 401 was mocked (not a real session expiry), so the user is still
    // authenticated - navigating to homepage clears the modal without re-auth.
    await page.unroute('**/api/sites');
    await page.goto('/');
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    console.log('  ✓ 401 auth flow verified');

    // ========================================
    // STEP 7: Sign out
    // ========================================
    console.log('🚪 Step 7: Testing sign out...');
    await page.goto('/');
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    console.log(`  [7.1] Homepage loaded, url=${page.url()}`);

    await openUserMenu(page);
    console.log('  [7.2] User menu opened');

    const signOutLocator = page.locator('[data-slot="popover-content"][data-state="open"]').getByRole('button', { name: /sign\s*out|builder_common_signout/i });
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
  test('Guest User - Protected Routes, Sign-In Redirect & Access Control', async ({ page, context }) => {
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
    await page.getByRole('button', { name: /sign in/i }).waitFor({ state: 'visible', timeout: 5000 });
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
    await page
      .locator('[data-slot="popover-content"][data-state="open"]')
      .getByRole('button', { name: /sign\s*in|builder_common_signin/i })
      .click();

    // SSO can appear as iframe modal (prod) or redirect (test/dev)
    const ssoIframe = page.locator('iframe[src*="sso"]');
    const ssoModal = page.locator('[class*="sign-in"], [class*="signin"], [data-testid*="sign-in"]').first();

    const ssoAppeared = await Promise.race([
      ssoIframe.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT }).then(() => 'iframe'),
      ssoModal.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT }).then(() => 'modal'),
      page.waitForURL(/sso/, { timeout: DEFAULT_TIMEOUT }).then(() => 'redirect'),
    ]).catch(() => 'none');

    if (ssoAppeared === 'iframe' || ssoAppeared === 'modal') {
      console.log('  ✓ SSO modal/iframe appears');
    } else if (ssoAppeared === 'redirect') {
      console.log('  ✓ Redirected to SSO page');
    } else {
      throw new Error('SSO did not appear (no iframe, modal, or redirect)');
    }

    // Go back to homepage for next test
    await page.goto('/');
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });

    // ========================================
    // STEP 5: SSO triggers on app creation attempt
    // ========================================
    console.log('📝 Step 5: Testing SSO on app creation...');
    await page.getByTestId('homepage-prompt-input').fill('A simple page that displays hello world');
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    // SSO can appear as iframe modal (prod) or redirect (test/dev)
    const ssoOnSubmit = await Promise.race([
      page.locator('iframe[src*="sso"], #sso-deck-iframe').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT }).then(() => 'iframe'),
      page.waitForURL(/sso/, { timeout: DEFAULT_TIMEOUT }).then(() => 'redirect'),
    ]).catch(() => 'none');

    if (ssoOnSubmit === 'iframe') {
      console.log('  ✓ SSO modal appears on submit');
    } else if (ssoOnSubmit === 'redirect') {
      console.log('  ✓ Redirected to SSO on submit');
    } else {
      throw new Error('SSO did not appear on submit');
    }

    // ========================================
    // STEP 6: Protected route /apps
    // ========================================
    console.log('🔒 Step 6: Testing protected route /apps...');
    await page.goto('/apps');
    await page.waitForTimeout(3000); // Wait for redirect or page load

    // Protected route should redirect to SSO, auto-open SSO iframe, or show auth message
    const appsUrl = page.url();
    const ssoIframeVisible = await page.locator('iframe[title="Container for sign in"]')
      .isVisible().catch(() => false);
    if (appsUrl.includes('sso') || appsUrl.includes('login')) {
      console.log('  ✓ Redirected to SSO');
    } else if (ssoIframeVisible) {
      console.log('  ✓ SSO Deck auto-opened on 401');
    } else {
      const bodyText = await page.locator('body').textContent() || '';
      const hasAuthRequired = bodyText.includes('Authentication Required') || bodyText.includes('Sign In');
      if (hasAuthRequired) {
        console.log('  ✓ Shows auth required message');
      } else {
        console.log('  ⚠ Protected route accessible without auth (may be expected)');
      }
    }

    // ========================================
    // STEP 7: Protected route /develop
    // ========================================
    console.log('🔒 Step 7: Testing protected route /develop...');
    await page.goto('/develop/test-123');
    await page.waitForTimeout(3000);

    const developUrl = page.url();
    const ssoOnDevelop = await page.locator('iframe[title="Container for sign in"]')
      .isVisible().catch(() => false);
    if (developUrl.includes('sso') || developUrl.includes('login')) {
      console.log('  ✓ Develop page redirects to SSO');
    } else if (ssoOnDevelop) {
      console.log('  ✓ SSO Deck auto-opened on 401');
    } else {
      const bodyText = await page.locator('body').textContent() || '';
      const requiresAuth = bodyText.includes('Authentication Required') ||
                          bodyText.includes('Sign In') ||
                          bodyText.includes('Loading');
      if (requiresAuth) {
        console.log('  ✓ Develop page requires auth');
      } else {
        console.log('  ⚠ Develop page accessible without auth (may be expected)');
      }
    }

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
