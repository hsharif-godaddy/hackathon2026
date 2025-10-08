'use client';

import { ReactNode, useState, useEffect } from 'react';
import Box from '@ux/box';
import Spinner from '@ux/spinner';
import { logger } from '@/lib/request-context';
import { auth } from '@/lib/features';

// Simple component that just renders children
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AuthProviderComponent(props: any) {
  const { children } = props;
  return <>{children}</>;
}


// Export the wrapped provider with proper typing
export default function AuthProvider({ children }: { children: ReactNode }) {
  const [authProvider, setAuthProvider] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [featureFlags, setFeatureFlags] = useState<any>({});
  const [isFeatureFlagsLoading, setIsFeatureFlagsLoading] = useState(true);

  // State for server-side auth config
  const [serverAuthConfig, setServerAuthConfig] = useState<any>(null);

  // Load server-side auth configuration
  useEffect(() => {
    async function loadServerAuthConfig() {
      try {
        const response = await fetch('/api/config');
        if (response.ok) {
          const config = await response.json();
          setServerAuthConfig(config.auth);
          logger.info('auth.provider.server-config', {
            message: 'Loaded server auth config',
            authConfig: config.auth
          });
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
  const authType = serverAuthConfig?.authType || auth.getType();
  const isJWTMode = serverAuthConfig?.isJWT || auth.isJWT();
  const shouldUseSwitchboard = isJWTMode;

  // Conditionally load Switchboard data
  useEffect(() => {
    if (shouldUseSwitchboard) {
      try {
        // Try to access window.gasketData if it exists (set by Gasket)
        if (typeof window !== 'undefined' && window.gasketData) {
          const data = window.gasketData;
          setFeatureFlags(data?.switchboard || { 'appbuilder-access': false });
        } else {
          setFeatureFlags({ 'appbuilder-access': false });
        }
      } catch (error) {
        logger.warn('auth.provider.switchboard.error', {
          message: 'Failed to load Switchboard data',
          error: error as Error
        });
        setFeatureFlags({ 'appbuilder-access': false });
      }
      setIsFeatureFlagsLoading(false);
    } else {
      // For non-JWT modes, bypass Switchboard entirely and assume access is enabled
      logger.info('auth.provider.switchboard.bypass', 'Bypassing Switchboard for non-JWT mode');
      setFeatureFlags({ 'appbuilder-access': true });
      setIsFeatureFlagsLoading(false);
    }
  }, [shouldUseSwitchboard]);

  const isAppbuilderAccessEnabled = featureFlags['appbuilder-access'] ?? false;

  // Load auth provider conditionally (wait for server config)
  useEffect(() => {
    // Don't load auth provider until we have server config or confirmed it failed
    if (serverAuthConfig === null) return;

    async function loadAuthProvider() {
      try {
        const currentAuthType = auth.getType();
        logger.info('auth.provider.loading', {
          message: 'Loading auth provider',
          authType: currentAuthType
        });

        if (isJWTMode) {
          // Only import and initialize Gasket auth for JWT mode
          const { withAuthProvider } = await import('@godaddy/gasket-auth');
          const WrappedProvider = withAuthProvider()(AuthProviderComponent);
          setAuthProvider(() => WrappedProvider);
          logger.info('auth.provider.gasket.loaded', 'Gasket auth provider loaded successfully');
        } else {
          // For non-JWT modes, just use the plain component
          setAuthProvider(() => AuthProviderComponent);
          logger.info('auth.provider.plain.loaded', 'Plain auth provider loaded (no Gasket auth)');
        }
      } catch (error) {
        logger.error('auth.provider.error', {
          message: 'Failed to load auth provider',
          error: error as Error
        });
        // Fallback to plain component
        setAuthProvider(() => AuthProviderComponent);
      } finally {
        setIsAuthLoading(false);
      }
    }

    loadAuthProvider();
  }, [serverAuthConfig, isJWTMode]);

  // Show loading while feature flags or auth provider are loading
  if (isFeatureFlagsLoading || isAuthLoading) {
    return (
      <Box
        className="min-h-screen"
        inlineAlignChildren='center'
        blockAlignChildren='center'
      >
        <Spinner />
      </Box>
    );
  }

  // Show access restricted message if feature flag is disabled
  if (!isAppbuilderAccessEnabled) {
    return (
      <Box
        className="min-h-screen"
        inlineAlignChildren='center'
        blockAlignChildren='center'
      >
        <div className="text-center space-y-4 max-w-md mx-auto px-4">
          <div className="text-2xl font-semibold">
            Access Restricted
          </div>
          <p className="opacity-50">
            App Builder access is currently not available for your account. Please contact your administrator for assistance.
          </p>
        </div>
      </Box>
    );
  }

  // Render with the appropriate provider
  const Provider = authProvider;
  return <Provider>{children}</Provider>;
}
