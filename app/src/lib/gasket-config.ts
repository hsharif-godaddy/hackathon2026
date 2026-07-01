import { SUPPORTED_AUTH_TYPES } from '@airo/shared/auth';

import { SWITCHBOARD_APPBUILDER_WAKE_AWARE_VAT_RECOVERY } from '@/config/switchboard-flags';
import { getSwitchboardFlag } from '@/hooks/useSwitchboard';
import { useAuthUIStore } from '@/stores/useAuthUIStore';
import { sleep } from '@/utils/common';
import { getRootDomain } from '@/utils/getRootDomain';
import { getSsoHostParams } from '@/utils/getSsoHostParams';
import { SHOPPER_AUTH_FAILURE_MESSAGE } from './customer-auth';
import { auth, type SsoExpirationCode } from './features';
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

// GoDaddy SSO recognized params: realm, path, app, port, auth_reason.
// `app` + `port` resolve to the current host's SSO registration; `path` is the
// URI-encoded relative path SSO appends after authentication.
export async function getLoginUrl(returnUrl?: string, authReason?: number | null): Promise<string> {
  const gasketConfig = await getGasketConfig();
  const { app, port }: { app: string; port: string } = getSsoHostParams(gasketConfig.sso.appName);
  const params = new URLSearchParams({ app });
  if (port) params.set('port', port);

  const target: string = returnUrl || gasketConfig.redirects.loginRedirectUrl;
  if (target) {
    try {
      const url: URL = new URL(target, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      const path: string = url.pathname + url.search + url.hash;
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

  // Forward the auth failure reason so a full-page redirect re-auth performs the
  // required step-up (e.g. HBI) instead of an ordinary login that would not
  // satisfy the level-3 requirement, leaving the post-redirect probe to 401 and
  // loop. auth_reason is a GoDaddy SSO recognized param; the SsoDeck modal path
  // already passes it via pageToLoadParams.
  if (authReason != null) {
    params.set('auth_reason', String(authReason));
  }

  return `${gasketConfig.sso.loginUrl}?${params.toString()}`;
}

function resolveLogoutParams(gasketConfig: GasketConfig): { app: string; redirect: string; port: string } {
  if (typeof window === 'undefined') {
    return {
      app: gasketConfig.sso.appName,
      redirect: gasketConfig.redirects.logoutRedirectUrl,
      port: '',
    };
  }
  let configuredOrigin: string | null = null;
  try {
    configuredOrigin = new URL(gasketConfig.redirects.logoutRedirectUrl).origin;
  } catch (err) {
    logger.warn('sso.logout.redirect-url.parse-failed', {
      url: gasketConfig.redirects.logoutRedirectUrl,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (configuredOrigin === window.location.origin) {
    return {
      app: gasketConfig.sso.appName,
      redirect: gasketConfig.redirects.logoutRedirectUrl,
      port: '',
    };
  }
  const { app, port }: { app: string; port: string } = getSsoHostParams(gasketConfig.sso.appName);
  return { app, redirect: `${window.location.origin}/`, port };
}

// Honor the env-configured redirect when its origin matches the current host;
// otherwise fall back to the host-derived params. SSO validates `redirect`
// against the (app, port) registration, so `port` rides as its own param.
export async function getLogoutUrl(): Promise<string> {
  const gasketConfig = await getGasketConfig();
  const baseUrl: string = gasketConfig.sso.logoutUrl;
  const { app, redirect, port }: { app: string; redirect: string; port: string } = resolveLogoutParams(gasketConfig);

  const params = new URLSearchParams({ app, redirect });
  if (port) params.set('port', port);

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
// before the heartbeat lands. These bound a spaced re-probe that bridges the
// common fast-recovery window before we show the SSO modal:
//   default: 3 × 2s = 6s ceiling
//   wake-aware (flag on + within wake window): 7 × 2s = 14s ceiling
// Wakes that refresh slower than the budget still fall through to the modal.
// Recovery triggers (flag-gated): authReason=3 (VAT); null authReason in wake
// window (likely stale-VAT behind WAF/proxy); probe timeout in wake window.
// HBI/login failures (authReason 1,2) can't self-refresh via heartbeat.
const VAT_AUTH_REASON: SsoExpirationCode = 3;
const VAT_RECOVERY_MAX_ATTEMPTS = 3;
const VAT_RECOVERY_DELAY_MS = 2_000;

// Wake-aware extension: after an `online` event or `visibilitychange→visible`
// (network reconnect, tab refocus, or system wake), the network may need more
// time to stabilize. Extends the retry budget when triggered within the window.
const VAT_RECOVERY_WAKE_MAX_ATTEMPTS = 7;
const VAT_RECOVERY_WAKE_WINDOW_MS = 15_000;

// Delay before signalling TQ online — gives heartbeat.js time to POST and land
// Set-Cookie before refetches fire with the old token. 1s covers the typical
// 100-500ms heartbeat round-trip with margin for cold TLS handshakes.
const HEARTBEAT_HEAD_START_MS: number = 1_000;

export const wakeTracker = (() => {
  let timestamp: number = 0;
  function mark(): void { timestamp = Date.now(); }
  function isWithinWindow(): boolean { return Date.now() - timestamp < VAT_RECOVERY_WAKE_WINDOW_MS; }
  function msSinceWake(): number { return timestamp === 0 ? Infinity : Date.now() - timestamp; }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', mark);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { mark(); }
    });
    import('@tanstack/react-query').then(({ onlineManager }) => {
      onlineManager.setEventListener((setOnline) => {
        const onlineHandler = (): void => {
          const flagEnabled: boolean =
            getSwitchboardFlag(SWITCHBOARD_APPBUILDER_WAKE_AWARE_VAT_RECOVERY) ?? false;
          if (flagEnabled) {
            setTimeout(() => { setOnline(true); }, HEARTBEAT_HEAD_START_MS);
          } else {
            setOnline(true);
          }
        };
        const offlineHandler = (): void => { setOnline(false); };
        window.addEventListener('online', onlineHandler);
        window.addEventListener('offline', offlineHandler);
        return () => {
          window.removeEventListener('online', onlineHandler);
          window.removeEventListener('offline', offlineHandler);
        };
      });
    }).catch((err: unknown) => {
      logger.warn('app-fetch.wake-tracker.online-manager-init-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
  return { mark, isWithinWindow, msSinceWake };
})();

/**
 * Outcome of resolveAuth(). The mutex collapses concurrent 401s into one of
 * these results so every caller sees the same decision.
 */
export type AuthResolution =
  | { kind: 'valid' }                         // probe says token is fine; original 401 was transient
  | { kind: 'reauthed' }                      // SSO completed and verify confirmed the new cookie
  | { kind: 'dismissed' }                     // user closed the modal without authenticating
  | { kind: 'failed'; response: Response; authReason: number | null }; // probe returned non-401, or SSO couldn't complete (wait / redirect / verify failed)

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
 * Bridge a transient stale-vat (authReason 3) 401. During wake, heartbeat.js
 * may fail (ERR_NETWORK_CHANGED) leaving the JWT stale. This function fires a
 * direct POST to the SSO heartbeat endpoint (when in the wake window) so SSO
 * issues a fresh JWT via Set-Cookie, then re-probes a few times, spaced out,
 * so the refreshed token is picked up silently instead of bouncing the user to
 * the SSO modal. A re-probe that throws (transient network blip — likely in
 * this exact just-online window) counts as a failed attempt rather than
 * aborting recovery and rejecting resolveAuth. This is a bounded best-effort
 * bridge, not a guarantee: wakes that refresh slower than the budget fall
 * through to the modal. Returns true once a re-probe confirms the token is
 * valid, false when the budget is exhausted.
 *
 * Wake-VAT recovery layers (defense in depth):
 *  1. onlineManager 1s gate (wakeTracker IIFE) — delays TQ refetches so
 *     heartbeat.js can land Set-Cookie first.
 *  2. Direct heartbeat POST here — fires when heartbeat.js failed on wake.
 *  3. awaitHeartbeatRecovery in AuthProvider — cold-launch unauthenticated.
 *  4. awaitHeartbeatRecovery in SsoLoginPrompt — protected-route fallback.
 * Layers 3-4 share a sessionStorage dedup key; layers 1-2 are independent.
 * All log under app-fetch.auth-resolve.* with msSinceWake for correlation.
 */
async function recoverStaleVat(level: 1 | 2 | 3, url: string): Promise<boolean> {
  const wakeAwareEnabled: boolean =
    getSwitchboardFlag(SWITCHBOARD_APPBUILDER_WAKE_AWARE_VAT_RECOVERY) ?? false;
  const inWakeWindow: boolean = wakeAwareEnabled && wakeTracker.isWithinWindow();
  const maxAttempts: number = inWakeWindow
    ? VAT_RECOVERY_WAKE_MAX_ATTEMPTS
    : VAT_RECOVERY_MAX_ATTEMPTS;

  if (inWakeWindow) {
    logger.info('app-fetch.auth-resolve.vat-recovery-wake-extended', {
      url,
      authReason: VAT_AUTH_REASON,
      level,
      maxAttempts,
      msSinceWake: wakeTracker.msSinceWake(),
    });

    // getSsoHost() is async but resolves from globalThis.__gasketConfigCache
    // (populated on first page load, persists through sleep). The async variant
    // is required client-side — getSsoHostSync() reads process.env which is
    // unavailable in the browser and falls back to sso.test-godaddy.com.
    const controller: AbortController = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => controller.abort(), AUTH_PROBE_TIMEOUT_MS,
    );
    try {
      const ssoHost: string = await getSsoHost();
      const heartbeatRes: Response = await fetch(
        `https://${ssoHost}/v1/api/token/ui_heartbeat`,
        { method: 'POST', credentials: 'include', signal: controller.signal },
      );
      if (!heartbeatRes.ok) {
        logger.warn('app-fetch.auth-resolve.vat-recovery-heartbeat-error', {
          url, level, status: heartbeatRes.status,
        });
      }
    } catch (err) {
      logger.warn('app-fetch.auth-resolve.vat-recovery-heartbeat-error', {
        url, level, error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  let lastOutcome: string = 'unknown';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(VAT_RECOVERY_DELAY_MS);
    try {
      const probe: Response | 'timeout' = await probeAuthValidate(level);
      if (probe !== 'timeout' && probe.ok) {
        logger.warn('app-fetch.auth-resolve.vat-recovered', {
          url,
          authReason: VAT_AUTH_REASON,
          level,
          attempts: attempt,
          wakeExtended: inWakeWindow,
        });
        return true;
      }
      lastOutcome = probe === 'timeout' ? 'timeout' : String(probe.status);
    } catch (err) {
      lastOutcome = 'error';
      logger.warn('app-fetch.auth-resolve.vat-recovery-probe-error', {
        url,
        authReason: VAT_AUTH_REASON,
        level,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  logger.warn('app-fetch.auth-resolve.vat-recovery-exhausted', {
    url,
    authReason: VAT_AUTH_REASON,
    level,
    attempts: maxAttempts,
    lastOutcome,
    wakeExtended: inWakeWindow,
  });
  return false;
}

export interface ResolveAuthOptions {
  /**
   * Level to probe at. Defaults to 2. Pass 3 to detect HBI step-up failures
   * for sensitive operations.
   */
  level?: 1 | 2 | 3;
  /** Original request URL when resolveAuth is handling a reactive 401. */
  url?: string;
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
  const url: string = options.url ?? '<preflight>';

  pendingResolution = (async () => {
    try {
      const probe = await probeAuthValidate(level);

      if (probe === 'timeout') {
        const wakeAwareEnabled: boolean =
          getSwitchboardFlag(SWITCHBOARD_APPBUILDER_WAKE_AWARE_VAT_RECOVERY) ?? false;
        const inWakeWindow: boolean = wakeAwareEnabled && wakeTracker.isWithinWindow();
        logger.warn('app-fetch.auth-resolve.probe-timeout', { url, level, authReason: null, inWakeWindow });
        // During wake, network may still be stabilizing — attempt recovery before
        // showing the modal. Heartbeat.js likely completes within the retry budget.
        if (inWakeWindow && (await recoverStaleVat(level, url))) {
          return { kind: 'valid' };
        }
        return openModalAndVerify(level, null, url);
      }

      if (probe.ok) {
        // Token is valid at this level — original 401 was transient or
        // server-side. Caller may retry.
        return { kind: 'valid' };
      }

      if (probe.status !== 401) {
        return { kind: 'failed', response: probe, authReason: null };
      }

      const body = await probe.clone().json().catch((parseErr: unknown) => {
        // WAF / proxy 401 pages are HTML, not JSON -- flag so proxy errors are
        // diagnosable separately from "backend responded with no authReason".
        // Narrow to SyntaxError so unexpected error classes (e.g. body already
        // consumed) bubble up rather than silently being treated as "no JSON."
        if (parseErr instanceof SyntaxError) {
          logger.warn('app-fetch.auth-resolve.body-parse-failed', {
            url,
            level,
            status: probe.status,
            error: parseErr.message,
          });
          return null;
        }
        logger.error('app-fetch.auth-resolve.body-parse-error', {
          url,
          level,
          status: probe.status,
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        });
        return null;
      });
      const authReason = typeof body?.authReason === 'number' ? body.authReason : null;
      logger.warn('app-fetch.auth-resolve.reauth-required', { url, level, authReason });

      // Recovery triggers:
      // 1. authReason === 3 (VAT expired) — always recoverable via heartbeat refresh
      // 2. authReason === null during wake — likely stale-VAT behind a WAF/proxy HTML
      //    response that couldn't be parsed. Outside wake, null goes straight to modal.
      const wakeAwareEnabled: boolean =
        getSwitchboardFlag(SWITCHBOARD_APPBUILDER_WAKE_AWARE_VAT_RECOVERY) ?? false;
      const inWakeWindow: boolean = wakeAwareEnabled && wakeTracker.isWithinWindow();
      if ((authReason === VAT_AUTH_REASON || (authReason === null && inWakeWindow)) &&
          (await recoverStaleVat(level, url))) {
        return { kind: 'valid' };
      }

      return openModalAndVerify(level, authReason, url, probe);
    } finally {
      pendingResolution = null;
    }
  })();

  return pendingResolution;
}

async function openModalAndVerify(
  level: 1 | 2 | 3,
  authReason: number | null,
  url: string,
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
      window.location.href = await getLoginUrl(window.location.href, authReason);
    } catch (err) {
      logger.warn('app-fetch.auth-resolve.redirect-url-failed', {
        url,
        level,
        authReason,
        reason: err instanceof Error ? err.message : String(err),
      });
      const failureResponse = probeResponse ?? new Response(null, { status: 401 });
      return { kind: 'failed', response: failureResponse, authReason };
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
    logger.warn('app-fetch.auth-resolve.modal-already-open', { url, level, authReason });
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
      url,
      level,
      authReason,
      reason: err instanceof Error ? err.message : String(err),
    });
    const failureResponse = probeResponse ?? new Response(null, { status: 401 });
    return { kind: 'failed', response: failureResponse, authReason };
  }

  if (outcome === 'dismiss') {
    logger.info('app-fetch.auth-resolve.sso-dismissed', { url, level, authReason });
    return { kind: 'dismissed' };
  }

  // Verify cookie propagated. Optimistic on timeout: assume the login worked
  // and let the caller retry. If the cookie really is bad, the retry will 401
  // and the next resolveAuth() call will sort it out.
  const verify = await probeAuthValidate(level);
  if (verify === 'timeout') {
    logger.warn('app-fetch.auth-resolve.verify-timeout', { url, level, authReason });
    return { kind: 'reauthed' };
  }
  if (!verify.ok) {
    logger.error('app-fetch.auth-resolve.verify-failed', {
      url,
      level,
      authReason,
      status: verify.status,
    });
    return { kind: 'failed', response: verify, authReason };
  }
  return { kind: 'reauthed' };
}

/**
 * Backward-compatible proactive preflight. Validate at `level` before making
 * the original request. Thin wrapper over resolveAuth that adapts to the
 * legacy return contract (null = ok, Response = give up, throw = dismissed).
 */
export async function authPreflight(level: 1 | 2 | 3, url?: string): Promise<Response | null> {
  if (typeof window === 'undefined') return null;

  const result = await resolveAuth({ level, url });
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

// Path-only, sentinel-safe value for logging the originating request. Strips
// the query string and hash so a caller that routes a token-bearing URL
// through handle401/authLevel cannot export the secret to logs (and so
// per-request query params don't fragment aggregation). Non-string inputs
// (untyped callers) collapse to a sentinel.
function toLogUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string') return '<non-string>';
  const base: string = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  try {
    return new URL(rawUrl, base).pathname;
  } catch {
    return rawUrl.split(/[?#]/)[0];
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
  const logUrl: string = toLogUrl(url);

  if (authLevel) {
    const preflightResult = await authPreflight(authLevel, logUrl);
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
    const result = await resolveAuth({ level: handle401Level, url: logUrl });
    if (result.kind === 'reauthed' || result.kind === 'valid') {
      response = await fetch(resolvedUrl, {
        ...options,
        credentials: 'include'
      });
    } else if (result.kind === 'dismissed') {
      throw new AuthDismissedError();
    } else {
      // kind: 'failed' — auth resolution failed, either before opening SSO
      // (validate non-401) or after SSO couldn't complete. Surface the original
      // 401 to the caller's normal error path and log the source URL.
      logger.warn('app-fetch.auth-resolve.probe-failed', {
        url: logUrl,
        authReason: result.authReason,
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
