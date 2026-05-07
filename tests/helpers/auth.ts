import type { Page, BrowserContext, FrameLocator } from '@playwright/test';
import { expect } from '@playwright/test';

import { getCredentials, DEFAULT_TIMEOUT, SSO_TIMEOUT, SHORT_TIMEOUT } from './constants';

/**
 * User menu opener in the main app chrome only (`data-testid="user-menu-trigger"` under `airo-header`).
 * Avoids ambiguous matches when the same test id appears elsewhere; label copy varies by locale so we do not match on text.
 */
export function userMenuTrigger(page: Page) {
  return page.getByTestId('airo-header').getByTestId('user-menu-trigger');
}

/** SSO detection result types */
export type SsoDetectionResult = 'iframe' | 'modal' | 'redirect' | 'authenticated' | 'timeout' | null;

/**
 * CSS selector matching the SSO sign-in iframe across both the legacy and
 * post-29-Apr-2026 GoDaddy surfaces:
 *
 *   - `iframe[title="Container for sign in"]` — legacy named iframe
 *   - `[role="dialog"] iframe` — new generic `<dialog>` (or `role=dialog`)
 *     wrapper around an unnamed cross-origin iframe. The wrapper does not
 *     carry the airo `.sso-login-modal` class and the iframe has no `title`
 *     attribute, so we have to match by structural relationship instead.
 *
 * Used by both `detectSsoType` and `handleSsoLogin` so the same string works
 * with `page.locator(...)` (for visibility waits) and `page.frameLocator(...)`
 * (for credential fill).
 */
const SSO_IFRAME_SELECTOR = 'iframe[title="Container for sign in"], [role="dialog"] iframe';

/**
 * Locator for the direct-DOM sign-in modal that GoDaddy's redesigned
 * universal sign-in dialog uses (rolled out ~29 Apr 2026). The form is
 * rendered inline in the parent page (no cross-origin iframe) inside the
 * `.sso-login-modal` wrapper applied by `app/src/components/auth/SsoLogin.tsx`.
 *
 * The `.filter({ has: ... })` guard requires the username/email input to be
 * present so we don't race against an empty wrapper that's mounted but not
 * yet hydrated, AND so the modal racer naturally loses when the form is
 * inside a cross-origin iframe (in which case DOM queries from the parent
 * cannot see the input and the iframe branch should win the race instead).
 *
 * Match by `autocomplete` attribute rather than label text — labels are
 * Material-style floating spans without proper aria association on the new
 * dialog, so role-by-name does not find them.
 */
function signInModalLocator(page: Page) {
  return page.locator('.sso-login-modal').filter({
    has: page.locator('input[autocomplete="username"], input[autocomplete="email"], input[autocomplete="username webauthn"]'),
  });
}

/**
 * Detect SSO type - races the sign-in paths the app exposes.
 *
 * The app uses ONE of these paths depending on environment (see
 * `useSsoSignIn.ts` and `docs/sso-login-env-gating.md`):
 *
 *   - 'modal' branch: post-29-Apr-2026 universal sign-in dialog, rendered
 *     directly in the parent page DOM (no iframe). Current prod behaviour.
 *   - 'iframe' branch: legacy SSO Deck cross-origin iframe modal. Kept as a
 *     fallback in case any deploy still ships the older SsoDeck markup.
 *   - 'redirect' branch: full-page redirect to /login, used in deployed test
 *     and dev envs where Private Network Access blocks the iframe.
 *
 * All branches are kept here because a single Playwright run may hit different
 * envs via `--base-url`, and the modal/iframe choice is controlled by GoDaddy
 * (not us) so we should detect both.
 *
 * @param page - Playwright page
 * @param includeAuthenticatedCheck - If true, also checks for develop page URL (already authenticated)
 * @param timeout - Optional timeout override (defaults to SSO_TIMEOUT from constants)
 * @returns Detection result: 'modal', 'iframe', 'redirect', 'authenticated', 'timeout', or null
 */
export async function detectSsoType(page: Page, includeAuthenticatedCheck = false, timeout: number = SSO_TIMEOUT): Promise<SsoDetectionResult> {
  const signInModal = signInModalLocator(page);
  const signInIframe = page.locator(SSO_IFRAME_SELECTOR).first();

  // Each branch needs its own .catch() so losing racers don't produce
  // unhandled rejections after the race settles.
  const promises: Promise<SsoDetectionResult>[] = [
    signInModal.waitFor({ state: 'visible', timeout }).then(() => 'modal' as const).catch(() => null),
    signInIframe.waitFor({ state: 'visible', timeout }).then(() => 'iframe' as const).catch(() => null),
    page.waitForURL('**/login**', { timeout }).then(() => 'redirect' as const).catch(() => null),
    page.waitForURL('**/sso**', { timeout }).then(() => 'redirect' as const).catch(() => null),
  ];

  if (includeAuthenticatedCheck) {
    promises.push(
      page.waitForURL('**/develop/**', { timeout }).then(() => 'authenticated' as const).catch(() => null)
    );
  }

  return Promise.race(promises).then(result => result ?? (includeAuthenticatedCheck ? 'timeout' : null));
}

