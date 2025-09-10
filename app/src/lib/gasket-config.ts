// Gasket configuration for Airo App Builder authentication

// Extend globalThis type for auth logging flag and config cache
declare global {
  var __authDisabledLogged: boolean | undefined;
  var __gasketConfigCache: GasketConfig | undefined;
  var __gasketConfigPromise: Promise<GasketConfig> | undefined;
}

export interface GasketConfig {
  auth: {
    realm: string;
    risk: string;
    type: string[];
    disableInDev: boolean;
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

// Build-safe static configuration with sensible defaults
// This ensures the app works even if runtime config fails
const staticGasketConfig: GasketConfig = {
  auth: {
    realm: 'idp',
    risk: 'low',
    type: ['basic'],
    disableInDev: false // Default to secure, will be overridden by runtime config
  },
  sso: {
    loginUrl: 'https://sso.test-godaddy.com/login',
    logoutUrl: 'https://sso.test-godaddy.com/logout'
  },
  redirects: {
    loginRedirectUrl: 'https://airo-builder.test-godaddy.com/',
    logoutRedirectUrl: 'https://airo-builder.test-godaddy.com/'
  }
};

// Runtime configuration loader
async function loadRuntimeConfig(): Promise<GasketConfig> {
  // Server-side: access environment variables directly
  if (typeof window === 'undefined') {
    return {
      auth: {
        realm: 'idp',
        risk: 'low',
        type: ['basic'],
        disableInDev: process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_AUTH_IN_DEV === 'true'
      },
      sso: {
        loginUrl: process.env.NEXT_PUBLIC_SSO_LOGIN_URL || 'https://sso.test-godaddy.com/login',
        logoutUrl: process.env.NEXT_PUBLIC_SSO_LOGOUT_URL || 'https://sso.test-godaddy.com/logout'
      },
      redirects: {
        loginRedirectUrl: process.env.NEXT_PUBLIC_LOGIN_REDIRECT_URL || 'https://airo-builder.test-godaddy.com/',
        logoutRedirectUrl: process.env.NEXT_PUBLIC_LOGOUT_REDIRECT_URL || 'https://airo-builder.test-godaddy.com/'
      }
    };
  }

  // Client-side: fetch from API
  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      throw new Error(`Config API error: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.warn('Failed to load runtime config, using static config:', error);
    return staticGasketConfig;
  }
}

// Get configuration (async, cached)
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
  });

  if (typeof globalThis !== 'undefined') {
    globalThis.__gasketConfigPromise = configPromise;
  }

  return configPromise;
}

// Synchronous access to configuration (uses static config as fallback)
export const gasketConfig = staticGasketConfig;

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

// Helper function to check if auth is disabled in dev (async version)
export async function isAuthDisabled(): Promise<boolean> {
  const gasketConfig = await getGasketConfig();
  const disabled = gasketConfig.auth.disableInDev;
  if (disabled && typeof globalThis !== 'undefined' && !globalThis.__authDisabledLogged) {
    console.log('🔧 Authentication disabled in development (NEXT_PUBLIC_AUTH_IN_DEV=true)');
    console.log('   - All protected routes are accessible');
    console.log('   - JWT validation returns mock success');
    console.log('   - No SSO calls will be made');
    globalThis.__authDisabledLogged = true;
  }
  return disabled;
}

// Helper function to use appropriate fetch method
export async function appFetch(url: string, options?: RequestInit): Promise<Response> {
  // Use regular fetch when auth is disabled in development
  if (await isAuthDisabled()) {
    return fetch(url, options);
  }

  // Use authenticated fetch for production
  const { authFetch } = await import('@godaddy/gasket-auth');
  return authFetch(url, options);
}
