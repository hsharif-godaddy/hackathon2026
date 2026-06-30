'use client';

import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';

import LoadingComponent from '@/components/auth/LoadingComponent';
import { useAuth } from '@/hooks/useAuth';
import { awaitHeartbeatRecovery, shouldAttemptHeartbeatPatience } from '@/lib/auth/heartbeat-patience';
import { getGasketConfig, isAuthJWTSync } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

// Create auth context
const AuthContext = createContext<ReturnType<typeof useAuth> | null>(null);

// Simple component that just renders children

function AuthProviderComponent(props: any) {
  const { children } = props;
  return <>{children}</>;
}

function InnerAuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const authData = useAuth();
  const { isLoading, isAuthenticated } = authData;
  const hasInitiallyLoaded = useRef(false);
  const hasAttemptedPatience = useRef(false);
  const [isPatienceActive, setIsPatienceActive] = useState(false);

  if (!isLoading) {
    hasInitiallyLoaded.current = true;
  }

  // Synchronous render-time gate: prevents a single-frame flash of logged-out
  // UI between auth resolving (isLoading→false) and the effect setting
  // isPatienceActive. useEffect runs after paint, so without this the children
  // would render for one frame before patience activates.
  const shouldActivatePatience: boolean =
    !isLoading && !isAuthenticated && !hasAttemptedPatience.current && shouldAttemptHeartbeatPatience();

  // On cold browser launch, Gasket's validate can race heartbeat.js — it fires
  // with the stale JWT before heartbeat refreshes the cookie. For returning
  // users only (airo_returning_user cookie), hold loading while we probe for
  // valid auth. Anonymous visitors skip this entirely.
  useEffect(() => {
    if (isLoading || isAuthenticated || hasAttemptedPatience.current) return;
    if (!shouldAttemptHeartbeatPatience()) return;

    hasAttemptedPatience.current = true;
    setIsPatienceActive(true);

    const controller: AbortController = new AbortController();

    awaitHeartbeatRecovery(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.recovered) {
          setIsPatienceActive(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setIsPatienceActive(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [isLoading, isAuthenticated]);

  // Gate rendering on: initial auth loading, active patience, or the synchronous
  // pre-effect frame where patience is about to activate.
  if ((isLoading && !hasInitiallyLoaded.current) || isPatienceActive || shouldActivatePatience) {
    return <LoadingComponent />;
  }

  return (
    <AuthContext.Provider value={authData}>
      {children}
    </AuthContext.Provider>
  );
}

// Export the wrapped provider with proper typing
export default function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [authProvider, setAuthProvider] = useState<any>(null);
  const [isAuthProviderLoading, setIsAuthProviderLoading] = useState(true);
  const [serverAuthConfig, setServerAuthConfig] = useState<any>(null);

  // Load server-side auth configuration via centralized getGasketConfig()
  useEffect(() => {
    async function loadServerAuthConfig() {
      try {
        const config = await getGasketConfig();
        setServerAuthConfig(config.auth);
      } catch (error) {
        logger.error('auth.provider.config-error', {
          message: 'Failed to load server auth config',
          error: error as Error
        });
        // Set to undefined (not null) so the provider-loading effect can proceed
        // using the isAuthJWTSync() fallback instead of waiting indefinitely
        setServerAuthConfig(undefined);
      }
    }
    loadServerAuthConfig();
  }, []);

  // Use server config if available, fallback to client-side detection
  const isJWTMode = serverAuthConfig?.isJWT || isAuthJWTSync();

  // Load auth provider conditionally (wait for server config)
  useEffect(() => {
    // Don't load auth provider until we have server config or confirmed it failed
    if (serverAuthConfig === null) return;

    async function loadAuthProvider() {
      try {
        if (isJWTMode) {
          // Only import and initialize Gasket auth for JWT mode
          const { withAuthProvider } = await import('@godaddy/gasket-auth');
          const WrappedProvider = withAuthProvider()(AuthProviderComponent);
          setAuthProvider(() => WrappedProvider);
        } else {
          // For non-JWT modes, just use the plain component
          setAuthProvider(() => AuthProviderComponent);
        }
      } catch (error) {
        logger.error('auth.provider.error', {
          message: 'Failed to load auth provider',
          error: error as Error
        });
        // Fallback to plain component
        setAuthProvider(() => AuthProviderComponent);
      } finally {
        setIsAuthProviderLoading(false);
      }
    }

    loadAuthProvider();
  }, [serverAuthConfig, isJWTMode]);

  // Show loading while auth provider is loading
  if (isAuthProviderLoading) {
    return <LoadingComponent />;
  }

  // Render with the appropriate provider
  const Provider = authProvider;
  return (
    <Provider>
      <InnerAuthProvider>
        {children}
      </InnerAuthProvider>
    </Provider>
  );
}

// Export hook to use auth context
export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    // During logout/unmounting, create a minimal auth hook to avoid errors
    // Use sync gasket-config helpers to get auth state without async
    const { isAuthMockSync, getAuthTypeSync } = require('@/lib/gasket-config'); // eslint-disable-line
    const actualIsMock = isAuthMockSync();
    const actualAuthType = getAuthTypeSync();

    return {
      isAuthenticated: false,
      isLoading: false,
      authState: null,
      tokenAuthType: undefined,
      config: null,
      gasketConfig: null,
      configLoading: false,
      configError: null,
      getUserEmail: () => 'unknown@example.com',
      getUserInfo: () => ({
        customerId: 'unknown',
        shopperId: 'unknown',
        accountName: 'Unknown',
        email: 'unknown@example.com',
      }),
      handleSignIn: () => {},
      handleSignOut: () => {},
      authType: actualAuthType,
      isMockAuth: actualIsMock,
      mockAuth: null,
    };
  }
  return context;
}