/**
 * Type predicate: result represents a sign-in UI (any of the modal/iframe/
 * redirect surfaces) that should be handled by `handleSsoLogin`. Single
 * source of truth so adding a new surface to `SsoDetectionResult` only
 * requires updating this predicate, and call sites can't drift.
 */
export function isSignInUIResult(
  result: SsoDetectionResult,
): result is 'iframe' | 'modal' | 'redirect' {
  return result === 'iframe' || result === 'modal' || result === 'redirect';
}

/**
 * Fill in sign-in credentials (handles both page and frame contexts).
 *
 * The new GoDaddy universal sign-in dialog uses Material-style floating
 * labels (the "Username or Customer #" text is rendered as a span, not as a
 * `<label htmlFor>`), so `getByRole('textbox', { name: /username/i })` no
 * longer finds the username input by its accessible name. Use the HTML5
 * `autocomplete` attributes instead — they are stable, browser-standard hooks
 * (password managers rely on them) and are present on both old and new SSO
 * dialogs. We fall back to the role-by-name strategy for very old surfaces.
 */
async function fillCredentials(context: Page | FrameLocator, username: string, password: string): Promise<void> {
  const usernameByAutocomplete = context.locator(
    'input[autocomplete="username"], input[autocomplete="email"], input[autocomplete="username webauthn"]',
  ).first();
  const usernameByRole = context.getByRole('textbox', { name: /username|customer|email/i }).first();

  // Wait for the autocomplete-based input to attach before falling back —
  // a synchronous .count() race could see 0 while the form is still mounting
  // and incorrectly fall back to the role-by-name path (which is broken on
  // the redesigned dialog). DEFAULT_TIMEOUT (10s) is plenty for the form to
  // attach in any environment we test against.
  let usernameInput = usernameByAutocomplete;
  try {
    await usernameByAutocomplete.waitFor({ state: 'attached', timeout: DEFAULT_TIMEOUT });
  } catch {
    usernameInput = usernameByRole;
  }
  await usernameInput.fill(username);

  // `input[type="password"]` is the most stable hook for the password field —
  // there is exactly one of these on a sign-in form regardless of label copy.
  await context.locator('input[type="password"]').first().fill(password);

  // Sign-in button: try exact text first (matches both old and new dialogs);
  // wait for it to attach before falling back to a permissive name match,
  // for the same reason as the username-input race above. `.first()` on both
  // branches avoids a strict-mode violation if the page chrome also exposes
  // a "Sign In" button (e.g. user-menu trigger).
  let signInButton = context.getByRole('button', { name: 'Sign In', exact: true }).first();
  try {
    await signInButton.waitFor({ state: 'attached', timeout: DEFAULT_TIMEOUT });
  } catch {
    signInButton = context.getByRole('button', { name: /^sign\s*in$/i }).first();
  }
  await signInButton.click();
}

/**
 * Get iframe content frame locator for sign-in modal
 */
function getIframeFrame(page: Page, selector: string): FrameLocator {
  return page.frameLocator(selector);
}

/**
 * Predicate: URL is the app, not the SSO host. Used after submitting SSO
 * credentials to wait for the post-login redirect back to the app without
 * assuming a specific landing path (SSO honours `?path=...` and may land on
 * `/develop/<id>`, `/apps`, or the root).
 */
function isBackOnApp(url: URL): boolean {
  return !/^sso\./i.test(url.hostname) && !/\/login\b/.test(url.pathname);
}

/**
 * Handle SSO authentication - supports both iframe modal (prod) and redirect (test/dev)
 * This performs a full login flow through the UI
 * @param page - Playwright page
 * @param timeout - Optional timeout override (defaults to SSO_TIMEOUT from constants)
 */
