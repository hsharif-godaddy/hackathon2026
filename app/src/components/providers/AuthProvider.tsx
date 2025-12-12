'use client';

import { ReactNode, useState, useEffect, createContext, useContext } from 'react';
import { logger } from '@/lib/request-context';
import { auth } from '@/lib/features';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useAuth } from '@/hooks/useAuth'
import AccessDisabledComponent from '@/components/auth/AccessDisabledComponent'
import LoadingComponent from '@/components/auth/LoadingComponent';

// Create auth context
const AuthContext = createContext<ReturnType<typeof useAuth> | null>(null);

// Simple component that just renders children
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AuthProviderComponent(props: any) {
  const { children } = props;
  return <>{children}</>;
}

// Export the wrapped provider with proper typing
export default function AuthProvider({ children }: { children: ReactNode }) {
  const [authProvider, setAuthProvider] = useState<any>(null);
  const [isAuthProviderLoading, setIsAuthProviderLoading] = useState(true);
  const [serverAuthConfig, setServerAuthConfig] = useState<any>(null);

  const authData = useAuth()
  const {isAuthenticated, isAuthDisabled, isLoading} = authData

  const { data: isAppbuilderAccessEnabled, isLoading: isSwitchboardFeatureFlagsLoading } = useSwitchboard('appbuilder-access');

  // Load server-side auth configuration
  useEffect(() => {
    async function loadServerAuthConfig() {
      try {
        const response = await fetch('/api/config');
        if (response.ok) {
          const config = await response.json();
          setServerAuthConfig(config.auth);
        }
      } catch (error) {
        logger.error('auth.provider.config-error', {
          message: 'Failed to load server auth config',
          error: error as Error
        });
      }
    }
    loadServerAuthConfig();
  }, []);

  // Use server config if available, fallback to client-side detection
  const isJWTMode = serverAuthConfig?.isJWT || auth.isJWT();

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

  // Show loading while feature flags, auth provider, or auth validation are loading
  if (isSwitchboardFeatureFlagsLoading || isAuthProviderLoading || isLoading) {
    return <LoadingComponent />
  }

  // User is authenticated but does not have access to App Builder
  if (!isAuthDisabled && isAuthenticated && !isAppbuilderAccessEnabled) {
    return (
      <AuthContext.Provider value={authData}>
        <AccessDisabledComponent />
      </AuthContext.Provider>
    )
  }

  // Render with the appropriate provider
  const Provider = authProvider;
  return (
    <AuthContext.Provider value={authData}>
      <Provider>{children}</Provider>
    </AuthContext.Provider>
  );
}

// Export hook to use auth context
export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    // During logout/unmounting, create a minimal auth hook to avoid errors
    // Import auth directly to get the actual auth configuration
    const { auth } = require('@/lib/features'); /* eslint-disable-line @typescript-eslint/no-var-requires */
    const actualIsMock = auth.isMock();
    const actualIsDisabled = auth.isDisabled();
    const actualAuthType = auth.getType();

    return {
      isAuthenticated: false,
      isLoading: false,
      authState: null,
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
      authenticatedFetch: fetch,
      isAuthDisabled: actualIsDisabled,
      authType: actualAuthType,
      isMockAuth: actualIsMock,
      mockAuth: null,
    };
  }
  return context;
}
