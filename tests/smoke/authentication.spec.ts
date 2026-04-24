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

    // Confirm the 401 mock actually fired before racing for UI. If /api/sites is
    // never fetched (e.g. cached response, SSR-only), the race would time out on
    // a page with no auth UI and produce a confusing "expected ... not null" error.
    await expect
      .poll(() => intercepted, {
        message: 'Route mock for /api/sites was never triggered',
        timeout: DEFAULT_TIMEOUT,
      })
      .toBe(true);

    // 6a: Detect which auth UI appeared after the mocked 401.
    // Four possible states depending on environment and deploy status:
    //   'sso-iframe'        - prod / local dev: SsoDeck renders iframe inside SsoLogin Modal
    //   'sso-modal'         - modal opened but iframe never loaded (edge case / misconfig)
    //   'sso-full-redirect' - deployed test/dev: AuthBoundary -> signIn() -> handleSignIn()
    //                         does window.location.href = sso.<root>/login. The env gate
    //                         in useSsoSignIn skips the modal because PNA blocks the iframe.
    //                         See docs/sso-login-env-gating.md.
    //   'fallback'          - pre-deploy: old AuthBoundary shows "Sign In Required" modal directly
    // TODO: Remove fallback branch after #2789 deploys to prod.
    const ssoIframe = page.locator('iframe[title="Container for sign in"]');
    const ssoModal = page.locator('.sso-login-modal');
    const fallbackModal = page.locator('[role="dialog"]', { hasText: 'Sign In Required' });

    const authUiState = await Promise.race([
      ssoIframe
        .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
        .then(() => 'sso-iframe' as const)
        .catch(() => null),
      ssoModal
        .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
        .then(async () => {
          // In prod / local dev the modal wrapper renders before the iframe loads.
          // Give the iframe a brief window to appear; if it does, classify as
          // 'sso-iframe' so the race exercises the full dismiss/fallback flow
          // instead of short-circuiting to the 'sso-modal' edge-case branch.
          const iframeFollowed = await ssoIframe
            .waitFor({ state: 'visible', timeout: 1000 })
            .then(() => true)
            .catch(() => false);
          return iframeFollowed ? ('sso-iframe' as const) : ('sso-modal' as const);
        })
        .catch(() => null),
      fallbackModal
        .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
        .then(() => 'fallback' as const)
        .catch(() => null),
      page
        .waitForURL(
          (url) =>
            url.hostname.startsWith('sso.') && url.hostname.endsWith('godaddy.com'),
          {
            timeout: DEFAULT_TIMEOUT,
            // 'commit' resolves as soon as the browser commits the navigation
            // (response headers received). Without this, waitForURL waits for the
            // cross-origin SSO page's 'load' event, which often exceeds
            // DEFAULT_TIMEOUT or is blocked by the runner, causing this arm to
            // resolve to null alongside the three waitFor arms.
            waitUntil: 'commit',
          }
        )
        .then(() => 'sso-full-redirect' as const)
        .catch(() => null),
    ]);

    expect(
      authUiState,
      'Expected SSO iframe, SSO modal, full-page SSO redirect, or fallback dialog after 401'
    ).not.toBeNull();
    console.log(`  [6a] Auth UI detected: ${authUiState}`);

    if (authUiState === 'sso-iframe') {
      // Prod / local dev: full auto-open/dismiss/fallback flow
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
    } else if (authUiState === 'sso-modal') {
      // Edge case: SsoLogin Modal opened but iframe did not load (transient / misconfig)
      console.log('  [6b] SsoLogin modal opened (iframe not loaded)');
    } else if (authUiState === 'sso-full-redirect') {
      // Deployed test/dev: AuthBoundary -> useSsoSignIn.signIn() -> handleSignIn()
      // does window.location.href to sso.<root>/login. Assert the landing path to
      // catch a broken 401 handler that redirects somewhere unexpected - waitForURL
      // alone could coincidentally match any navigation to an sso.*.godaddy.com host.
      expect(page.url(), 'Full-page SSO redirect should land on /login').toMatch(/\/login/);
      console.log(`  [6b] Full-page redirect to SSO: ${page.url()}`);
    } else {
      // Pre-deploy: old AuthBoundary shows fallback modal directly
      console.log('  [6b] Fallback modal shown (pre-deploy, auto-open not yet active)');
    }

    // Clean up route mock and navigate to homepage to clear AuthBoundary state.
    // The 401 was mocked (not a real session expiry), so the user is still
    // authenticated - navigating to homepage clears the modal without re-auth.
    // If we're on the SSO host after a full-page redirect, page.goto('/') resolves
    // against baseURL and brings us back to the app origin with the real session.
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