export async function handleSsoLogin(page: Page, timeout: number = SSO_TIMEOUT): Promise<void> {
  const { username, password } = getCredentials();

  console.log('Waiting for sign-in (DOM modal, iframe modal, or redirect)...');

  const signInType = await detectSsoType(page, false, timeout);

  if (signInType === 'modal') {
    // Post-29-Apr-2026 GoDaddy universal sign-in: form rendered directly in
    // the parent page DOM. Same role-based locators work, just against the
    // page instead of a frame.
    console.log('Sign-in DOM modal detected (post-29-Apr-2026 prod UI)');
    await fillCredentials(page, username, password);
    await signInModalLocator(page).waitFor({ state: 'hidden', timeout });
    await page.waitForURL(isBackOnApp, { timeout });
  } else if (signInType === 'iframe') {
    console.log('Sign-in iframe modal detected (SsoDeck legacy or new dialog wrapper)');
    const iframeLocator = page.locator(SSO_IFRAME_SELECTOR).first();
    const frame = getIframeFrame(page, SSO_IFRAME_SELECTOR);
    await fillCredentials(frame, username, password);

    // Wait for SSO iframe to close (confirms auth was processed)
    await iframeLocator.waitFor({ state: 'hidden', timeout });

    // Wait for the post-SSO page reload triggered by the parent page. Use a
    // predicate instead of the glob `**/` - that glob compiles to `^(.*/)$`
    // which only matches URLs ending with `/`, so a redirect back to
    // `/develop/<id>` (no trailing slash) would silently time out here.
    await page.waitForURL(isBackOnApp, { timeout });
  } else if (signInType === 'redirect') {
    console.log('Redirected to sign-in page (test environment)');
    await fillCredentials(page, username, password);
    await page.waitForURL(isBackOnApp, { timeout });
  } else {
    throw new Error('Sign-in failed: Timed out waiting for DOM modal, iframe modal, or login redirect');
  }

  console.log('Sign-in credentials submitted');
}

/**
 * Authenticate via cookie injection (faster than UI login)
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
 * With Gasket Auth as single source of truth, SSO is auto-opened by
 * SsoLoginPrompt when AuthRequired detects invalid authState, or by
 * authPreflight on a level-3 401. There is no longer a separate fallback
 * modal - this helper just detects the SSO UI (iframe or redirect) and
 * completes login.
 */
export async function handleReauthIfPresent(page: Page): Promise<boolean> {
  // Check for full-page SSO redirect first (session expired, browser navigated away).
  // dev/test/prod each have their own SSO host: sso.dev-godaddy.com, sso.test-godaddy.com,
  // sso.godaddy.com. Missing any of these causes the SSO-iframe/modal Promise.race below
  // to never resolve and the test silently continues against the SSO page.
  if (/sso\.(test-|dev-)?godaddy\.com\/login/i.test(page.url())) {
    console.log('  Full-page SSO redirect detected, re-authenticating...');
    await handleSsoLogin(page);
    console.log('  Re-authenticated from SSO redirect');
    return true;
  }

  const ssoIframe = page.locator(SSO_IFRAME_SELECTOR).first();
  const ssoModal = signInModalLocator(page);
  const ssoRedirectUrl = /sso\.(test-|dev-)?godaddy\.com\/login/i;

  // Check for SSO iframe, the post-29-Apr-2026 in-page modal, or a
  // full-page SSO redirect that is still in flight at the time we were
  // called. Each branch needs its own .catch() so the losing racer doesn't
  // produce an unhandled rejection.
  //
  // The full-page redirect racer is load-bearing: gasket-auth fires the
  // top-window navigation ~1s after reload when VAT is briefly stale, so
  // the synchronous page.url() check above can return false before the
  // bounce lands. Without this racer, handleReauthIfPresent silently
  // returns false and the caller runs against a page that is about to
  // navigate to SSO.
  const detected = await Promise.race([
    ssoIframe.waitFor({ state: 'visible', timeout: SHORT_TIMEOUT }).then(() => 'sso-iframe' as const).catch(() => null),
    ssoModal.waitFor({ state: 'visible', timeout: SHORT_TIMEOUT }).then(() => 'sso-modal' as const).catch(() => null),
    page.waitForURL(ssoRedirectUrl, { timeout: SHORT_TIMEOUT }).then(() => 'sso-redirect' as const).catch(() => null),
  ]);

  if (!detected) return false;

  if (detected === 'sso-iframe') {
    console.log('  SSO iframe detected (auto-opened on invalid auth), completing login...');
  } else if (detected === 'sso-redirect') {
    console.log('  Full-page SSO redirect caught in-flight, re-authenticating...');
  } else {
    console.log('  SSO DOM modal detected (auto-opened on invalid auth), completing login...');
  }

  try {
    await handleSsoLogin(page);
  } catch (err) {
    throw new Error(`Re-authentication failed: ${err instanceof Error ? err.message : err}`);
  }

  // Wait for auth UI to disappear. These are best-effort teardown waits — if
  // they time out the page state is still recoverable, but log so the failure
  // shows up in Playwright output instead of being silently swallowed.
  await ssoIframe.waitFor({ state: 'hidden', timeout: SSO_TIMEOUT })
    .catch((err) => console.warn(`  Re-auth iframe did not hide cleanly: ${err instanceof Error ? err.message : err}`));
  await ssoModal.waitFor({ state: 'hidden', timeout: SHORT_TIMEOUT })
    .catch((err) => console.warn(`  Re-auth modal did not hide cleanly: ${err instanceof Error ? err.message : err}`));

  console.log('  Re-authenticated successfully');
  return true;
}

/** @deprecated Use handleReauthIfPresent instead */
export const dismissAuthModalIfPresent = handleReauthIfPresent;

/**
 * Handle re-authentication if SSO appeared during a long-running test step.
 * No-op if no SSO UI is visible.
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
