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
  const hasEverAuthenticated = useRef(false);

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

  // Track if the user was ever authenticated in this mount cycle.
  // Once true, we bypass AuthRequired to prevent mid-session unmounts
  // (e.g. passive token expiry tearing down WebSocket connections).
  // Mid-session re-auth is handled by GlobalSsoLogin + authPreflight.
  if (isAuthenticated) {
    hasEverAuthenticated.current = true;
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

  // After the user has authenticated at least once, render children directly
  // to avoid AuthRequired tearing them down on passive token expiry.
  // GlobalSsoLogin (mounted at the layout level) + authPreflight handle
  // mid-session re-auth without unmounting the page.
  if (hasEverAuthenticated.current) {
    return <>{children}</>;
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
