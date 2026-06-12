import type { Page, BrowserContext, FrameLocator } from '@playwright/test';
import { expect } from '@playwright/test';

import { getCredentials, getEnvConfig, DEFAULT_TIMEOUT, SSO_TIMEOUT, SHORT_TIMEOUT } from './constants';
import type { Environment } from './constants';

/**
 * Standalone SSO host per env. The app's embedded sign-in points at these
 * (e.g. the prod iframe loads `sso.godaddy.com`). `loginViaSsoDirect` logs in
 * on these pages directly — at the top level, not inside the app's iframe.
 */
const SSO_BASE_URL_BY_ENV: Record<Environment, string> = {
  local: 'https://sso.test-godaddy.com',
  dev: 'https://sso.dev-godaddy.com',
  'pre-test': 'https://sso.test-godaddy.com',
  test: 'https://sso.test-godaddy.com',
  prod: 'https://sso.godaddy.com',
};

/**
 * Log in directly on the standalone GoDaddy SSO page, then leave the browser
 * authenticated for the whole `.godaddy.com` (or `.test-godaddy.com`) domain —
 * so a subsequent `page.goto(<airo-builder base>)` lands already signed in.
 *
 * Why this exists: the app's *embedded* sign-in is a cross-origin iframe
 * (`sso-deck-iframe`) on prod. Filling credentials inside that iframe is slow
 * and, under parallel workers on a single shopper, the `locator.fill` times
 * out (concurrent cross-origin iframe interaction). The standalone SSO page
 * exposes `#username` / `#password` / `#submitBtn` at the TOP level, so a
 * direct fill is fast and contention-tolerant. SSO sets the shared `auth_idp`
 * cookie on the apex domain, which airo-builder reads.
 *
 * No-op-safe: if the SSO page doesn't show the login form (already
 * authenticated / redirected), returns without error.
 */
export async function loginViaSsoDirect(page: Page, timeout: number = SSO_TIMEOUT): Promise<void> {
  const { env } = getEnvConfig();
  const { username, password } = getCredentials();
  const ssoBase = SSO_BASE_URL_BY_ENV[env];

  await page.goto(`${ssoBase}/`);

  const usernameInput = page.locator('#username');
  const formPresent = await usernameInput
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
  if (!formPresent) {
    console.log('  SSO direct: no login form (already authenticated), continuing');
    return;
  }

  await usernameInput.fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#submitBtn').click();

  // Login success navigates the SSO page away from the login form (the
  // post-login redirect, which carries the Set-Cookie that establishes the
  // session). The form detaching is the completion signal.
  //
  // Do NOT wait for 'networkidle' here: the post-login landing page
  // (e.g. www.<env>godaddy.com) has continuous background polling, so
  // networkidle never fires and the helper hangs (the rest of the suite
  // avoids networkidle for the same reason). 'domcontentloaded' is bounded
  // and fires once the landing page's document is ready — by which point the
  // redirect's auth cookie has been processed.
  await usernameInput.waitFor({ state: 'detached', timeout }).catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  console.log(`  SSO direct: signed in at ${ssoBase} (now on ${new URL(page.url()).host})`);
}

/**
 * User menu opener in the main app chrome only (`data-testid="user-menu-trigger"` under `airo-header`).
 * Avoids ambiguous matches when the same test id appears elsewhere; label copy varies by locale so we do not match on text.
 */
export function userMenuTrigger(page: Page) {
  return page.getByTestId('airo-header').getByTestId('user-menu-trigger');
}

/**
 * Name of the cookie the app uses to decide which SSO deck view to show.
 * Mirrors `COOKIE_NAME` in `app/src/lib/returningUser.ts` — kept as a literal
 * here because the test suite is a separate package and cannot import app
 * internals. If the app renames the cookie, update this to match.
 */
const RETURNING_USER_COOKIE = 'airo_returning_user';

