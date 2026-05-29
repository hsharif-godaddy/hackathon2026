'use client';

import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';

import LoadingComponent from '@/components/auth/LoadingComponent';
import { useAuth } from '@/hooks/useAuth'
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
  const { isLoading } = authData;
  const hasInitiallyLoaded = useRef(false);

  if (!isLoading) {
    hasInitiallyLoaded.current = true;
  }

  // Only gate rendering on the initial auth check.
  // After initial auth completes, keep children mounted during heartbeat revalidations
  // to prevent tearing down websocket connections, form state, etc.
  if (isLoading && !hasInitiallyLoaded.current) {
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
