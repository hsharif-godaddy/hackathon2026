'use client';

import { useState, useEffect } from 'react';
import { AuthRequired, AuthRealmType, AuthRiskType, AuthIdpType } from '@godaddy/gasket-auth';
import { SparklesIcon } from '@heroicons/react/24/outline';
import Box from '@ux/box';
import Button from '@ux/button';
import { text } from '@ux/text';
import { useGasketConfig } from '@/hooks/useGasketConfig';
import { useAuth } from '@/hooks/useAuth';
import { MockLoginDialog } from './MockLogin';

interface ProtectedRouteProps {
  children: React.ReactNode;
  realm?: AuthRealmType;
  groups?: string[];
  risk?: AuthRiskType;
  type?: AuthIdpType[];
  loadingMessage?: string;
  unauthorizedMessage?: string;
}

export default function ProtectedRoute({
  children,
  realm,
  groups = [],
  risk,
  type,
  loadingMessage = 'Checking Authentication',
  unauthorizedMessage = 'You need to be signed in to access this area of Airo App Builder.'
}: ProtectedRouteProps) {

  // State to track if component has hydrated and mock login dialog
  const [isClient, setIsClient] = useState(false);
  const [showMockLogin, setShowMockLogin] = useState(false);

  // Get gasket configuration and auth state
  const { isLoading: configLoading } = useGasketConfig();
  const {
    isAuthenticated,
    isLoading: authLoading,
    isAuthDisabled,
    isMockAuth,
    handleSignIn
  } = useAuth(() => setShowMockLogin(true));

  // Set client flag after hydration
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Configure auth parameters based on access level
  const authParams = {
    realm: realm || 'idp' as AuthRealmType,
    risk: risk || 'low' as AuthRiskType,
    type: type || ['basic'] as AuthIdpType[],
    groups,
    allowHeartbeat: true,
    use12HourExpiration: true
  };

  const LoadingComponent = () => (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <SparklesIcon className="w-8 h-8 text-white animate-pulse" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">{loadingMessage}</h2>
        <p className="text-gray-600">Please wait while we verify your access...</p>
      </div>
    </div>
  );

  const UnauthorizedComponent = () => {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
        <Box className="bg-white rounded-lg shadow-lg p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <SparklesIcon className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Authentication Required</h2>
          <p className={`${text.body} text-gray-600 mb-6`}>
            {unauthorizedMessage}
          </p>
          <Button
            onClick={() => {
              const signInResult = handleSignIn();
              if (signInResult?.showModal) {
                setShowMockLogin(true);
              }
            }}
            design='primary'
            text='Sign In to Continue'
            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white"
          />
        </Box>
      </div>
    );
  };

  // Show loading state while config is loading or during hydration
  if (configLoading || !isClient || authLoading) {
    return <LoadingComponent />;
  }

  // Handle different authentication modes
  if (isAuthDisabled) {
    // No auth required - render children directly
    return <>{children}</>;
  }

  if (isMockAuth) {
    // Mock auth mode - check mock auth state
    if (!isAuthenticated) {
      return (
        <>
          <UnauthorizedComponent />
          {showMockLogin && (
            <MockLoginDialog
              isOpen={showMockLogin}
              onClose={() => setShowMockLogin(false)}
            />
          )}
        </>
      );
    }
    // Mock user is authenticated
    return <>{children}</>;
  }

  // JWT mode - use Gasket AuthRequired
  return (
    <AuthRequired
      {...authParams}
      loading={<LoadingComponent />}
      alt={<UnauthorizedComponent />}
    >
      <>{children}</>
    </AuthRequired>
  );
}
