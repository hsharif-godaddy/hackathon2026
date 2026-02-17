import { useEffect, useMemo, useRef, useState } from 'react';
import { AuthIdpType, AuthRealmType, AuthRiskType, useAuthState } from '@godaddy/gasket-auth';

import { useMockAuth } from '@/hooks/useMockAuth';
import { auth, authUtils } from '@/lib/features';
import { logger } from '@/lib/request-context';
import { useAuthUIStore } from '@/stores/useAuthUIStore';

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
}

/**
 * Auth hook supporting multiple authentication modes
 *
 * Supports JWT (production), MOCK (development), and NONE (local dev) authentication.
 * Uses Gasket Auth for JWT mode and custom mock auth for development.
 */
export function useAuth(options: UseAuthOptions = {}) {
  // @deprecated The old `useAuth(callback)` signature is deprecated.
  // Use `useAuth({ onShowMockLogin: callback })` instead. This backward
  // compatibility will be removed in a future release.
  const { onShowMockLogin } = typeof options === 'function'
    ? { onShowMockLogin: options }
    : options;

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const needsReauth = useAuthUIStore((state) => state.needsReauth);
  const needsReauthSeq = useAuthUIStore((state) => state.needsReauthSeq);
  const previousAuthValidRef = useRef<boolean | undefined>(undefined);
  // Track if we've seen a validation cycle (loading state) after needsReauth was set
  // This prevents clearing needsReauth based on stale cached authState.valid
  const sawValidationAfterReauthSeqRef = useRef<number | null>(null);
  const previousNeedsReauthRef = useRef(false);
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    let cancelled = false;

    async function loadConfig() {
      try {
        const response = await fetch('/api/config');

        // Check if component unmounted during fetch
        if (cancelled) return;

        if (response.ok) {
          const appConfig = await response.json();
          // Check again after JSON parsing (async operation) - component could unmount during parsing
          if (!cancelled) {
            setConfig(appConfig);
            setConfigError(null);
          }
        } else {
          throw new Error(`Config API returned ${response.status}: ${response.statusText}`);
        }
      } catch (error) {
        if (cancelled) return;

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('auth.config.load.error', {
          message: 'Failed to load configuration - application cannot start',
          error: error as Error
        });
        setConfigError(`Configuration loading failed: ${errorMessage}`);
      } finally {
        if (!cancelled) {
          setConfigLoading(false);
        }
      }
    }

    loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  // Cleanup validation timeout on unmount
  useEffect(() => {
    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
        validationTimeoutRef.current = null;
      }
    };
  }, []);

  // Clear needsReauth when auth transitions to valid after a fresh validation cycle (JWT mode only)
  // FIXED: Only clears after seeing a validation cycle, not on cached authState.valid
  useEffect(() => {
    if (!shouldUseJWT || isMockAuth || isAuthDisabled) {
      previousAuthValidRef.current = authState.valid;
      previousNeedsReauthRef.current = needsReauth;
      return;
    }

    // Detect transition to needsReauth=true (new 401 occurred)
    // Reset validation tracking to require a NEW validation cycle for this 401
    if (needsReauth && !previousNeedsReauthRef.current) {
      sawValidationAfterReauthSeqRef.current = null;
      logger.debug('auth.needs_reauth_set', {
        message: 'needsReauth became true, waiting for validation cycle',
        needsReauthSeq
      });

      // Set timeout to clear needsReauth if validation cycle doesn't occur within 10 seconds
      // This prevents indefinite waiting if Gasket Auth doesn't trigger a validation
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }
      validationTimeoutRef.current = setTimeout(() => {
        if (needsReauth && sawValidationAfterReauthSeqRef.current === null) {
          logger.warn('auth.validation_timeout', {
            message: 'Validation cycle not detected within timeout, clearing needsReauth',
            needsReauthSeq
          });
          useAuthUIStore.getState().clearNeedsReauth(needsReauthSeq);
        }
      }, 10000);
    }

    // Track when Gasket Auth runs a validation cycle (status becomes loading)
    // Store the seq number so we know which 401 this validation applies to
    if (needsReauth && authState.status === 'loading' && sawValidationAfterReauthSeqRef.current !== needsReauthSeq) {
      sawValidationAfterReauthSeqRef.current = needsReauthSeq;
      logger.debug('auth.validation_cycle_detected', {
        message: 'Detected Gasket Auth validation cycle after needsReauth',
        authStateStatus: authState.status,
        needsReauthSeq
      });

      // Clear timeout since we detected the validation cycle
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
        validationTimeoutRef.current = null;
      }
    }

    // Only clear needsReauth after we've seen a validation cycle complete FOR THIS 401
    // This prevents clearing based on stale cached authState.valid = true
    // AND prevents clearing a newer 401 with an older validation cycle
    // Also ensure we're not in the middle of loading to avoid race conditions
    if (needsReauth && authState.valid && authState.status !== 'loading' &&
        sawValidationAfterReauthSeqRef.current === needsReauthSeq) {
      logger.debug('auth.clear_needs_reauth', {
        message: 'Clearing needsReauth after fresh validation confirmed auth is valid',
        authStateValid: authState.valid,
        authStateStatus: authState.status,
        needsReauthSeq
      });
      useAuthUIStore.getState().clearNeedsReauth(needsReauthSeq);
      // Reset tracking state for the next 401 occurrence
      sawValidationAfterReauthSeqRef.current = null;

      // Clear timeout if it's still pending
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
        validationTimeoutRef.current = null;
      }
    }

    previousAuthValidRef.current = authState.valid;
    previousNeedsReauthRef.current = needsReauth;
  }, [authState.valid, authState.status, shouldUseJWT, isMockAuth, isAuthDisabled, needsReauth, needsReauthSeq]);

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
    // Clear needsReauth flag on logout
    if (needsReauth) {
      useAuthUIStore.getState().clearNeedsReauth(needsReauthSeq);
    }

    // Clear validation timeout if pending
    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current);
      validationTimeoutRef.current = null;
    }

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

  // Determine authentication state based on mode
  /**
   * Determines authentication state based on auth mode and validates session status.
   *
   * Critical gating behavior: Returns isAuthenticated=true ONLY when BOTH conditions are met:
   * 1. authState.valid is true (Gasket Auth's periodic server validation via /api/auth/validate)
   * 2. needsReauth is false (no 401 errors detected by our interceptor)
   *
   * This dual-gating handles expired e2s tokens (12-hour expiration) where Gasket Auth's
   * cached validation (60s TTL) may still return valid=true but the server has already
   * rejected the token (401). The needsReauth flag provides immediate UI feedback while
   * waiting for Gasket Auth's next validation cycle to update authState.valid.
   *
   * @returns {Object} Authentication state with isAuthenticated and isLoading flags
   */
  const getAuthenticationState = () => {
    // If config failed to load, treat as not authenticated and not loading
    if (configError) {
      return { isAuthenticated: false, isLoading: false };
    }

    if (isAuthDisabled) {
      return { isAuthenticated: true, isLoading: false }; // No auth required
    }
    if (isMockAuth) {
      // Mock auth doesn't use the needsReauth flow - it has its own state management
      return {
        isAuthenticated: mockAuth.isAuthenticated,
        isLoading: mockAuth.isLoading
      };
    }
    // JWT mode - use Gasket Auth's server-validated state
    // Gasket Auth periodically calls /api/auth/validate (cached for ~60s) which uses gd-auth
    // to validate JWT tokens server-side (exp, iat, vat, auth type checks).
    // We gate with needsReauth to handle the window where authState.valid is stale but the
    // server has already rejected the token (401). This provides immediate UI feedback.
    if (shouldUseJWT) {
      const isLoading = authState.status === 'loading' || configLoading;
      const isAuthenticated = authState.valid && !needsReauth;
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
    needsReauth,

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

    // Auth status and mode
    isAuthDisabled,
    authType,
    isMockAuth,

    // Mock auth state (for components that need it)
    mockAuth: isMockAuth ? mockAuth : null,
  };
}
