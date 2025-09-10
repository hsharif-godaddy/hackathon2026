'use client';

import { useState } from 'react';
import { AuthRealmType, AuthRequired } from '@godaddy/gasket-auth';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { authConfigs } from '@/lib/gasket-config';
import { useGasketConfig } from '@/hooks/useGasketConfig';
import { isFeatureEnabled } from '@/lib/features';
import { useMockAuth } from '@/hooks/useMockAuth';
import Box from '@ux/box';
import Button from '@ux/button';
import { text } from '@ux/text';
import { MockLoginDialog } from './MockLogin';

interface ProtectedRouteProps {
  children: React.ReactNode;
  realm?: string;
  groups?: string[];
  risk?: 'low' | 'medium' | 'high';
  requiredAccess?: 'user' | 'admin';
  loadingMessage?: string;
  unauthorizedMessage?: string;
}

export default function ProtectedRoute({
  children,
  realm = 'idp',
  groups = [],
  risk = 'low',
  requiredAccess = 'user',
  loadingMessage = 'Checking Authentication',
  unauthorizedMessage = 'You need to be signed in to access this area of Airo App Builder.'
}: ProtectedRouteProps) {

  // Always call hooks at the top level - never conditionally
  const isMockLoginEnabled = isFeatureEnabled.mockLogin();
  const mockAuth = useMockAuth();
  const { config: gasketConfig, isLoading: configLoading } = useGasketConfig();

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
    const [showMockLogin, setShowMockLogin] = useState(false);

    return (
      <>
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
          <div className="text-center max-w-md mx-auto px-6">
            <text.h2 as="heading" size={ -1 } className="mb-2">Access Required</text.h2>
            <p className="text-gray-600 mb-12">
              {unauthorizedMessage}
            </p>

            {/* Show mock login if feature is enabled */}
            {isFeatureEnabled.mockLogin() ? (
              <Box gap="md">
                <Button
                  design='primary'
                  text='🚀 Mock Sign In (Dev Mode)'
                  onClick={() => setShowMockLogin(true)}
                />
                <p className="text-xs text-gray-500">
                  Development mode - choose a test user to simulate the login experience
                </p>
              </Box>
            ) : (
              <Button
                onClick={() => {
                  const url = new URL(gasketConfig.sso.loginUrl);
                  url.searchParams.set('app', 'airo-builder');
                  url.searchParams.set('redirect', window.location.href);
                  window.location.href = url.toString();
                }}
                design='primary'
                text='Sign In to Continue'
                className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all"
              />
            )}
          </div>
        </div>

        {/* Mock Login Dialog */}
        {isFeatureEnabled.mockLogin() && (
          <MockLoginDialog
            isOpen={showMockLogin}
            onClose={() => setShowMockLogin(false)}
            title="Protected Route Access"
            message="This page requires authentication. Choose a test user to simulate the login experience."
          />
        )}
      </>
    );
  };

  // Show loading state while config is loading
  if (configLoading) {
    return <LoadingComponent />;
  }

  // Check mock authentication first
  if (isMockLoginEnabled) {
    if (mockAuth.isLoading) {
      return <LoadingComponent />;
    }

    if (!mockAuth.isAuthenticated) {
      return <UnauthorizedComponent />;
    }

    // User is authenticated with mock login
    return <div>{children}</div>;
  }

  // Skip authentication if disabled in dev
  if (gasketConfig.auth.disableInDev) {
    return <div>{children}</div>;
  }

  // Configure auth parameters based on access level with heartbeat enabled
  const baseConfig = requiredAccess === 'admin' ? authConfigs.admin : authConfigs.user;
  const authParams = {
    ...baseConfig,
    realm: requiredAccess === 'admin' ? 'jomax' : realm,
    groups: requiredAccess === 'admin' ? ['admin', 'developer', ...groups] : groups,
    risk: requiredAccess === 'admin' ? 'medium' : risk,
  };

  return (
    <AuthRequired
      realm={authParams.realm as AuthRealmType}
      groups={authParams.groups}
      risk={authParams.risk}
      allowHeartbeat={authParams.allowHeartbeat}
      use12HourExpiration={authParams.use12HourExpiration}
      loading={<LoadingComponent />}
      alt={<UnauthorizedComponent />}
    >
      <>{children}</>
    </AuthRequired>
  );
}
