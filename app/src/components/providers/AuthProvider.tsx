'use client';

import { withAuthProvider } from '@godaddy/gasket-auth';
import { ReactNode } from 'react';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import Box from '@ux/box';
import Spinner from '@ux/spinner';

// Simple component that just renders children
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AuthProviderComponent(props: any) {
  const { children } = props;
  return <>{children}</>;
}

// Wrap the component with withAuthProvider HOC to provide auth context
const WrappedAuthProvider = withAuthProvider()(AuthProviderComponent);

// Export the wrapped provider with proper typing
export default function AuthProvider({ children }: { children: ReactNode }) {
  const { featureFlags, isLoading: isFeatureFlagsLoading } = useSwitchboard();
  const isAppbuilderAccessEnabled = featureFlags['appbuilder-access'] ?? false;

  // Show loading while feature flags are loading
  if (isFeatureFlagsLoading) {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Provider = WrappedAuthProvider as any;
  return <Provider>{children}</Provider>;
}
