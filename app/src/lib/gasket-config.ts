import { SUPPORTED_AUTH_TYPES } from '@airo/shared/auth';

import { useAuthUIStore } from '@/stores/useAuthUIStore';
import { sleep } from '@/utils/common';
import { getRootDomain } from '@/utils/getRootDomain';
import { SHOPPER_AUTH_FAILURE_MESSAGE } from './customer-auth';
import { auth } from './features';
import { logger } from './request-context';
// Gasket configuration for Airo Builder authentication

// Extend globalThis interface for auth logging flag and config cache
declare global {
  interface GlobalThis {
    __gasketConfigCache?: GasketConfig;
    __gasketConfigPromise?: Promise<GasketConfig>;
  }
}

export interface GasketConfig {
  auth: {
    realm: string;
    risk: string;
    type: string[];
    authType: string;
    isMock: boolean;
    isJWT: boolean;
  };
  sso: {
    loginUrl: string;
    logoutUrl: string;
    appName: string;
  };
  redirects: {
    loginRedirectUrl: string;
    logoutRedirectUrl: string;
  };
  supportUrl: string;
}

// Runtime configuration loader (lazy - only called when needed)
async function loadRuntimeConfig(): Promise<GasketConfig> {
  // Server-side: access environment variables directly
  if (typeof window === 'undefined') {
    const config = {
      auth: {
        realm: 'idp',
        risk: 'low',
        type: [...SUPPORTED_AUTH_TYPES],
        authType: auth.getType(),
        isMock: auth.isMock(),
        isJWT: auth.isJWT(),
        allowHeartbeat: false,
        use12HourExpiration: true,
      },
      sso: {
        loginUrl: process.env.SSO_LOGIN_URL || 'https://sso.test-godaddy.com/login',
        logoutUrl: process.env.SSO_LOGOUT_URL || 'https://sso.test-godaddy.com/logout',
        appName: process.env.SSO_APP_NAME || 'airo-builder',
      },
      redirects: {
        loginRedirectUrl: process.env.LOGIN_REDIRECT_URL || 'https://airo-builder.test-godaddy.com/',
        logoutRedirectUrl: process.env.LOGOUT_REDIRECT_URL || 'https://airo-builder.test-godaddy.com/'
      },
      supportUrl: process.env.SUPPORT_URL || 'https://www.godaddy.com/help/contact-us'
    };

    return config;
  }

  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      throw new Error(`Config API error: ${response.status} ${response.statusText}`);
    }

    const config = await response.json();

    return config;
  } catch (error) {
    logger.error('🔧 Failed to load runtime config - no fallback available:', error);
    throw new Error(`Configuration loading failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Get configuration (async, cached, lazy)
export async function getGasketConfig(): Promise<GasketConfig> {
  // Return cached config if available
  if (typeof globalThis !== 'undefined' && globalThis.__gasketConfigCache) {
    return globalThis.__gasketConfigCache;
  }

  // Return existing promise if already loading
  if (typeof globalThis !== 'undefined' && globalThis.__gasketConfigPromise) {
    return globalThis.__gasketConfigPromise;
  }

  // Load and cache configuration
  const configPromise = loadRuntimeConfig().then(config => {
    if (typeof globalThis !== 'undefined') {
      globalThis.__gasketConfigCache = config;
      globalThis.__gasketConfigPromise = undefined; // Clear promise after resolution
    }
    return config;
  }).catch(error => {
    logger.error('🔧 Failed to load gasket config:', error);

    if (typeof globalThis !== 'undefined') {
      globalThis.__gasketConfigPromise = undefined; // Clear promise on error
    }

    // Re-throw the error instead of using fallback
    throw error;
  });

  if (typeof globalThis !== 'undefined') {
    globalThis.__gasketConfigPromise = configPromise;
  }

  return configPromise;
}

// Synchronous access to configuration is no longer supported
// Use getGasketConfig() async function instead
export const gasketConfig = null;

// Auth configuration options for different parts of the app
export const authConfigs = {
  // Basic user access for most pages
  user: {
    realm: 'idp',
    risk: 'low',
    type: SUPPORTED_AUTH_TYPES,
    allowHeartbeat: false,
    use12HourExpiration: true    // Passed as useNewExpiration to gd-auth (30d persistent, 12h non-persistent, 12h HBI for level 3)
  },
  // Admin access for administrative functions
  admin: {
    realm: 'jomax',
    risk: 'medium',
    groups: ['admin', 'developer'],
    allowHeartbeat: false,
    use12HourExpiration: true    // Passed as useNewExpiration to gd-auth (30d persistent, 12h non-persistent, 12h HBI for level 3)
  },
  // High security for sensitive operations
  sensitive: {
    realm: 'idp',
    risk: 'high',
    type: SUPPORTED_AUTH_TYPES,
    allowHeartbeat: false,
    use12HourExpiration: true    // Passed as useNewExpiration to gd-auth (30d persistent, 12h non-persistent, 12h HBI for level 3)
  }
};

// GoDaddy SSO recognized params: realm, path, app, auth_reason.
// 'path' is a URI-encoded relative path; SSO appends it to the app's
// registered domain when redirecting back after authentication.
export async function getLoginUrl(returnUrl?: string): Promise<string> {
  const gasketConfig = await getGasketConfig();
  const params = new URLSearchParams({ app: gasketConfig.sso.appName });

  const target = returnUrl || gasketConfig.redirects.loginRedirectUrl;
  if (target) {
    try {
      const url = new URL(target, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      const path = url.pathname + url.search + url.hash;
      if (path.startsWith('/') && path !== '/') {
        // URLSearchParams encodes /, ?, = etc., keeping the value opaque to SSO
        params.set('path', path);
      }
    } catch {
      if (target.startsWith('/') && target !== '/') {
        params.set('path', target);
      }
    }
  }

  return `${gasketConfig.sso.loginUrl}?${params.toString()}`;
}

// Helper function to get logout URL (async version for runtime config)
export async function getLogoutUrl(): Promise<string> {
  const gasketConfig = await getGasketConfig();
  const baseUrl = gasketConfig.sso.logoutUrl;
  const params = new URLSearchParams({
    app: gasketConfig.sso.appName,
    redirect: gasketConfig.redirects.logoutRedirectUrl
  });
  return `${baseUrl}?${params.toString()}`;
}

// Sync auth helpers for contexts that can't await (useMemo, useCallback, constructors)
export function isAuthMockSync(): boolean { return auth.isMock(); }
export function isAuthJWTSync(): boolean { return auth.isJWT(); }
export function getAuthTypeSync(): string { return auth.getType(); }

// SSO host helpers
export function getSsoHostSync(): string {
  try {
    const ssoUrl = process.env.SSO_LOGIN_URL || 'https://sso.test-godaddy.com/login';
    return new URL(ssoUrl).hostname;
  } catch {
    return 'sso.test-godaddy.com';
  }
}

export async function getSsoHost(): Promise<string> {
  const config = await getGasketConfig();
  try {
    return new URL(config.sso.loginUrl).hostname;
  } catch {
    return 'sso.test-godaddy.com';
  }
}

/**
 * Options for appFetch beyond standard RequestInit
 */
export interface AppFetchOptions {
  /**
   * When set, validates auth at this level before making the request.
   * If validation fails (401), opens SSO modal and waits for completion.
   * On successful re-auth, retries validation then proceeds with the request.
   * On SSO dismiss or timeout, returns the 401 response.
   */
  authLevel?: 1 | 2 | 3;
  /**
   * When set, a 401 from the request is funneled through resolveAuth and the
   * request is retried once on successful re-auth. Use this for endpoints that
   * are not gated by an authLevel preflight (e.g. polling endpoints) so that
   * concurrent 401s collapse into a single SSO modal instead of racing.
   *
   * `true` probes at level 2 (default for IAT-based failures). Pass
   * `{ level: 3 }` for level-3 endpoints so HBI failures route to /hbi
   * instead of being masked by a level-2 probe that succeeds.
   */
  handle401?: boolean | { level: 1 | 2 | 3 };
}

export class AuthDismissedError extends Error {
  constructor() {
    super('Authentication dismissed');
    this.name = 'AuthDismissedError';
  }
}

// Thrown by hooks when a gated endpoint returns 401 (authReason:2) — i.e. the
// preflight modal timed out, the user re-auth failed, or an intermediate
// token became stale. Typed so retry predicates and onError handlers can
// distinguish it from generic server errors and avoid reopening the SSO
// modal in a retry loop.
export class AuthSessionExpiredError extends Error {
  constructor() {
    super('Authentication session expired');
    this.name = 'AuthSessionExpiredError';
  }
}

export const AUTH_PREFLIGHT_TIMEOUT_MS = 5 * 60 * 1000;
export const SSO_TIMEOUT_OVERRIDE_KEY = '__airo_sso_timeout';
// Round-trip to /api/auth/validate. Short because the user is not in the loop;
// the modal-wait below has its own 5-minute timeout.
export const AUTH_PROBE_TIMEOUT_MS = 5_000;

// authReason returned by gd-auth when the SSO `vat` (validated-at) claim is
// stale. The browser ui_heartbeat refreshes vat out-of-band after the tab
// wakes, but it has no wake trigger, so the first validate after wake can 401
// before the heartbeat lands. These bound a spaced re-probe (3 × 2s = 6s
// ceiling) that bridges the common fast-recovery window before we show the SSO
// modal; wakes that refresh slower than the budget still fall through to the
// modal. Only vat is retried — HBI/login failures can't be self-refreshed by
// the heartbeat.
const VAT_AUTH_REASON = 3;
const VAT_RECOVERY_MAX_ATTEMPTS = 3;
const VAT_RECOVERY_DELAY_MS = 2_000;

/**
 * Outcome of resolveAuth(). The mutex collapses concurrent 401s into one of
 * these results so every caller sees the same decision.
 */
export type AuthResolution =
  | { kind: 'valid' }                         // probe says token is fine; original 401 was transient
  | { kind: 'reauthed' }                      // SSO completed and verify confirmed the new cookie
  | { kind: 'dismissed' }                     // user closed the modal without authenticating
  | { kind: 'failed'; response: Response };   // probe returned non-401, or post-SSO verify failed

let pendingResolution: Promise<AuthResolution> | null = null;

function waitForSsoOutcome(): Promise<'success' | 'dismiss'> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};

    const isDebugEnabled = typeof window !== 'undefined' && localStorage.getItem('__airo_debug') === '1';
    const raw = isDebugEnabled ? localStorage.getItem(SSO_TIMEOUT_OVERRIDE_KEY) : null;
    const parsed = raw !== null ? Number(raw) : NaN;
    const timeoutMs = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1000), AUTH_PREFLIGHT_TIMEOUT_MS)
      : AUTH_PREFLIGHT_TIMEOUT_MS;

    const timeout = setTimeout(() => {
      unsubscribe();
      // Release the modal flag so a subsequent level-3 action can re-open SSO.
      // Without this, isSsoLoginOpen remains true and openSsoLogin becomes a
      // no-op, permanently blocking auth-gated flows.
      useAuthUIStore.getState().closeSsoLogin('dismiss');
      reject(new Error('Authentication timed out'));
    }, timeoutMs);

    unsubscribe = useAuthUIStore.subscribe((state, prevState) => {
      if (
        state.ssoCloseReason !== prevState.ssoCloseReason &&
        (state.ssoCloseReason === 'success' || state.ssoCloseReason === 'dismiss')
      ) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(state.ssoCloseReason);
      }
    });
  });
}

/**
 * Probe /api/auth/validate?level=N with a short timeout. Returns 'timeout'
 * rather than throwing so the caller can choose a fallback.
 */
async function probeAuthValidate(level: 1 | 2 | 3): Promise<Response | 'timeout'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_PROBE_TIMEOUT_MS);
  try {
    return await fetch(`/api/auth/validate?level=${level}`, {
      method: 'GET',
      credentials: 'include',
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) return 'timeout';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bridge a transient stale-vat (authReason 3) 401. The browser ui_heartbeat
 * refreshes `vat` out-of-band shortly after the tab wakes, but it has no wake
 * trigger, so the first validate after wake can 401 before the heartbeat
 * lands. Re-probe a few times, spaced out, so a stale vat that refreshes
 * within the budget recovers silently instead of bouncing the user to the SSO
 * modal. A re-probe that throws (transient network blip — likely in this exact
 * just-online window) counts as a failed attempt rather than aborting recovery
 * and rejecting resolveAuth. This is a bounded best-effort bridge, not a
 * guarantee: wakes that refresh slower than the budget fall through to the
 * modal. Returns true once a re-probe confirms the token is valid, false when
 * the budget is exhausted.
 */
async function recoverStaleVat(level: 1 | 2 | 3): Promise<boolean> {
  let lastOutcome = 'unknown';
  for (let attempt = 1; attempt <= VAT_RECOVERY_MAX_ATTEMPTS; attempt++) {
    await sleep(VAT_RECOVERY_DELAY_MS);
    try {
      const probe = await probeAuthValidate(level);
      if (probe !== 'timeout' && probe.ok) {
        logger.info('app-fetch.auth-resolve.vat-recovered', { level, attempts: attempt });
        return true;
      }
      lastOutcome = probe === 'timeout' ? 'timeout' : String(probe.status);
    } catch (err) {
      lastOutcome = 'error';
      logger.warn('app-fetch.auth-resolve.vat-recovery-probe-error', {
        level,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  logger.warn('app-fetch.auth-resolve.vat-recovery-exhausted', {
    level,
    attempts: VAT_RECOVERY_MAX_ATTEMPTS,
    lastOutcome,
  });
  return false;
}

export interface ResolveAuthOptions {
  /**
   * Level to probe at. Defaults to 2. Pass 3 to detect HBI step-up failures
   * for sensitive operations.
   */
  level?: 1 | 2 | 3;
}

/**
 * Single source of truth for "what should happen next when auth is in question."
 *
 * The whole sequence -- probe → modal → verify -- runs under one in-flight
 * promise (`pendingResolution`). Concurrent callers join the same promise so a
 * burst of 401s during e.g. a publish flow collapses to one probe + one modal
 * + one verify, instead of N modals racing each other and reloading the page
 * mid-render.
 *
 * The probe drives `pageToLoad` selection: a level-3 401 returns `authReason:
 * 2` (HBI), which routes the SsoDeck to /hbi instead of /login. Picking the
 * page from the probe response also covers paths where the original 401 had
 * no parseable body (WAF/proxy HTML, control-plane re-throws, raw fetches
 * outside appFetch).
 */
export async function resolveAuth(options: ResolveAuthOptions = {}): Promise<AuthResolution> {
  if (typeof window === 'undefined') return { kind: 'valid' };

  if (pendingResolution) return pendingResolution;

  const level = options.level ?? 2;

  pendingResolution = (async () => {
    try {
      const probe = await probeAuthValidate(level);

      if (probe === 'timeout') {
        // Couldn't reach validate. Open the modal as a safe default with a
        // null authReason → /login. Better an occasional spurious prompt than
        // surfacing "we don't know if you're authed."
        logger.warn('app-fetch.auth-resolve.probe-timeout', { level });
        return openModalAndVerify(level, null);
      }

      if (probe.ok) {
        // Token is valid at this level — original 401 was transient or
        // server-side. Caller may retry.
        return { kind: 'valid' };
      }

      if (probe.status !== 401) {
        return { kind: 'failed', response: probe };
      }

      const body = await probe.clone().json().catch((parseErr: unknown) => {
        // WAF / proxy 401 pages are HTML, not JSON -- flag so proxy errors are
        // diagnosable separately from "backend responded with no authReason".
        // Narrow to SyntaxError so unexpected error classes (e.g. body already
        // consumed) bubble up rather than silently being treated as "no JSON."
        if (parseErr instanceof SyntaxError) {
          logger.warn('app-fetch.auth-resolve.body-parse-failed', {
            level,
            status: probe.status,
            error: parseErr.message,
          });
          return null;
        }
        logger.error('app-fetch.auth-resolve.body-parse-error', {
          level,
          status: probe.status,
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        });
        return null;
      });
      const authReason = typeof body?.authReason === 'number' ? body.authReason : null;
      logger.info('app-fetch.auth-resolve.reauth-required', { level, authReason });

      // Stale vat self-heals once the browser ui_heartbeat catches up. Spaced
      // re-probe to bridge that window before disturbing the user with the
      // modal. Runs inside pendingResolution, so a burst of 401s shares one
      // recovery loop. Only vat (3) is recoverable this way.
      if (authReason === VAT_AUTH_REASON && (await recoverStaleVat(level))) {
        return { kind: 'valid' };
      }

      return openModalAndVerify(level, authReason, probe);
    } finally {
      pendingResolution = null;
    }
  })();

  return pendingResolution;
}

async function openModalAndVerify(
  level: 1 | 2 | 3,
  authReason: number | null,
  probeResponse?: Response,
): Promise<AuthResolution> {
  // Env gate mirrors useSsoSignIn: prod (sso.godaddy.com is public) and local
  // dev (localhost) can render the SSO Deck iframe; deployed test/dev must do
  // a full-page redirect because Chrome's Private Network Access check blocks
  // the iframe against sso.<test|dev>-godaddy.com.
  const canUseSsoModal =
    process.env.NODE_ENV === 'development' || getRootDomain() === 'godaddy.com';

  if (!canUseSsoModal) {
    try {
      window.location.href = await getLoginUrl(window.location.href);
    } catch (err) {
      logger.warn('app-fetch.auth-resolve.redirect-url-failed', {
        level,
        reason: err instanceof Error ? err.message : String(err),
      });
      const failureResponse = probeResponse ?? new Response(null, { status: 401 });
      return { kind: 'failed', response: failureResponse };
    }
    // Browser is navigating away — never resolve so callers don't continue.
    // Release the mutex synchronously so a later call (e.g. navigation
    // failed mid-flight, popup blocked) starts a fresh probe instead of
    // joining this dead promise. The IIFE's finally won't run because the
    // never-resolving promise prevents it from settling.
    pendingResolution = null;
    return new Promise<AuthResolution>(() => {});
  }

  const store = useAuthUIStore.getState();
  store.setSsoAuthReason(authReason);
  if (!store.redirectUrl) {
    store.setRedirectUrl(window.location.href);
  }
  if (store.isSsoLoginOpen) {
    // A different caller (e.g. useSsoSignIn, sso-debug) already owns this
    // modal. Don't flip inFlightReauth — that would change the semantics of
    // their post-auth flow. The verify probe will pick up cookie propagation
    // if their auth happens to satisfy our level.
    logger.warn('app-fetch.auth-resolve.modal-already-open', { level, authReason });
  } else {
    // Mark this open as a mid-mutation step-up. SsoLogin reads this flag and
    // skips its post-auth navigation so the awaiting fetch can resume in
    // place without reloading the page and abandoning the request.
    store.setInFlightReauth(true);
    store.openSsoLogin();
  }

  let outcome: 'success' | 'dismiss';
  try {
    outcome = await waitForSsoOutcome();
  } catch (err) {
    logger.warn('app-fetch.auth-resolve.sso-wait-failed', {
      level,
      reason: err instanceof Error ? err.message : String(err),
    });
    const failureResponse = probeResponse ?? new Response(null, { status: 401 });
    return { kind: 'failed', response: failureResponse };
  }

  if (outcome === 'dismiss') {
    logger.info('app-fetch.auth-resolve.sso-dismissed', { level });
    return { kind: 'dismissed' };
  }

  // Verify cookie propagated. Optimistic on timeout: assume the login worked
  // and let the caller retry. If the cookie really is bad, the retry will 401
  // and the next resolveAuth() call will sort it out.
  const verify = await probeAuthValidate(level);
  if (verify === 'timeout') {
    logger.warn('app-fetch.auth-resolve.verify-timeout', { level });
    return { kind: 'reauthed' };
  }
  if (!verify.ok) {
    logger.error('app-fetch.auth-resolve.verify-failed', { level, status: verify.status });
    return { kind: 'failed', response: verify };
  }
  return { kind: 'reauthed' };
}

/**
 * Backward-compatible proactive preflight. Validate at `level` before making
 * the original request. Thin wrapper over resolveAuth that adapts to the
 * legacy return contract (null = ok, Response = give up, throw = dismissed).
 */
export async function authPreflight(level: 1 | 2 | 3): Promise<Response | null> {
  if (typeof window === 'undefined') return null;

  const result = await resolveAuth({ level });
  switch (result.kind) {
    case 'valid':
    case 'reauthed':
      return null;
    case 'dismissed':
      throw new AuthDismissedError();
    case 'failed':
      return result.response;
  }
}

/**
 * Authenticated fetch. Uses plain fetch with credentials.
 * 401 responses are returned to the caller -- Gasket Auth detects
 * expired sessions via its validation cycle and triggers SSO.
 */
export async function appFetch(
  url: string,
  options?: RequestInit,
  appOptions?: AppFetchOptions
): Promise<Response> {
  const { authLevel, handle401 } = appOptions || {};

  if (authLevel) {
    const preflightResult = await authPreflight(authLevel);
    if (preflightResult) return preflightResult;
  }

  const resolvedUrl =
    typeof window !== 'undefined' && typeof url === 'string' && url.startsWith('/')
      ? new URL(url, window.location.origin).toString()
      : url;

  let response = await fetch(resolvedUrl, {
    ...options,
    credentials: 'include'
  });

  // Reactive 401 handling: route through resolveAuth (single-flight) and
  // retry once on successful re-auth. Skipped if the caller already did a
  // proactive preflight at authLevel — preflight + handle401 would double
  // up the modal flow.
  if (handle401 && response.status === 401 && !authLevel && typeof window !== 'undefined') {
    const handle401Level = typeof handle401 === 'object' ? handle401.level : 2;
    const result = await resolveAuth({ level: handle401Level });
    if (result.kind === 'reauthed' || result.kind === 'valid') {
      response = await fetch(resolvedUrl, {
        ...options,
        credentials: 'include'
      });
    } else if (result.kind === 'dismissed') {
      throw new AuthDismissedError();
    } else {
      // kind: 'failed' — probe couldn't classify the failure (e.g. /api/auth/validate
      // is itself returning 5xx). Surface the original 401 to the caller's normal
      // error path; log so backend outages on validate are diagnosable.
      logger.warn('app-fetch.auth-resolve.probe-failed', {
        url: typeof url === 'string' ? url : '<non-string>',
        probeStatus: result.response.status,
      });
    }
  }

  // Check specifically for shopper ID authorization failure (403 only)
  if (response.status === 403) {
    try {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const data = await response.clone().json();
        if (data.message && data.message.includes(SHOPPER_AUTH_FAILURE_MESSAGE)) {
          if (typeof window !== 'undefined') {
            window.location.href = '/coming-soon';
          }
        }
      }
    } catch (error) {
      logger.debug('app-fetch.parse.error', {
        message: 'Could not parse response for access check',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return response;
}
