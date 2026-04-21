import type { Page, BrowserContext, FrameLocator } from '@playwright/test';
import { expect } from '@playwright/test';

import { getCredentials, DEFAULT_TIMEOUT, LONG_TIMEOUT, SSO_TIMEOUT, SHORT_TIMEOUT } from './constants';

/**
 * User menu opener in the main app chrome only (`data-testid="user-menu-trigger"` under `airo-header`).
 * Avoids ambiguous matches when the same test id appears elsewhere; label copy varies by locale so we do not match on text.
 */
export function userMenuTrigger(page: Page) {
  return page.getByTestId('airo-header').getByTestId('user-menu-trigger');
}

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

  // Each branch needs its own .catch() so losing racers don't produce
  // unhandled rejections after the race settles.
  const promises: Promise<SsoDetectionResult>[] = [
    signInIframe.waitFor({ state: 'visible', timeout: SSO_TIMEOUT }).then(() => 'iframe' as const).catch(() => null),
    page.waitForURL('**/login**', { timeout: SSO_TIMEOUT }).then(() => 'redirect' as const).catch(() => null),
    page.waitForURL('**/sso**', { timeout: SSO_TIMEOUT }).then(() => 'redirect' as const).catch(() => null),
  ];

  if (includeAuthenticatedCheck) {
    promises.push(
      page.waitForURL('**/develop/**', { timeout: SSO_TIMEOUT }).then(() => 'authenticated' as const).catch(() => null)
    );
  }

  return Promise.race(promises).then(result => result ?? (includeAuthenticatedCheck ? 'timeout' : null));
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
    const ssoIframeSelector = 'iframe[title="Container for sign in"]';
    const iframeLocator = page.locator(ssoIframeSelector);
    const frame = getIframeFrame(page, ssoIframeSelector);
    await fillCredentials(frame, username, password);

    // Wait for SSO iframe to close (confirms auth was processed)
    await iframeLocator.waitFor({ state: 'hidden', timeout: SSO_TIMEOUT });

    // Wait for the post-SSO page reload triggered by the parent page
    await page.waitForURL('**/', { timeout: SSO_TIMEOUT });
  } else if (signInType === 'redirect') {
    console.log('Redirected to sign-in page (test environment)');
    await fillCredentials(page, username, password);
    await page.waitForURL('**/', { timeout: SSO_TIMEOUT });
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
    const menuTrigger = userMenuTrigger(page);

    // Wait for button to be visible before clicking (fixes race condition)
    await menuTrigger.waitFor({ state: 'visible', timeout: SHORT_TIMEOUT });
    await menuTrigger.click({ force: true });

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
  const menuTrigger = userMenuTrigger(page);

  await menuTrigger.click({ force: true });

  // Click Sign In
  const signInButton = page.locator('[data-testid="user-menu-item-sign-in"]');
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
 * Verify user is authenticated by checking user menu.
 * Uses retry pattern because auth state may take time to propagate
 * to React after SSO redirect completes.
 */
export async function verifyAuthenticated(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const menuTrigger = userMenuTrigger(page);

  await expect(async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await menuTrigger.click({ force: true });
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible({ timeout: 0 });
  }).toPass({ timeout: DEFAULT_TIMEOUT });

  await page.keyboard.press('Escape');
}

/**
 * Verify user is NOT authenticated by checking user menu
 */
export async function verifyUnauthenticated(page: Page): Promise<void> {
  const menuTrigger = userMenuTrigger(page);

  await menuTrigger.click({ force: true });
  await page.getByRole('button', { name: /sign in/i }).waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  await page.click('body', { position: { x: 0, y: 0 } });
}

/**
 * Sign out via user menu
 */
export async function signOut(page: Page): Promise<void> {
  const menuTrigger = userMenuTrigger(page);

  await menuTrigger.click({ force: true });
  await page
    .locator('[data-slot="popover-content"][data-state="open"]')
    .getByRole('button', { name: /sign\s*in|builder_common_signin/i })
    .click();
}

/**
 * Click Sign In from user menu
 */
export async function signIn(page: Page): Promise<void> {
  const menuTrigger = userMenuTrigger(page);

  await menuTrigger.click({ force: true });
  await page
    .locator('[data-slot="popover-content"][data-state="open"]')
    .getByRole('button', { name: /sign\s*in|builder_common_signin/i })
    .click();
}

/**
 * Open user menu in header
 */
export async function openUserMenu(page: Page): Promise<void> {
  await userMenuTrigger(page).click({ force: true });
}

/**
 * Handle re-authentication if SSO appeared during a test.
 * Returns true if re-auth was needed and completed, false if no auth UI was present.
 *
 * On 401, the app auto-opens the SSO Deck iframe directly. If the user dismisses
 * SSO without completing auth, the AuthBoundary fallback modal appears with a
 * "Sign In" button. This helper checks for both, SSO iframe first.
 */
export async function handleReauthIfPresent(page: Page): Promise<boolean> {
  const ssoIframe = page.locator('iframe[title="Container for sign in"]');
  const signInModal = page.locator('[role="dialog"]', { hasText: 'Sign In Required' });

  // Check for SSO iframe (auto-opened on 401) or AuthBoundary fallback modal.
  // Each branch needs its own .catch() so the losing racer doesn't produce an
  // unhandled rejection after the race settles.
  const detected = await Promise.race([
    ssoIframe.waitFor({ state: 'visible', timeout: SHORT_TIMEOUT }).then(() => 'sso' as const).catch(() => null),
    signInModal.waitFor({ state: 'visible', timeout: SHORT_TIMEOUT }).then(() => 'fallback' as const).catch(() => null),
  ]);

  if (!detected) return false;

  if (detected === 'fallback') {
    console.log('  Sign In Required fallback modal detected, clicking Sign In...');
    await signInModal.getByRole('button', { name: 'Sign In', exact: true }).click();
  } else {
    console.log('  SSO iframe detected (auto-opened on 401), completing login...');
  }

  try {
    await handleSsoLogin(page);
  } catch (err) {
    throw new Error(`Re-authentication failed: ${err instanceof Error ? err.message : err}`);
  }

  // Wait for both SSO iframe and fallback modal to disappear
  await ssoIframe.waitFor({ state: 'hidden', timeout: SSO_TIMEOUT }).catch(() => {});
  await signInModal.waitFor({ state: 'hidden', timeout: SHORT_TIMEOUT }).catch(() => {});

  console.log('  Re-authenticated successfully');
  return true;
}

/** @deprecated Use handleReauthIfPresent instead */
export const dismissAuthModalIfPresent = handleReauthIfPresent;

/**
 * Handle re-authentication if SSO or the AuthBoundary fallback appeared during
 * a long-running test step. No-op if neither is visible.
 *
 * Call before page navigations or critical operations (delete, deploy, unpublish)
 * that are likely to trigger 401s if the session expired during AI generation.
 */
export async function ensureAuthenticated(page: Page): Promise<void> {
  const didReauth = await handleReauthIfPresent(page);
  if (didReauth) {
    await verifyAuthenticated(page);
  }
}
