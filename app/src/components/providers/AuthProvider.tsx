'use client';

import { usePathname } from 'next/navigation';
import { createContext, ReactNode, useContext,useEffect, useState } from 'react';

import AccessDisabledComponent from '@/components/auth/AccessDisabledComponent'
import LoadingComponent from '@/components/auth/LoadingComponent';
import { useAuth } from '@/hooks/useAuth'
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { auth } from '@/lib/features';
import { logger } from '@/lib/request-context';

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

  const pathname = usePathname();

  // Homepage should be accessible to everyone - both authenticated and unauthenticated users
  const isHomepage = pathname === '/' || pathname === '';

  // On homepage: allow unauthenticated access (disables heartbeat that could cause 401 redirects)
  // Auth validation still runs, but users can view the page regardless of auth state
  const authData = useAuth({ allowUnauthenticated: isHomepage });
  const {isAuthenticated, isAuthDisabled, isLoading} = authData;

  // Only check switchboard access when user is authenticated AND not on homepage
  const shouldCheckAccess = !isHomepage && !isLoading && !isAuthDisabled && isAuthenticated;
  const { data: isAppbuilderAccessEnabled, isLoading: isSwitchboardFeatureFlagsLoading } = useSwitchboard('appbuilder-access', { enabled: shouldCheckAccess });

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
  // On homepage, skip Gasket's withAuthProvider to avoid 401 redirect interceptors
  useEffect(() => {
    // Don't load auth provider until we have server config or confirmed it failed
    if (serverAuthConfig === null) return;

    async function loadAuthProvider() {
      try {
        // On homepage: use plain provider even in JWT mode to avoid 401 redirect behavior
        // The homepage should work for both authenticated and unauthenticated users
        if (isJWTMode && !isHomepage) {
          // Only import and initialize Gasket auth for JWT mode on non-homepage routes
          const { withAuthProvider } = await import('@godaddy/gasket-auth');
          const WrappedProvider = withAuthProvider()(AuthProviderComponent);
          setAuthProvider(() => WrappedProvider);
        } else {
          // For non-JWT modes OR homepage, just use the plain component
          // Homepage uses our own auth validation via /api/auth/validate (no redirects)
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
  }, [serverAuthConfig, isJWTMode, isHomepage]);

  // Show loading while auth provider or auth validation are loading
  // Skip switchboard loading check on homepage (homepage is accessible to everyone)
  const shouldWaitForSwitchboard = !isHomepage && isSwitchboardFeatureFlagsLoading;
  if (shouldWaitForSwitchboard || isAuthProviderLoading || isLoading) {
    return <LoadingComponent />
  }

  // User is authenticated but does not have access to App Builder (skip check on homepage)
  if (!isHomepage && !isAuthDisabled && isAuthenticated && !isAppbuilderAccessEnabled) {
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
      refreshAuth: () => {},
      isAuthDisabled: actualIsDisabled,
      authType: actualAuthType,
      isMockAuth: actualIsMock,
      mockAuth: null,
    };
  }
  return context;
}