/**
 * Mark this browser as a returning user BEFORE any app page loads.
 *
 * As of PR #4561 the app routes a fresh sign-in (authReason === null) without
 * the `airo_returning_user` cookie to the SSO deck's *create-account* view
 * instead of *login* (see `app/src/lib/ssoPageRoute.ts#getSsoPageToLoad`).
 * Every Playwright run starts from a clean browser profile with no cookies, so
 * the SSO deck shows the create-account form, which has no username/password
 * fields — `fillCredentials` then times out waiting for an input that never
 * appears.
 *
 * The test account is a real existing user, so seeding the returning-user
 * cookie is honest, not a workaround: it puts the browser in the same state a
 * returning user's browser would be in. `addInitScript` runs before page
 * scripts on every navigation, so the cookie is present by the time
 * `SsoLogin.tsx` reads it via `isReturningUser()`.
 *
 * Call this once per test (e.g. in `beforeEach`) BEFORE the first `page.goto`.
 */
export async function seedReturningUserCookie(page: Page): Promise<void> {
  await page.addInitScript((cookieName: string) => {
    const oneYearSeconds = 365 * 24 * 60 * 60;
    document.cookie = `${cookieName}=1; Max-Age=${oneYearSeconds}; Path=/; SameSite=Lax; Secure`;
  }, RETURNING_USER_COOKIE);
}

/** SSO detection result types */
export type SsoDetectionResult = 'iframe' | 'modal' | 'redirect' | 'authenticated' | 'timeout' | null;

/**
 * CSS selector matching the SSO sign-in iframe across every GoDaddy surface:
 *
 *   - `iframe[title="Container for sign in"]` — legacy named iframe
 *   - `[role="dialog"] iframe` — generic `<dialog>` wrapper around the SSO iframe
 *   - `.sso-login-modal iframe` — airo's SsoLogin.tsx wrapper around the SSO
 *     iframe. Current prod shape: a `.sso-login-modal` element containing a
 *     cross-origin iframe pointing at `sso.godaddy.com`. Without this entry the
 *     modal racer wins (Playwright's `has`-filter traverses cross-origin
 *     iframes, so the autocomplete-input filter matches even though the input
 *     is inside the iframe), then fillCredentials runs against the top-level
 *     page and times out because no input exists there.
 *
 * Used by both `detectSsoType` and `handleSsoLogin` so the same string works
 * with `page.locator(...)` (for visibility waits) and `page.frameLocator(...)`
 * (for credential fill).
 */
const SSO_IFRAME_SELECTOR =
  'iframe[title="Container for sign in"], [role="dialog"] iframe, .sso-login-modal iframe';

/**
 * Locator for the direct-DOM sign-in modal that GoDaddy's redesigned
 * universal sign-in dialog uses when the form is rendered inline in the
 * parent page (no cross-origin iframe) inside the `.sso-login-modal`
 * wrapper applied by `app/src/components/auth/SsoLogin.tsx`.
 *
 * `hasNot: iframe` is the key disambiguator: current prod also uses
 * `.sso-login-modal`, but with a cross-origin iframe inside that loads
 * `sso.godaddy.com`. Playwright's `has`-filter traverses into cross-origin
 * iframes, so a bare `has: input[autocomplete=...]` matches in BOTH the
 * direct-DOM case and the iframe-wrapped case — the modal racer wins
 * incorrectly, then `fillCredentials(page, ...)` fails because the input
 * is in an iframe, not the top-level page. Excluding modals that contain
 * an iframe routes the iframe-wrapped case to the iframe branch where it
 * belongs.
 *
 * The remaining `has: input[autocomplete=...]` guard requires the username
 * input to be present so we don't race against an empty wrapper.
 *
 * Match by `autocomplete` attribute rather than label text — labels are
 * Material-style floating spans without proper aria association on the new
 * dialog, so role-by-name does not find them.
 */
