'use client';

import { useEffect, useRef, useState } from 'react';
import { AuthIdpType, AuthRealmType, AuthRequired, AuthRiskType } from '@godaddy/gasket-auth';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { useGasketConfig } from '@/hooks/useGasketConfig';
import LoadingComponent from './LoadingComponent';
import SsoLoginPrompt from './SsoLoginPrompt';

interface ProtectedRouteProps {
  children: React.ReactNode;
  realm?: AuthRealmType;
  groups?: string[];
  risk?: AuthRiskType;
  type?: AuthIdpType[];
  loadingFallback?: React.ReactNode;
}

export default function ProtectedRoute({
  children,
  realm,
  groups = [],
  risk,
  type,
  loadingFallback
}: ProtectedRouteProps) {
  const [isClient, setIsClient] = useState(false);
  const hasInitiallyRendered = useRef(false);

  // Get gasket configuration and auth state
  const { isLoading: configLoading } = useGasketConfig();
  const {
    isAuthenticated,
    isLoading: authLoading,
    isMockAuth
  } = useAuthContext();

  // Set client flag after hydration
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Track when initial loading completes
  if (!configLoading && isClient && !authLoading) {
    hasInitiallyRendered.current = true;
  }

  // Only gate rendering on initial load. After initial auth completes, keep children
  // mounted during client-side revalidations to prevent tearing down websocket connections.
  if (!hasInitiallyRendered.current && (configLoading || !isClient || authLoading)) {
    return <>{loadingFallback ?? <LoadingComponent />}</>;
  }

  // Configure auth parameters based on access level
  const authParams = {
    realm: realm || 'idp' as AuthRealmType,
    risk: risk || 'low' as AuthRiskType,
    type: type || ['basic'] as AuthIdpType[],
    groups,
    allowHeartbeat: false,
    use12HourExpiration: true
  };

  if (isMockAuth) {
    return isAuthenticated ? <>{children}</> : <SsoLoginPrompt />;
  }

  return (
    <AuthRequired
      {...authParams}
      loading={loadingFallback ?? <LoadingComponent />}
      alt={<SsoLoginPrompt />}
    >
      <>{children}</>
    </AuthRequired>
  );
}
