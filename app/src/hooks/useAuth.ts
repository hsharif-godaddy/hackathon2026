import { useEffect, useMemo, useState } from 'react';
import { AuthIdpType, AuthRealmType, AuthRiskType, useAuthState } from '@godaddy/gasket-auth';

import { useMockAuth } from '@/hooks/useMockAuth';
import {
  authConfigs,
  type GasketConfig,
  getAuthTypeSync,
  getGasketConfig,
  getLoginUrl,
  getLogoutUrl,
  isAuthJWTSync,
  isAuthMockSync,
} from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

interface UseAuthOptions {
  onShowMockLogin?: () => void;
}

/**
 * Auth hook supporting JWT (production) and mock (development) modes.
 * Uses Gasket Auth as the single source of truth for JWT validation.
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

  const authType = useMemo(() => config?.auth?.authType || getAuthTypeSync(), [config?.auth?.authType]);
  const isMockAuth = useMemo(() => config?.auth?.isMock ?? isAuthMockSync(), [config?.auth?.isMock]);
  const shouldUseJWT = useMemo(() => config?.auth?.isJWT ?? isAuthJWTSync(), [config?.auth?.isJWT]);

  const mockAuth = useMockAuth();

  const supportedAuthTypes = useMemo(() => config?.auth?.type || authConfigs.user.type, [config?.auth?.type]);

  const authState = useAuthState({
    realm: (config?.auth?.realm || authConfigs.user.realm) as AuthRealmType,
    risk: (config?.auth?.risk || authConfigs.user.risk) as AuthRiskType,
    type: supportedAuthTypes as AuthIdpType[],
    allowHeartbeat: authConfigs.user.allowHeartbeat,
    use12HourExpiration: authConfigs.user.use12HourExpiration,
  });

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

  const getUserEmail = () => {
    if (isMockAuth && mockAuth.isAuthenticated) {
      return mockAuth.user?.email || 'mock@example.com';
    }
    return authState.details?.email || authState.details?.cid || 'user@example.com';
  };

  const getUserInfo = () => {
    if (isMockAuth && mockAuth.isAuthenticated) {
      return {
        customerId: mockAuth.user?.id || 'mock-customer',
        shopperId: mockAuth.user?.id || 'mock-shopper',
        accountName: mockAuth.user?.name || 'Mock User',
        email: mockAuth.user?.email || 'mock@example.com',
      };
    }
    return {
      customerId: authState.details?.cid,
      shopperId: authState.details?.shopperId,
      accountName: authState.details?.accountName,
      email: getUserEmail(),
    };
  };

  const handleSignOut = async () => {
    if (configError) {
      logger.error('auth.signout.config_error', 'Cannot sign out: configuration not loaded');
      return;
    }

    if (isMockAuth) {
      mockAuth.logout();
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

  // Full-page redirect sign-in path used by useSsoSignIn for deployed test/dev
  // envs where Chrome's Private Network Access check blocks the SSO Deck
  // iframe. See docs/sso-login-env-gating.md. Prod/local go through the
  // modal via `openSsoLogin()` and never reach this function.
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

    try {
      const finalRedirectUrl = redirectUrl || (
        typeof window !== 'undefined'
          ? window.location.href
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


  const getAuthenticationState = () => {
    if (configError) {
      return { isAuthenticated: false, isLoading: false };
    }

    if (isMockAuth) {
      return {
        isAuthenticated: mockAuth.isAuthenticated,
        isLoading: mockAuth.isLoading
      };
    }

    if (shouldUseJWT) {
      return {
        isAuthenticated: authState.valid,
        isLoading: authState.status === 'loading' || configLoading,
      };
    }

    return {
      isAuthenticated: false,
      isLoading: configLoading
    };
  };

  const { isAuthenticated, isLoading } = getAuthenticationState();

  // Token auth type from JWT claims (e2s, basic, s2s, etc.) - distinct from authType which is the auth mode (jwt, mock)
  // Note: Gasket's AuthState type doesn't expose authType but gd-auth populates it at runtime
  const tokenAuthType: string | undefined = shouldUseJWT ? (authState as { authType?: string })?.authType : undefined;

  return {
    isAuthenticated,
    isLoading,
    authState: shouldUseJWT ? authState : null,
    tokenAuthType,

    config,
    gasketConfig: config,
    configLoading,
    configError,

    getUserEmail,
    getUserInfo,

    // Auth actions
    handleSignIn,
    handleSignOut,

    authType,
    isMockAuth,

    mockAuth: isMockAuth ? mockAuth : null,
  };
}