function signInModalLocator(page: Page) {
  return page
    .locator('.sso-login-modal')
    .filter({ hasNot: page.locator('iframe') })
    .filter({
      has: page.locator(
        'input[autocomplete="username"], input[autocomplete="email"], input[autocomplete="username webauthn"]',
      ),
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
  //
  // IMPORTANT: do not add a bare `page.locator('.sso-login-modal').waitFor(...)`
  // racer here. The current prod shape is `.sso-login-modal` wrapping a
  // cross-origin iframe; the wrapper becomes visible before the iframe loads,
  // so an unfiltered modal racer fires first, returns 'modal', and
  // `handleSsoLogin`'s modal branch then tries `fillCredentials(page, ...)`
  // against the top-level page — where the input doesn't exist, so fill
  // times out at 30s. `signInModalLocator` already filters with
  // `hasNot: iframe` AND requires the autocomplete input, so it only
  // matches a genuine direct-DOM modal. The iframe-wrapped case is caught
  // by `signInIframe` via the `.sso-login-modal iframe` selector below.
  const promises: Promise<SsoDetectionResult>[] = [
    signInModal.waitFor({ state: 'visible', timeout }).then(() => 'modal' as const).catch(() => null),
    signInIframe.waitFor({ state: 'visible', timeout }).then(() => 'iframe' as const).catch(() => null),
    page.waitForURL('**/login**', { timeout }).then(() => 'redirect' as const).catch(() => null),
    page.waitForURL('**/sso**', { timeout }).then(() => 'redirect' as const).catch(() => null),
    // Gasket auth may redirect to the same page with hbi_code / auth_reason
    // query params instead of navigating to a dedicated /login URL.
    page.waitForURL((url) => url.searchParams.has('hbi_code') || url.searchParams.has('auth_reason'), { timeout }).then(() => 'redirect' as const).catch(() => null),
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

  const signInType = await detectSsoType(page, true, timeout);

  if (signInType === 'authenticated') {
    console.log('Already authenticated, no sign-in needed');
    return;
  }

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
    // Give the popover up to 2 s to render after the click before failing
    // the iteration. With `timeout: 0`, the next iteration's Escape would
    // race the popover-open animation and close it before Sign Out paints
    // — observed deterministically when develop-ui's beforeAll added an
    // earlier SSO login from the same shopper, which made the popover
    // settle slightly slower than it used to.
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible({ timeout: 2_000 });
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
 * Check whether the user is logged in and, if not, sign in via the user menu.
 * Useful before homepage prompt submission so the test does not depend on the
 * submit → 401 → SSO chain, which is unreliable on slower test environments.
 */
export async function loginIfNeeded(page: Page, timeout: number = SSO_TIMEOUT): Promise<void> {
  const menuTrigger = userMenuTrigger(page);
  await menuTrigger.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  await menuTrigger.click({ force: true });

  // Verify the popover actually opened before reading its contents. A
  // `force: true` click bypasses the actionability check, so if an overlay
  // covers the trigger (the `Projects` popover is the known case on the
  // homepage) the click fires at covered coordinates and the user menu
  // never opens. Previously the code then just observed "Sign Out not
  // visible" and incorrectly treated an authenticated user as unauthenticated,
  // calling `signIn()` which timed out waiting for a "Sign In" button that
  // never appeared (the menu showed "Sign Out" instead). Wait for the
  // popover-open data-state, and surface a clear error if it doesn't open.
  const openPopover = page.locator('[data-slot="popover-content"][data-state="open"]');
  try {
    await openPopover.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  } catch {
    throw new Error(
      'loginIfNeeded: user-menu popover did not open after click — likely covered by another overlay. ' +
      'Call `dismissOverlays(page)` (or close `Projects` explicitly) before `loginIfNeeded(page)`.',
    );
  }

  // Now that we know the popover is open, both Sign Out (authed) and
  // Sign In (unauthed) live inside it. Scope to the popover so we don't
  // pick up a header-chrome Sign In button.
  const signOutInPopover = openPopover.getByRole('button', { name: /sign\s*out|builder_user_menu_signout/i });
  const alreadyAuthed = await signOutInPopover.isVisible({ timeout: SHORT_TIMEOUT });
  await page.keyboard.press('Escape');

  if (alreadyAuthed) {
    console.log('Already authenticated, skipping login');
    return;
  }

  console.log('Not authenticated — signing in via user menu...');
  await signIn(page);
  await handleSsoLogin(page, timeout);

  await verifyAuthenticated(page);
  console.log('✅ Login confirmed');
}

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
