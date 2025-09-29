import { logger } from './request-context';
import { auth } from './features';
// Gasket configuration for Airo App Builder authentication

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
    logger.info('🔧 Loading server-side gasket config from environment');
    
    const config = {
      auth: {
        realm: 'idp',
        risk: 'low',
        type: ['basic'],
        authType: auth.getType(),
        isDisabled: auth.isDisabled(),
        isMock: auth.isMock(),
        isJWT: auth.isJWT()
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
    
    logger.info('🔧 Server-side config loaded:', {
      loginUrl: config.sso.loginUrl,
      logoutUrl: config.sso.logoutUrl
    });
    
    return config;
  }

  // Client-side: fetch from API (lazy)
  logger.info('🔧 Loading client-side gasket config from /api/config');
  
  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      throw new Error(`Config API error: ${response.status} ${response.statusText}`);
    }
    
    const config = await response.json();
    logger.info('🔧 Client-side config loaded from API:', {
      loginUrl: config.sso?.loginUrl,
      logoutUrl: config.sso?.logoutUrl
    });
    
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
    logger.info('🔧 Using cached gasket config');
    return globalThis.__gasketConfigCache;
  }

  // Return existing promise if already loading
  if (typeof globalThis !== 'undefined' && globalThis.__gasketConfigPromise) {
    logger.info('🔧 Waiting for existing gasket config load');
    return globalThis.__gasketConfigPromise;
  }

  logger.info('🔧 Loading fresh gasket config');

  // Load and cache configuration
  const configPromise = loadRuntimeConfig().then(config => {
    logger.info('🔧 Gasket config loaded successfully:', {
      loginUrl: config.sso.loginUrl,
      logoutUrl: config.sso.logoutUrl
    });
    
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
    logger.info(`🔧 Authentication disabled (AUTH_TYPE=${auth.getType()})`);
    logger.info('   - All protected routes are accessible');
    logger.info('   - JWT validation returns mock success');
    logger.info('   - No SSO calls will be made');
    globalThis.__authDisabledLogged = true;
  }
  return disabled;
}

// Helper function for authenticated API calls
// Note: This is deprecated - use authFetch from @godaddy/gasket-auth directly
export async function appFetch(url: string, options?: RequestInit): Promise<Response> {
  const { authFetch } = await import('@godaddy/gasket-auth');
  return authFetch(url, options);
}
