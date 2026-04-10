import { SUPPORTED_AUTH_TYPES } from '@airo/shared/auth';

import { useAuthUIStore } from '@/stores/useAuthUIStore';
import { SHOPPER_AUTH_FAILURE_MESSAGE } from './customer-auth';
import { auth } from './features';
import { logger } from './request-context';
// Gasket configuration for Airo Builder authentication

// Extend globalThis interface for auth logging flag and config cache
declare global {
  interface GlobalThis {
    __authDisabledLogged?: boolean;
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
    isDisabled: boolean;
    isMock: boolean;
    isJWT: boolean;
  };
  sso: {
    loginUrl: string;
    logoutUrl: string;
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
        isDisabled: auth.isDisabled(),
        isMock: auth.isMock(),
        isJWT: auth.isJWT(),
        allowHeartbeat: true,
        use12HourExpiration: true,    // Passed as useNewExpiration to gd-auth
      },
      sso: {
        loginUrl: process.env.SSO_LOGIN_URL || 'https://sso.test-godaddy.com/login',
        logoutUrl: process.env.SSO_LOGOUT_URL || 'https://sso.test-godaddy.com/logout'
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
    allowHeartbeat: true,
    use12HourExpiration: true    // Passed as useNewExpiration to gd-auth (30d persistent, 12h non-persistent, 12h HBI for level 3)
  },
  // Admin access for administrative functions
  admin: {
    realm: 'jomax',
    risk: 'medium',
    groups: ['admin', 'developer'],
    allowHeartbeat: true,
    use12HourExpiration: true    // Passed as useNewExpiration to gd-auth (30d persistent, 12h non-persistent, 12h HBI for level 3)
  },
  // High security for sensitive operations
  sensitive: {
    realm: 'idp',
    risk: 'high',
    type: SUPPORTED_AUTH_TYPES,
    allowHeartbeat: true         // Keep heartbeat, but shorter expiration for security
  }
};

// GoDaddy SSO recognized params: realm, path, app, auth_reason.
// 'path' is a URI-encoded relative path; SSO appends it to the app's
// registered domain when redirecting back after authentication.
export async function getLoginUrl(returnUrl?: string): Promise<string> {
  const gasketConfig = await getGasketConfig();
  const params = new URLSearchParams({ app: 'airo-builder' });

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
    app: 'airo-builder',
    redirect: gasketConfig.redirects.logoutRedirectUrl
  });
  return `${baseUrl}?${params.toString()}`;
}

// Helper function to check if auth is disabled (now uses centralized auth system)
export async function isAuthDisabled(): Promise<boolean> {
  const { auth } = await import('./features');
  const disabled = auth.isDisabled();
  if (disabled && typeof globalThis !== 'undefined' && !globalThis.__authDisabledLogged) {
    globalThis.__authDisabledLogged = true;
  }
  return disabled;
}

// Sync auth helpers for contexts that can't await (useMemo, useCallback, constructors)
export function isAuthDisabledSync(): boolean { return auth.isDisabled(); }
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
   * When true, automatically sets needsReauth in the auth UI store on 401.
   * Defaults to true. Set to false if you want to handle 401 manually.
   */
  setAuthState?: boolean;
}

/**
 * Extended Response type that includes requiresRefresh flag for 401 responses
 */
export interface AppFetchResponse extends Response {
  /** Whether the session requires refresh (token is stale but valid) */
  requiresRefresh?: boolean;
}

/**
 * Helper function for authenticated API calls.
 * Uses plain fetch with credentials and handles 401 responses at the UI layer.
 *
 * This function NEVER redirects on 401. Instead, it:
 * 1. Extracts auth metadata from the 401 response
 * 2. Sets needsReauth in the auth UI store (unless setAuthState: false)
 * 3. Returns the response for the caller to handle
 *
 * @param url - API endpoint URL
 * @param options - Fetch options (standard RequestInit)
 * @param appOptions - Additional options for appFetch behavior
 * @returns Response from the API, with requiresRefresh flag attached for 401 responses
 *
 * @example
 * ```typescript
 * // Normal usage - 401 sets auth state, no redirect
 * const response = await appFetch('/api/sites');
 * if (response.status === 401) {
 *   // Auth state already set, UI will show login prompt via AuthBoundary
 * }
 *
 * // Handle 401 manually without setting auth state
 * const response = await appFetch('/api/sites', {}, { setAuthState: false });
 * if (response.status === 401) {
 *   // Handle manually
 * }
 * ```
 */
export async function appFetch(
  url: string,
  options?: RequestInit,
  appOptions?: AppFetchOptions
): Promise<AppFetchResponse> {
  const { setAuthState = true } = appOptions || {};

  // Normalize relative URLs for environments where the underlying fetch/auth wrapper
  // requires absolute URLs (e.g., some server/test runtimes).
  const resolvedUrl =
    typeof window !== 'undefined' && typeof url === 'string' && url.startsWith('/')
      ? new URL(url, window.location.origin).toString()
      : url;

  // Always use plain fetch with credentials - never use authFetch which auto-redirects
  const response: AppFetchResponse = await fetch(resolvedUrl, {
    ...options,
    credentials: 'include'
  });

  // Handle 401 responses at the UI layer
  if (response.status === 401) {
    let requiresRefresh = false;
    let authReason: number | undefined;

    // Extract requiresRefresh and authReason from response body
    try {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        // Clone response so caller can still read the body
        const data = await response.clone().json();
        requiresRefresh = data.requiresRefresh ?? false;
        response.requiresRefresh = requiresRefresh;
        authReason = data.authReason ?? undefined;

        logger.debug('app-fetch.auth-required', {
          message: '401 response - authentication required',
          requiresRefresh,
          authReason,
          url: resolvedUrl
        });
      }
    } catch (error) {
      logger.debug('app-fetch.parse-error', {
        message: 'Could not parse 401 response',
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Set auth state in UI store (client-side only)
    if (setAuthState && typeof window !== 'undefined') {
      const reason = requiresRefresh ? 'session_stale' : 'not_authenticated';
      useAuthUIStore.getState().setNeedsReauth(reason, requiresRefresh, authReason);
    }
  }

  // Check specifically for shopper ID authorization failure (403 only)
  if (response.status === 403) {
    try {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const data = await response.clone().json();
        // Only redirect for the specific shopper ID authorization error message
        if (data.message && data.message.includes(SHOPPER_AUTH_FAILURE_MESSAGE)) {
          // Only redirect on client-side
          if (typeof window !== 'undefined') {
            window.location.href = '/coming-soon';
          }
        }
      }
    } catch (error) {
      // If we can't parse the response, just return it normally
      logger.debug('app-fetch.parse.error', {
        message: 'Could not parse response for access check',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return response;
}
