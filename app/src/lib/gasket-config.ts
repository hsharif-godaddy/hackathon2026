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
}

// Runtime configuration loader (lazy - only called when needed)
async function loadRuntimeConfig(): Promise<GasketConfig> {
  // Server-side: access environment variables directly
  if (typeof window === 'undefined') {
    const config = {
      auth: {
        realm: 'idp',
        risk: 'low',
        type: ['basic'],
        authType: auth.getType(),
        isDisabled: auth.isDisabled(),
        isMock: auth.isMock(),
        isJWT: auth.isJWT(),
        allowHeartbeat: true,
        use12HourExpiration: true,
      },
      sso: {
        loginUrl: process.env.SSO_LOGIN_URL || 'https://sso.test-godaddy.com/login',
        logoutUrl: process.env.SSO_LOGOUT_URL || 'https://sso.test-godaddy.com/logout'
      },
      redirects: {
        loginRedirectUrl: process.env.LOGIN_REDIRECT_URL || 'https://airo-builder.test-godaddy.com/',
        logoutRedirectUrl: process.env.LOGOUT_REDIRECT_URL || 'https://airo-builder.test-godaddy.com/'
      }
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
    type: ['basic'],
    allowHeartbeat: true,        // Enable automatic token refresh
    use12HourExpiration: true    // Use longer token expiration
  },
  // Admin access for administrative functions
  admin: {
    realm: 'jomax',
    risk: 'medium',
    groups: ['admin', 'developer'],
    allowHeartbeat: true,
    use12HourExpiration: true
  },
  // High security for sensitive operations
  sensitive: {
    realm: 'idp',
    risk: 'high',
    type: ['basic'],
    allowHeartbeat: true         // Keep heartbeat, but shorter expiration for security
  }
};

// Helper function to get login URL with redirect (async version for runtime config)
export async function getLoginUrl(returnUrl?: string): Promise<string> {
  const gasketConfig = await getGasketConfig();
  const baseUrl = gasketConfig.sso.loginUrl;
  // Use configured redirect URL or provided returnUrl
  const redirectUrl = returnUrl || gasketConfig.redirects.loginRedirectUrl;
  const params = new URLSearchParams({
    app: 'airo-builder',
    redirect: redirectUrl
  });
  return `${baseUrl}?${params.toString()}`;
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
 * Auth metadata extracted from 401 responses.
 * These flags are set by the server in customer-auth.ts
 */
export interface AuthResponseMetadata {
  /** True when the request requires authentication */
  requiresAuth?: boolean;
  /** True when the token is stale and needs refresh */
  requiresRefresh?: boolean;
  /** Age of the token's issued-at time in minutes */
  iatAgeMinutes?: number;
  /** Age of the token's validated-at time in minutes */
  vatAgeMinutes?: number;
}

/**
 * Extended Response type that includes auth metadata for 401 responses
 */
export interface AppFetchResponse extends Response {
  /** Auth metadata extracted from 401 response body */
  authMetadata?: AuthResponseMetadata;
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
 * @returns Response from the API, with authMetadata attached for 401 responses
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
    let authMetadata: AuthResponseMetadata = {};

    // Extract auth metadata from response body
    try {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        // Clone response so caller can still read the body
        const data = await response.clone().json();
        authMetadata = {
          requiresAuth: data.requiresAuth,
          requiresRefresh: data.requiresRefresh,
          iatAgeMinutes: data.iatAgeMinutes,
          vatAgeMinutes: data.vatAgeMinutes
        };
        response.authMetadata = authMetadata;

        logger.debug('app-fetch.auth-required', {
          message: '401 response - authentication required',
          requiresAuth: data.requiresAuth,
          requiresRefresh: data.requiresRefresh,
          url: resolvedUrl
        });
      }
    } catch (error) {
      logger.debug('app-fetch.auth-metadata.parse-error', {
        message: 'Could not parse 401 response for auth metadata',
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Set auth state in UI store (client-side only)
    if (setAuthState && typeof window !== 'undefined') {
      const reason = authMetadata.requiresRefresh ? 'session_stale' : 'not_authenticated';
      useAuthUIStore.getState().setNeedsReauth(reason, undefined, authMetadata);
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
