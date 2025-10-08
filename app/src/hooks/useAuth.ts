import { useAuthState, AuthRealmType, AuthRiskType, AuthIdpType, authFetch } from '@godaddy/gasket-auth';
import { useState, useEffect } from 'react';
import { auth } from '@/lib/features';
import { useMockAuth } from '@/hooks/useMockAuth';
import { logger } from '@/lib/request-context';

interface AppConfig {
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

/**
 * Auth hook supporting multiple authentication modes
 *
 * Supports JWT (production), MOCK (development), and NONE (local dev) authentication.
 * Uses Gasket Auth for JWT mode and custom mock auth for development.
 */
export function useAuth(onShowMockLogin?: () => void) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  // Check authentication mode (prefer server config if available)
  const authType = config?.auth?.authType || auth.getType();
  const isMockAuth = config?.auth?.isMock ?? auth.isMock();
  const isAuthDisabled = config?.auth?.isDisabled ?? auth.isDisabled();

  // Mock auth integration
  const mockAuth = useMockAuth();

  // Load configuration from API
  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await fetch('/api/config');
        if (response.ok) {
          const appConfig = await response.json();
          setConfig(appConfig);
          setConfigError(null);
        } else {
          throw new Error(`Config API returned ${response.status}: ${response.statusText}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('auth.config.load.error', {
          message: 'Failed to load configuration - application cannot start',
          error: error as Error
        });
        setConfigError(`Configuration loading failed: ${errorMessage}`);
      } finally {
        setConfigLoading(false);
      }
    }
    loadConfig();
  }, []);

  // Determine if we should use JWT auth based on config
  const shouldUseJWT = config?.auth?.isJWT ?? auth.isJWT();

  // Always call useAuthState to maintain hook order, but only use result for JWT mode
  const authState = useAuthState({
    realm: (config?.auth?.realm || 'idp') as AuthRealmType,
    risk: (config?.auth?.risk || 'low') as AuthRiskType,
    type: (config?.auth?.type || ['basic']) as AuthIdpType[],
    allowHeartbeat: true,
    use12HourExpiration: true,
  });

  // Helper function to get user email from auth details
  const getUserEmail = () => {
    if (isMockAuth && mockAuth.isAuthenticated) {
      return mockAuth.user?.email || 'mock@example.com';
    }
    if (auth.isJWT()) {
      return authState.details?.email || authState.details?.cid || 'user@example.com';
    }
    return 'dev@example.com'; // No auth mode
  };

  // Get user account information
  const getUserInfo = () => {
    if (isMockAuth && mockAuth.isAuthenticated) {
      return {
        customerId: mockAuth.user?.id || 'mock-customer',
        shopperId: mockAuth.user?.id || 'mock-shopper',
        accountName: mockAuth.user?.name || 'Mock User',
        email: mockAuth.user?.email || 'mock@example.com',
      };
    }
    if (auth.isJWT()) {
      return {
        customerId: authState.details?.cid,
        shopperId: authState.details?.shopperId,
        accountName: authState.details?.accountName,
        email: getUserEmail(),
      };
    }
    // No auth mode
    return {
      customerId: 'dev-customer',
      shopperId: 'dev-shopper',
      accountName: 'Dev User',
      email: 'dev@example.com',
    };
  };

  // Handle sign out - different behavior per auth mode
  const handleSignOut = () => {
    if (configError) {
      logger.error('auth.signout.config_error', 'Cannot sign out: configuration not loaded');
      return;
    }

    if (isMockAuth) {
      mockAuth.logout();
      return;
    }

    if (isAuthDisabled) {
      // No auth mode - nothing to do
      return;
    }

    if (!config) {
      logger.error('auth.signout.no_config', 'Cannot sign out: configuration not available');
      return;
    }

    const params = new URLSearchParams({
      app: 'airo-builder',
      redirect: config.redirects.logoutRedirectUrl
    });
    window.location.href = `${config.sso.logoutUrl}?${params.toString()}`;
  };

  // Handle sign in - different behavior per auth mode
  const handleSignIn = (redirectUrl?: string) => {
    if (configError) {
      logger.error('auth.signin.config_error', 'Cannot sign in: configuration not loaded');
      return { showModal: false };
    }

    if (isMockAuth) {
      if (onShowMockLogin) {
        onShowMockLogin();
      } else {
        mockAuth.login();
      }
      return { showModal: !onShowMockLogin };
    }

    if (isAuthDisabled) {
      // No auth mode - nothing to do
      return { showModal: false };
    }

    if (!config) {
      logger.error('auth.signin.no_config', 'Cannot sign in: configuration not available');
      return { showModal: false };
    }

    const returnUrl = redirectUrl || config.redirects.loginRedirectUrl;
    const params = new URLSearchParams({
      app: 'airo-builder',
      redirect: returnUrl
    });
    window.location.href = `${config.sso.loginUrl}?${params.toString()}`;
    return { showModal: false };
  };

  // Authenticated fetch using Gasket's authFetch
  const authenticatedFetch = authFetch;

  // Determine authentication state based on mode
  const getAuthenticationState = () => {
    // If config failed to load, treat as not authenticated and not loading
    if (configError) {
      return { isAuthenticated: false, isLoading: false };
    }

    if (isAuthDisabled) {
      return { isAuthenticated: true, isLoading: false }; // No auth required
    }
    if (isMockAuth) {
      return {
        isAuthenticated: mockAuth.isAuthenticated,
        isLoading: mockAuth.isLoading
      };
    }
    // JWT mode
    return {
      isAuthenticated: shouldUseJWT ? authState.valid : false,
      isLoading: shouldUseJWT ? (authState.status === 'loading' || configLoading) : configLoading
    };
  };

  const { isAuthenticated, isLoading } = getAuthenticationState();

  return {
    // Core auth state
    isAuthenticated,
    isLoading,
    authState: shouldUseJWT ? authState : null,

    // Configuration
    config,
    gasketConfig: config, // Backward compatibility alias
    configLoading,
    configError,

    // User information
    getUserEmail,
    getUserInfo,

    // Auth actions
    handleSignIn,
    handleSignOut,
    authenticatedFetch,

    // Auth status and mode
    isAuthDisabled,
    authType,
    isMockAuth,

    // Mock auth state (for components that need it)
    mockAuth: isMockAuth ? mockAuth : null,
  };
}
