import { useCallback,useEffect, useMemo, useRef, useState } from 'react';
import { authFetch,AuthIdpType, AuthRealmType, AuthRiskType, useAuthState } from '@godaddy/gasket-auth';

import { useMockAuth } from '@/hooks/useMockAuth';
import { auth, authUtils } from '@/lib/features';
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

interface UseAuthOptions {
  onShowMockLogin?: () => void;
  /**
   * Allow unauthenticated access - for pages that work for both authed and unauthed users (e.g., homepage)
   * This option is passed through but primarily used by AuthProvider to decide whether to use
   * Gasket's withAuthProvider (which sets up 401 redirect interceptors)
   */
  allowUnauthenticated?: boolean;
}

/**
 * Auth hook supporting multiple authentication modes
 *
 * Supports JWT (production), MOCK (development), and NONE (local dev) authentication.
 * Uses Gasket Auth for JWT mode and custom mock auth for development.
 *
 * @param options.allowUnauthenticated - When true, allows page to work for unauthed users (no redirect on 401)
 */
export function useAuth(options: UseAuthOptions = {}) {
  // allowUnauthenticated is destructured but not used here - it's used by AuthProvider
  // to decide whether to use withAuthProvider (which sets up 401 redirect interceptors)
  //
  // @deprecated The old `useAuth(callback)` signature is deprecated.
  // Use `useAuth({ onShowMockLogin: callback })` instead. This backward
  // compatibility will be removed in a future release.
  const { onShowMockLogin } = typeof options === 'function'
    ? { onShowMockLogin: options }
    : options;

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [jwtAuthValid, setJwtAuthValid] = useState<boolean | null>(null);
  const [authRefreshTrigger, setAuthRefreshTrigger] = useState(0);
  const isValidatingRef = useRef(false);

  // Memoize auth configuration to prevent unnecessary re-renders
  const authType = useMemo(() => config?.auth?.authType || auth.getType(), [config?.auth?.authType]);
  const isMockAuth = useMemo(() => config?.auth?.isMock ?? auth.isMock(), [config?.auth?.isMock]);
  const isAuthDisabled = useMemo(() => config?.auth?.isDisabled ?? auth.isDisabled(), [config?.auth?.isDisabled]);
  const shouldUseJWT = useMemo(() => config?.auth?.isJWT ?? auth.isJWT(), [config?.auth?.isJWT]);

  // Mock auth integration
  const mockAuth = useMockAuth();

  // Always call useAuthState to maintain hook order, but only use result for JWT mode
  // Heartbeat is always enabled - on pages that allow unauthenticated access, we don't use
  // withAuthProvider so 401s from heartbeat won't trigger redirects
  const supportedAuthTypes = useMemo(() => config?.auth?.type || authUtils.getSupportedAuthTypes(), [config?.auth?.type]);

  const authState = useAuthState({
    realm: (config?.auth?.realm || 'idp') as AuthRealmType,
    risk: (config?.auth?.risk || 'low') as AuthRiskType,
    type: supportedAuthTypes as AuthIdpType[],
    allowHeartbeat: true,
    use12HourExpiration: true,
  });

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

  // Check JWT authentication and authorization
  // Uses our own /api/auth/validate endpoint which doesn't trigger SSO redirects on 401
  useEffect(() => {
    async function checkJwtAuth() {
      if (!shouldUseJWT || isMockAuth || isAuthDisabled) {
        setJwtAuthValid(null);
        isValidatingRef.current = false;
        return;
      }

      // Prevent duplicate validation requests using ref to avoid dependency cycles
      if (isValidatingRef.current) {
        return;
      }

      isValidatingRef.current = true;

      try {
        const response = await fetch('/api/auth/validate');
        if (response.ok) {
          const data = await response.json();
          setJwtAuthValid(data.valid);
        } else {
          // Auth validation failed - user is not authenticated
          // On pages that allow unauthenticated access, this is fine - just show unauthed UI
          // On other pages, the ProtectedRoute component will handle the redirect
          setJwtAuthValid(false);
        }
      } catch (error) {
        logger.error('auth.jwt.check.error', {
          message: 'Failed to check JWT authentication',
          error: error as Error
        });
        setJwtAuthValid(false);
      } finally {
        isValidatingRef.current = false;
      }
    }

    checkJwtAuth();
  }, [shouldUseJWT, isMockAuth, isAuthDisabled, configLoading, authRefreshTrigger]);

  // Function to refresh auth state (call after SSO login)
  const refreshAuth = useCallback(() => {
    isValidatingRef.current = false;
    setJwtAuthValid(null);
    setAuthRefreshTrigger(prev => prev + 1);
  }, []);

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
    // JWT mode - use our API validation result if available, fallback to Gasket Auth
    if (shouldUseJWT) {
      const isLoading = authState.status === 'loading' || configLoading || jwtAuthValid === null;
      const isAuthenticated = jwtAuthValid !== null ? jwtAuthValid : authState.valid;
      return { isAuthenticated, isLoading };
    }

    return {
      isAuthenticated: false,
      isLoading: configLoading
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
    refreshAuth,

    // Auth status and mode
    isAuthDisabled,
    authType,
    isMockAuth,

    // Mock auth state (for components that need it)
    mockAuth: isMockAuth ? mockAuth : null,
  };
}
