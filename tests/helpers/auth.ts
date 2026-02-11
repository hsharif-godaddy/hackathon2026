import type { Page, BrowserContext, FrameLocator } from '@playwright/test';
import { getCredentials, DEFAULT_TIMEOUT, LONG_TIMEOUT, SSO_TIMEOUT, SHORT_TIMEOUT } from './constants';

/** SSO detection result types */
export type SsoDetectionResult = 'iframe' | 'redirect' | 'authenticated' | 'timeout' | null;

/**
 * Detect SSO type - shared helper for iframe modal vs redirect detection
 * @param page - Playwright page
 * @param includeAuthenticatedCheck - If true, also checks for develop page URL (already authenticated)
 * @returns Detection result: 'iframe', 'redirect', 'authenticated', 'timeout', or null
 */
export async function detectSsoType(page: Page, includeAuthenticatedCheck = false): Promise<SsoDetectionResult> {
  const signInIframe = page.locator('iframe[title="Container for sign in"]');

  const promises: Promise<SsoDetectionResult>[] = [
    signInIframe.waitFor({ state: 'visible', timeout: SSO_TIMEOUT }).then(() => 'iframe' as const),
    page.waitForURL('**/login**', { timeout: SSO_TIMEOUT }).then(() => 'redirect' as const),
    page.waitForURL('**/sso**', { timeout: SSO_TIMEOUT }).then(() => 'redirect' as const),
  ];

  if (includeAuthenticatedCheck) {
    promises.push(
      page.waitForURL('**/develop/**', { timeout: SSO_TIMEOUT }).then(() => 'authenticated' as const)
    );
  }

  return Promise.race(promises).catch(() => includeAuthenticatedCheck ? 'timeout' : null);
}

/**
 * Fill in sign-in credentials (handles both page and frame contexts)
 */
async function fillCredentials(context: Page | FrameLocator, username: string, password: string): Promise<void> {
  await context.getByRole('textbox', { name: /username|customer/i }).fill(username);
  await context.getByRole('textbox', { name: /password/i }).fill(password);
  await context.getByRole('button', { name: 'Sign In', exact: true }).click();
}

/**
 * Get iframe content frame locator for sign-in modal
 */
function getIframeFrame(page: Page, selector: string): FrameLocator {
  return page.frameLocator(selector);
}

/**
 * Handle SSO authentication - supports both iframe modal (prod) and redirect (test/dev)
 * This performs a full login flow through the UI
 */
export async function handleSsoLogin(page: Page): Promise<void> {
  const { username, password } = getCredentials();

  console.log('Waiting for sign-in (iframe modal or redirect)...');

  const signInType = await detectSsoType(page);

  if (signInType === 'iframe') {
    console.log('Sign-in iframe modal detected (production mode)');
    const frame = getIframeFrame(page, 'iframe[title="Container for sign in"]');
    await fillCredentials(frame, username, password);
  } else if (signInType === 'redirect') {
    console.log('Redirected to sign-in page (test environment)');
    await fillCredentials(page, username, password);
  } else {
    throw new Error('Sign-in failed: Timed out waiting for either iframe modal or login redirect');
  }

  console.log('Sign-in credentials submitted');
}

/**
 * Authenticate via cookie injection (faster than UI login)
 * Uses the @gd-cypress/auth token approach if available
 */
export async function authenticate(page: Page, context: BrowserContext): Promise<void> {
  const { username, password } = getCredentials();

  // For now, use UI-based authentication
  // Navigate to homepage and trigger login if needed
  await page.goto('/');

  // Check if already authenticated by looking for homepage content
  try {
    await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });

    // Check if Sign Out exists in user menu (indicates authenticated)
    const userMenuButton = page.getByTestId('user-menu-trigger');

    // Wait for button to be visible before clicking (fixes race condition)
    await userMenuButton.waitFor({ state: 'visible', timeout: SHORT_TIMEOUT });
    await userMenuButton.click({ force: true });

    const signOutButton = page.getByRole('button', { name: /sign out/i });
    if (await signOutButton.isVisible({ timeout: SHORT_TIMEOUT }).catch(() => false)) {
      console.log('Already authenticated');
      await page.keyboard.press('Escape');
      return;
    }
    await page.keyboard.press('Escape');
  } catch (error) {
    // Not authenticated or page structure different
    console.log('Auth check failed, proceeding with login');
  }

  // Need to authenticate - trigger sign in
  console.log('🔐 Authenticating...');
  await triggerSignIn(page);
  await handleSsoLogin(page);

  // Wait for redirect back to app
  await page.waitForURL('**/', { timeout: 60000 });
  console.log('✅ Authentication complete');
}

/**
 * Trigger sign in by clicking the Sign In button in user menu
 */
async function triggerSignIn(page: Page): Promise<void> {
  // Open user menu
  const userMenuButton = page.getByTestId('user-menu-trigger');

  await userMenuButton.click({ force: true });

  // Click Sign In
  const signInButton = page.locator('[data-eid*="user_menu.sign_in"]');
  if (await signInButton.isVisible({ timeout: DEFAULT_TIMEOUT }).catch(() => false)) {
    await signInButton.click();
  } else {
    // Try alternative - click directly on "Sign In" text
    await page.getByRole('button', { name: /sign in/i }).click();
  }
}

/**
 * Clear all authentication state
 */
export async function clearAuthState(context: BrowserContext): Promise<void> {
  await context.clearCookies();
  // Clear storage for all pages in context
  const pages = context.pages();
  for (const page of pages) {
    try {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
    } catch (error) {
      console.log('Could not clear storage for page (may not be ready)');
    }
  }
}

/**
 * Verify user is authenticated by checking user menu
 */
export async function verifyAuthenticated(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Open user menu
  const userMenuButton = page.getByTestId('user-menu-trigger');

  await userMenuButton.click({ force: true });
  await page.getByRole('button', { name: /sign out/i }).waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  await page.keyboard.press('Escape');
}

/**
 * Verify user is NOT authenticated by checking user menu
 */
export async function verifyUnauthenticated(page: Page): Promise<void> {
  const userMenuButton = page.getByTestId('user-menu-trigger');

  await userMenuButton.click({ force: true });
  await page.getByRole('button', { name: /sign in/i }).waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  await page.click('body', { position: { x: 0, y: 0 } });
}

/**
 * Sign out via user menu
 */
export async function signOut(page: Page): Promise<void> {
  const userMenuButton = page.getByTestId('user-menu-trigger');

  await userMenuButton.click({ force: true });
  await page.locator('[data-eid*="user_menu.sign_out"]').click();
}

/**
 * Click Sign In from user menu
 */
export async function signIn(page: Page): Promise<void> {
  const userMenuButton = page.getByTestId('user-menu-trigger');

  await userMenuButton.click({ force: true });
  await page.locator('[data-eid*="user_menu.sign_in"]').click();
}

/**
 * Open user menu in header
 */
export async function openUserMenu(page: Page): Promise<void> {
  const userMenuButton = page.getByTestId('user-menu-trigger');

  await userMenuButton.click({ force: true });
}
