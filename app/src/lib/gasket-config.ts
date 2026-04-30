import { SUPPORTED_AUTH_TYPES } from '@airo/shared/auth';

import { useAuthUIStore } from '@/stores/useAuthUIStore';
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

const AUTH_PREFLIGHT_TIMEOUT_MS = 5 * 60 * 1000;
let pendingSsoPromise: Promise<'success' | 'dismiss'> | null = null;

function waitForSsoOutcome(): Promise<'success' | 'dismiss'> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};

    const timeout = setTimeout(() => {
      unsubscribe();
      // Release the modal flag so a subsequent level-3 action can re-open SSO.
      // Without this, isSsoLoginOpen remains true and openSsoLogin becomes a
      // no-op, permanently blocking auth-gated flows.
      useAuthUIStore.getState().closeSsoLogin('dismiss');
      reject(new Error('Authentication timed out'));
    }, AUTH_PREFLIGHT_TIMEOUT_MS);

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

export async function authPreflight(level: 1 | 2 | 3): Promise<Response | null> {
  if (typeof window === 'undefined') return null;

  const response = await fetch(
    `/api/auth/validate?level=${level}`,
    { method: 'GET', credentials: 'include' }
  );

  if (response.ok) return null;
  if (response.status !== 401) return response;

  const body = await response.clone().json().catch((parseErr) => {
    // WAF / proxy 401 pages are HTML, not JSON -- flag so proxy errors are
    // diagnosable separately from "backend responded with no authReason".
    logger.warn('app-fetch.auth-preflight.body-parse-failed', {
      level,
      status: response.status,
      error: parseErr instanceof Error ? parseErr.message : String(parseErr),
    });
    return null;
  });
  const authReason = typeof body?.authReason === 'number' ? body.authReason : null;

  logger.info('app-fetch.auth-preflight.reauth-required', { level, authReason });

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
      logger.warn('app-fetch.auth-preflight.redirect-url-failed', {
        level,
        reason: err instanceof Error ? err.message : String(err),
      });
      return response;
    }
    // Return a never-resolving promise; the browser is navigating away.
    return new Promise<Response | null>(() => {});
  }

  if (!pendingSsoPromise) {
    const store = useAuthUIStore.getState();
    store.setSsoAuthReason(authReason);
    store.openSsoLogin();
    pendingSsoPromise = waitForSsoOutcome().finally(() => { pendingSsoPromise = null; });
  }

  let outcome: 'success' | 'dismiss';
  try {
    outcome = await pendingSsoPromise;
  } catch (err) {
    logger.warn('app-fetch.auth-preflight.sso-wait-failed', {
      level,
      reason: err instanceof Error ? err.message : String(err),
    });
    return response;
  }

  if (outcome === 'dismiss') {
    throw new AuthDismissedError();
  }

  const retryResponse = await fetch(
    `/api/auth/validate?level=${level}`,
    { method: 'GET', credentials: 'include' }
  );

  if (!retryResponse.ok) return retryResponse;
  return null;
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
  const { authLevel } = appOptions || {};

  if (authLevel) {
    const preflightResult = await authPreflight(authLevel);
    if (preflightResult) return preflightResult;
  }

  const resolvedUrl =
    typeof window !== 'undefined' && typeof url === 'string' && url.startsWith('/')
      ? new URL(url, window.location.origin).toString()
      : url;

  const response = await fetch(resolvedUrl, {
    ...options,
    credentials: 'include'
  });

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
