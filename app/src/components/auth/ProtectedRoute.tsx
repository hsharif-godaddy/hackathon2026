'use client';

import { useState } from 'react';
import { AuthRealmType, AuthRequired } from '@godaddy/gasket-auth';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { getLoginUrl, isAuthDisabled, authConfigs } from '@/lib/gasket-config';
import { isFeatureEnabled } from '@/lib/features';
import { useMockAuth } from '@/hooks/useMockAuth';
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
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-red-600 text-2xl">🔒</span>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Required</h2>
            <p className="text-gray-600 mb-6">
              {unauthorizedMessage}
            </p>
            
            {/* Show mock login if feature is enabled */}
            {isFeatureEnabled.mockLogin() ? (
              <div className="space-y-3">
                <button
                  onClick={() => setShowMockLogin(true)}
                  className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 text-white px-6 py-3 rounded-lg hover:from-yellow-600 hover:to-orange-600 transition-all font-medium"
                >
                  🚀 Mock Sign In (Dev Mode)
                </button>
                <p className="text-xs text-gray-500">
                  Development mode - choose a test user to simulate the login experience
                </p>
              </div>
            ) : (
              <button
                onClick={() => window.location.href = getLoginUrl(window.location.href)}
                className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all"
              >
                Sign In to Continue
              </button>
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

  // Always call hooks at the top level - never conditionally
  const isMockLoginEnabled = isFeatureEnabled.mockLogin();
  const mockAuth = useMockAuth(); // Always call this hook

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
  if (isAuthDisabled()) {
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
