'use client';

import { AuthRealmType, AuthRequired } from '@godaddy/gasket-auth';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { getLoginUrl, isAuthDisabled, authConfigs } from '@/lib/gasket-config';

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

  const UnauthorizedComponent = () => (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-6">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-red-600 text-2xl">🔒</span>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Required</h2>
        <p className="text-gray-600 mb-6">
          {unauthorizedMessage}
        </p>
        <button
          onClick={() => window.location.href = getLoginUrl(window.location.href)}
          className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all"
        >
          Sign In to Continue
        </button>
      </div>
    </div>
  );

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
