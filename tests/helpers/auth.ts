import type { Page, BrowserContext, FrameLocator } from '@playwright/test';
import { expect } from '@playwright/test';

import { getCredentials, getEnvConfig, DEFAULT_TIMEOUT, SSO_TIMEOUT, SSO_POST_LOAD_DRAIN_MS, SHORT_TIMEOUT } from './constants';
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
 * Drain a chain of JS-initiated redirects that fire AFTER a page's initial
 * 'load'. The post-login SSO landing page bounces through several hosts
 * (observed: www.godaddy.com → account.godaddy.com → …), each hop firing
 * after the previous hop's 'load'. A caller's `page.goto('/')` that races an
 * in-flight hop receives `net::ERR_ABORTED` (VNEXT-81338), so we settle the
 * whole chain here before returning to the caller.
 *
 * Bounded two ways so a pathological redirect loop can never hang the suite:
 *   - at most `maxHops` iterations, and
 *   - each iteration waits at most SSO_POST_LOAD_DRAIN_MS for the NEXT hop to
 *     start; when none starts within that window the chain has settled and we
 *     return.
 *
 * Supersedes the earlier single-hop drain, which settled only one post-load
 * navigation and left a third hop racing the caller (the residual race the old
 * inline comment flagged with "a third hop would still race").
 */
async function drainPostLoadRedirects(page: Page, maxHops: number = 5): Promise<void> {
  for (let hop = 0; hop < maxHops; hop++) {
    const urlBeforeHop: string = page.url();
    const hopped: boolean = await page
      .waitForURL((url: URL) => url.toString() !== urlBeforeHop, { timeout: SSO_POST_LOAD_DRAIN_MS, waitUntil: 'commit' })
      .then(() => true)
      .catch(() => false);
    if (!hopped) {
      return; // no further redirect started within the drain window — chain settled
    }
    await page.waitForLoadState('load').catch(() => {});
  }
}

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
    // Already-authenticated SSO immediately bounces back through its redirect
    // chain; drain every hop so a caller's page.goto('/') doesn't race one.
    await drainPostLoadRedirects(page);
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
  // avoids networkidle for the same reason).
  //
  // Settle after the post-login redirect lands:
  // 1. The form detaching is the completion signal for the first hop.
  // 2. Wait for 'load' on the SSO redirect landing page (e.g. www.godaddy.com).
  // 3. Drain every further JS-initiated redirect the landing page fires AFTER
  //    'load' (observed: www.godaddy.com → account.godaddy.com → …). A caller's
  //    page.goto('/') racing any in-flight hop receives ERR_ABORTED, so the
  //    bounded loop keeps settling hops until the chain stops moving.
  await usernameInput.waitFor({ state: 'detached', timeout }).catch(() => {});
  await page.waitForLoadState('load').catch(() => {});
  await drainPostLoadRedirects(page);

  // GoDaddy may redirect to an email-validation interstitial after login.
  // "Continue to Account" skips the verification prompt and completes the
  // auth redirect so the auth_idp cookie is set for the whole domain.
  const continueButton = page.getByRole('button', { name: 'Continue to Account' });
  const interstitialPresent = await continueButton
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (interstitialPresent) {
    console.log('  SSO direct: email validation interstitial, clicking Continue to Account...');
    await continueButton.click();
    await page.waitForLoadState('load').catch(() => {});
  }
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

/**
 * Name of the cookie Katana's edge reads to route a browser to a dark-release
 * artifact (0% traffic). Mirrors `KATANA_VERSION_COOKIE` in
 * `app/src/lib/mgmt-airo/katana-version.ts` — a literal here because the test
 * suite is a separate package and cannot import app internals. NOTE the
 * underscores: the cookie is `x_katana_version`, while the query-param/header
 * form is `x-katana-version` (hyphens). If the app renames it, update here.
 */
const DARK_VERSION_COOKIE = 'x_katana_version';

/**
 * Pin this browser to a dark-release build BEFORE any app page loads.
 *
 * When the release pipeline runs e2e/regression against a dark deploy it sets
 * `DARK_URL` (= `https://<builder-host>?x-katana-version=<sha>&cookie=1`). We
 * seed the `x_katana_version` cookie (value = that `<sha>` selector) onto the
 * context so Katana's edge routes every request — including the very first
 * top-level navigation — to the dark artifact, and so the BFF forwards the
 * selector to the hosting calls (apps the run *creates* then land on the dark
 * agent/preview/publish images too).
 *
 * Why `context.addCookies`, not `addInitScript` like `seedReturningUserCookie`:
 * the returning-user cookie is read client-side AFTER the document loads, so an
 * init script (which runs before page scripts) is in time. Dark routing is
 * decided by the edge on the initial top-level GET — sent BEFORE any init
 * script runs — so the cookie must already be on the context. `addCookies`
 * puts it there; an init script would route the first page load to stable.
 *
 * Fails loud when `DARK_URL` is set but unparseable / missing the selector:
 * silently falling through would route to the STABLE build and report a false
 * green for the dark run. No-op when `DARK_URL` is unset (the normal path).
 * Call once per test BEFORE the first `page.goto`.
 */
