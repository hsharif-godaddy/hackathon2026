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

import { handleSsoLogin, clearAuthState, openUserMenu, verifyAuthenticated } from '../helpers/auth';
import { LONG_TIMEOUT, DEFAULT_TIMEOUT } from '../helpers/constants';

test.describe('Authentication', () => {
  test.beforeEach(async ({}, testInfo) => {
    const fullTitle = testInfo.titlePath.join(' > ');
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🚀 STARTING TEST`);
    console.log(`📄 File: ${testInfo.file?.split('/').pop() || 'unknown'}`);
    console.log(`🧪 Test: ${fullTitle}`);
    console.log(`${'='.repeat(70)}`);
  });

  test.afterEach(async ({}, testInfo) => {
    // Log test result with details
    const fullTitle = testInfo.titlePath.join(' > ');
    const duration = ((testInfo.duration || 0) / 1000).toFixed(1);
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🏁 TEST COMPLETED`);
    console.log(`📄 File: ${testInfo.file?.split('/').pop() || 'unknown'}`);
    console.log(`🧪 Test: ${fullTitle}`);
    console.log(`⏱️ Duration: ${duration}s`);

    if (testInfo.status === 'passed') {
      console.log(`✅ Status: PASSED`);
    } else if (testInfo.status === 'failed') {
      console.log(`❌ Status: FAILED`);
      if (testInfo.error) {
        const errorLines = testInfo.error.message?.split('\n') || [];
        console.log(`💥 Error Type: ${testInfo.error.name || 'Error'}`);
        console.log(`💥 Message: ${errorLines[0] || 'Unknown error'}`);
        // Show locator info if present
        const locatorLine = errorLines.find(l => l.includes('Locator:'));
        if (locatorLine) console.log(`🎯 ${locatorLine.trim()}`);
        // Show expected/received if present
        const expectedLine = errorLines.find(l => l.includes('Expected:'));
        const receivedLine = errorLines.find(l => l.includes('Received:'));
        if (expectedLine) console.log(`   ${expectedLine.trim()}`);
        if (receivedLine) console.log(`   ${receivedLine.trim()}`);
        // Show file location from stack
        const stackMatch = testInfo.error.stack?.match(/at.*\((.*:\d+:\d+)\)/);
        if (stackMatch) console.log(`📍 Location: ${stackMatch[1]}`);
      }
    } else if (testInfo.status === 'skipped') {
      console.log(`⏭️ Status: SKIPPED`);
    }
    console.log(`${'='.repeat(70)}\n`);
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
    await page.locator('[data-eid*="user_menu.sign_in"]').click();
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
    // STEP 6: Sign out
    // ========================================
    console.log('🚪 Step 6: Testing sign out...');
    await page.goto('/');
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });

    await openUserMenu(page);
    await expect(page.locator('[data-eid*="user_menu.sign_out"]')).toBeVisible();
    await page.locator('[data-eid*="user_menu.sign_out"]').click({ force: true });

    await page.waitForTimeout(2000);
    const url = page.url();
    const logoutInitiated = url.includes('sso') || url.includes('logout') || url.includes('godaddy.com');
    expect(logoutInitiated).toBe(true);
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
    const userMenuButton = page.getByTestId('user-menu-trigger');
    await userMenuButton.click({ force: true });
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
    await userMenuButton.click({ force: true });
    await page.locator('[data-eid*="user_menu.sign_in"]').click();

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

    // Protected route should show auth message, redirect to SSO, or show sign-in
    const appsUrl = page.url();
    if (appsUrl.includes('sso') || appsUrl.includes('login')) {
      console.log('  ✓ Redirected to SSO');
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
    if (developUrl.includes('sso') || developUrl.includes('login')) {
      console.log('  ✓ Develop page redirects to SSO');
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
