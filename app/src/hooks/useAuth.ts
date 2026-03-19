import { useEffect, useMemo, useRef, useState } from 'react';
import { AuthIdpType, AuthRealmType, AuthRiskType, useAuthState } from '@godaddy/gasket-auth';

import { useMockAuth } from '@/hooks/useMockAuth';
import {
  authConfigs,
  type GasketConfig,
  getAuthTypeSync,
  getGasketConfig,
  getLoginUrl,
  getLogoutUrl,
  isAuthDisabledSync,
  isAuthJWTSync,
  isAuthMockSync,
} from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { useAuthUIStore } from '@/stores/useAuthUIStore';

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

  const [config, setConfig] = useState<GasketConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const needsReauth = useAuthUIStore((state) => state.needsReauth);
  const needsReauthSeq = useAuthUIStore((state) => state.needsReauthSeq);
  const previousAuthValidRef = useRef<boolean | undefined>(undefined);
  // Track if we've seen a validation cycle (loading state) after needsReauth was set
  // This prevents clearing needsReauth based on stale cached authState.valid
  const sawValidationAfterReauthSeqRef = useRef<number | null>(null);
  const previousNeedsReauthRef = useRef(false);

  // Memoize auth configuration to prevent unnecessary re-renders
  const authType = useMemo(() => config?.auth?.authType || getAuthTypeSync(), [config?.auth?.authType]);
  const isMockAuth = useMemo(() => config?.auth?.isMock ?? isAuthMockSync(), [config?.auth?.isMock]);
  const isAuthDisabled = useMemo(() => config?.auth?.isDisabled ?? isAuthDisabledSync(), [config?.auth?.isDisabled]);
  const shouldUseJWT = useMemo(() => config?.auth?.isJWT ?? isAuthJWTSync(), [config?.auth?.isJWT]);

  // Mock auth integration
  const mockAuth = useMockAuth();

  // Always call useAuthState to maintain hook order, but only use result for JWT mode
  // Heartbeat is always enabled - on pages that allow unauthenticated access, we don't use
  // withAuthProvider so 401s from heartbeat won't trigger redirects
  const supportedAuthTypes = useMemo(() => config?.auth?.type || authConfigs.user.type, [config?.auth?.type]);

  const authState = useAuthState({
    realm: (config?.auth?.realm || authConfigs.user.realm) as AuthRealmType,
    risk: (config?.auth?.risk || authConfigs.user.risk) as AuthRiskType,
    type: supportedAuthTypes as AuthIdpType[],
    allowHeartbeat: authConfigs.user.allowHeartbeat,
    use12HourExpiration: authConfigs.user.use12HourExpiration,
  });

  // Load configuration via centralized getGasketConfig()
  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
        const appConfig = await getGasketConfig();
        if (!cancelled) {
          setConfig(appConfig);
          setConfigError(null);
        }
      } catch (error) {
        if (cancelled) {return;}

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

  // Clear needsReauth when auth transitions to valid after a fresh validation cycle (JWT mode only)
  // Only clears after seeing a validation cycle (loading state), not on cached authState.valid
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
    }

    // Propagate authReason from Gasket Auth's authState to the UI store.
    // Gasket Auth's fetchAuthState spreads the full /api/auth/validate response via { ...data },
    // so authReason is available on authState when the validate endpoint returns it.
    // This handles the case where the validate endpoint (not an API call) detects the HBI requirement.
    if (!authState.valid && (authState as any).authReason != null) {
      const store = useAuthUIStore.getState();
      const newAuthReason = (authState as any).authReason;
      if (store.authReason !== newAuthReason) {
        useAuthUIStore.getState().setNeedsReauth(
          store.reauthReason || 'session_expired',
          store.requiresRefresh,
          newAuthReason
        );
      }
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
    }

    previousAuthValidRef.current = authState.valid;
    previousNeedsReauthRef.current = needsReauth;
  }, [authState.valid, authState.status, shouldUseJWT, isMockAuth, isAuthDisabled, needsReauth, needsReauthSeq]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally using specific authState properties to avoid re-running on every auth object change

  // Helper function to get user email from auth details
  const getUserEmail = () => {
    if (isMockAuth && mockAuth.isAuthenticated) {
      return mockAuth.user?.email || 'mock@example.com';
    }
    if (shouldUseJWT) {
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
    if (shouldUseJWT) {
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
  const handleSignOut = async () => {
    // Clear needsReauth flag on logout
    if (needsReauth) {
      useAuthUIStore.getState().clearNeedsReauth(needsReauthSeq);
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

    try {
      window.location.href = await getLogoutUrl();
    } catch (error) {
      logger.error('auth.signout.url_error', {
        message: 'Failed to get logout URL',
        error: error as Error,
      });
    }
  };

  // Handle sign in - different behavior per auth mode
  const handleSignIn = async (redirectUrl?: string) => {
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

    try {
      // If no redirect URL provided, capture current page to preserve path after SSO
      // This ensures direct SSO redirects (non-modal flow) return to the same page
      const finalRedirectUrl = redirectUrl || (
        typeof window !== 'undefined'
          ? window.location.href  // Full current URL with path
          : undefined
      );

      window.location.href = await getLoginUrl(finalRedirectUrl);
    } catch (error) {
      logger.error('auth.signin.url_error', {
        message: 'Failed to get login URL',
        error: error as Error,
      });
    }
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
