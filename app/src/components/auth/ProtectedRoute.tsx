'use client';

import { useEffect, useState } from 'react';
import { AuthIdpType, AuthRealmType, AuthRequired, AuthRiskType } from '@godaddy/gasket-auth';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { useGasketConfig } from '@/hooks/useGasketConfig';
import { useTranslations } from '@/hooks/useTranslations';
import LoadingComponent from './LoadingComponent';
import UnauthorizedComponent from './UnauthorizedComponent';

interface ProtectedRouteProps {
  children: React.ReactNode;
  realm?: AuthRealmType;
  groups?: string[];
  risk?: AuthRiskType;
  type?: AuthIdpType[];
  unauthorizedMessage?: string;
}

export default function ProtectedRoute({
  children,
  realm,
  groups = [],
  risk,
  type,
  unauthorizedMessage = null
}: ProtectedRouteProps) {
  const t = useTranslations();
  // State to track if component has hydrated and mock login dialog
  const [isClient, setIsClient] = useState(false);

  unauthorizedMessage = unauthorizedMessage || t('builder_auth_protected_message');

  // Get gasket configuration and auth state
  const { isLoading: configLoading } = useGasketConfig();
  const {
    isAuthenticated,
    isLoading: authLoading,
    isAuthDisabled,
    isMockAuth
  } = useAuthContext();

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
      return <UnauthorizedComponent unauthorizedMessage={unauthorizedMessage} />
    }
    // Mock user is authenticated
    return <>{children}</>;
  }

  // JWT mode - use Gasket AuthRequired
  return (
    <AuthRequired
      {...authParams}
      loading={<LoadingComponent />}
      alt={<UnauthorizedComponent unauthorizedMessage={unauthorizedMessage} />}
    >
      <>{children}</>
    </AuthRequired>
  );
}