export async function seedDarkVersionCookie(page: Page): Promise<void> {
  const darkUrl = process.env.DARK_URL;
  if (!darkUrl) {
    return; // normal, non-dark run — nothing to pin
  }
  let parsed: URL;
  try {
    parsed = new URL(darkUrl);
  } catch {
    throw new Error(`[dark] DARK_URL is set but is not a valid URL: ${darkUrl}`);
  }
  const selector = parsed.searchParams.get('x-katana-version');
  if (!selector) {
    throw new Error(`[dark] DARK_URL is set but has no x-katana-version selector: ${darkUrl}`);
  }
  await page.context().addCookies([
    {
      name: DARK_VERSION_COOKIE,
      value: selector,
      domain: parsed.hostname,
      path: '/',
      secure: true,
      // Match the live ingress cookie (SameSite=None; Secure, per katana-version.ts) so the
      // dark cookie behaves identically to prod in cross-site/iframe contexts, not just
      // top-level navigation. None requires Secure, which is set above.
      sameSite: 'None',
    },
  ]);
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
 * URL of the full-page SSO login redirect across envs (sso.godaddy.com,
 * sso.test-godaddy.com, sso.dev-godaddy.com). Single source of truth so the
 * synchronous URL checks and the redirect racer in `handleReauthIfPresent`
 * cannot drift.
 */
const SSO_REDIRECT_LOGIN_URL = /sso\.(test-|dev-)?godaddy\.com\/login/i;

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
 *
 * SSO Lite (progressive login): when the `appbuilder-sso-lite` Switchboard
 * flag is on, the sign-in page shows an email-first "Welcome" form with a
 * "Continue" button and no password field. E2E tests use username/password
 * credentials, so we detect the progressive page and click the "username or
 * customer #?" fallback link to reach the standard form.
 */
async function fillCredentials(context: Page | FrameLocator, username: string, password: string): Promise<void> {
  // Detect SSO Lite progressive login page (email-only + "Continue" button,
  // no password field). If found, click the fallback link to reach the
  // standard username/password form that E2E tests can automate.
  // Race the password field against the progressive fallback link — whichever
  // appears first determines which page loaded, regardless of load speed.
  const passwordField = context.locator('input[type="password"]').first();
  const progressiveFallbackLink = context.getByRole('link', { name: /username or customer/i }).first();

  const formType = await Promise.race([
    passwordField.waitFor({ state: 'attached', timeout: DEFAULT_TIMEOUT }).then(() => 'standard' as const).catch(() => null),
    progressiveFallbackLink.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT }).then(() => 'progressive' as const).catch(() => null),
  ]);

  if (formType === 'progressive') {
    console.log('  Progressive login detected — switching to username/password form');
    await progressiveFallbackLink.click();
    await passwordField.waitFor({ state: 'attached', timeout: DEFAULT_TIMEOUT });
  }

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
    await expect(page.getByTestId('user-menu-item-sign-out')).toBeVisible({ timeout: 2_000 });
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
  await page.getByTestId('user-menu-item-sign-out').click();
}

/**
 * Click Sign In from user menu
 */
export async function signIn(page: Page): Promise<void> {
  const menuTrigger = userMenuTrigger(page);

  await menuTrigger.click({ force: true });
  await page.getByTestId('user-menu-item-sign-in').click();
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
  if (SSO_REDIRECT_LOGIN_URL.test(page.url())) {
    console.log('  Full-page SSO redirect detected, re-authenticating...');
    await handleSsoLogin(page);
    console.log('  Re-authenticated from SSO redirect');
    return true;
  }

  const ssoIframe = page.locator(SSO_IFRAME_SELECTOR).first();
  const ssoModal = signInModalLocator(page);

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
    page.waitForURL(SSO_REDIRECT_LOGIN_URL, { timeout: SHORT_TIMEOUT }).then(() => 'sso-redirect' as const).catch(() => null),
  ]);

  // Promise.race settles as soon as ANY branch resolves — including a racer's
  // SHORT_TIMEOUT resolving to null. A gasket-auth top-window bounce that lands
  // mid-window is therefore missed (the race already returned null). Re-check
  // the URL synchronously after the race so a redirect that arrived during the
  // detection window is still caught, instead of returning false and letting
  // the caller run against the SSO page (the chat-input fill then times out at
  // 30s — the symptom seen on long prod regression tests).
  if (!detected) {
    if (SSO_REDIRECT_LOGIN_URL.test(page.url())) {
      console.log('  Full-page SSO redirect detected after detection window, re-authenticating...');
      await handleSsoLogin(page);
      console.log('  Re-authenticated from SSO redirect');
      return true;
    }
    return false;
  }

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
  const popoverOpened = await openPopover
    .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
    .then(() => true)
    .catch(() => false);

  if (!popoverOpened) {
    // The force-click landed at covered coordinates — the auto-opening
    // "Projects" popover (or another overlay) was over the user-menu trigger.
    // Dismiss overlays and retry the click ONCE before giving up. Escape closes
    // the Projects popover; we inline it rather than calling dismissOverlays()
    // to avoid a circular import (ui.ts already imports from this module).
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
    await menuTrigger.click({ force: true });
    try {
      await openPopover.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    } catch {
      throw new Error(
        'loginIfNeeded: user-menu popover did not open even after dismissing overlays — ' +
        'still covered by another overlay. Call `dismissOverlays(page)` before `loginIfNeeded(page)`.',
      );
    }
  }

  // Now that we know the popover is open, check for the Sign Out menu item
  // (present only when authed). The user-menu item testid is globally unique,
  // so it needs no popover-scoping to avoid header-chrome ambiguity.
  const signOutInPopover = page.getByTestId('user-menu-item-sign-out');
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
