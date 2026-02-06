'use client';

import { useEffect, useRef, useState } from 'react';
import { AuthIdpType, AuthRealmType, AuthRequired, AuthRiskType } from '@godaddy/gasket-auth';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { useGasketConfig } from '@/hooks/useGasketConfig';
import { useSsoSignIn } from '@/hooks/useSsoSignIn';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { useAuthUIStore } from '@/stores/useAuthUIStore';
import LoadingComponent from './LoadingComponent';
import { MockLoginDialog } from './MockLogin';
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
  // State to track if component has hydrated and SSO trigger
  const [isClient, setIsClient] = useState(false);
  const [ssoState, setSsoState] = useState<'idle' | 'triggered' | 'cancelled'>('idle');
  const [showMockLogin, setShowMockLogin] = useState(false);
  const ssoOpenedRef = useRef(false);

  unauthorizedMessage = unauthorizedMessage || t('builder_auth_protected_message');

  // Get gasket configuration and auth state
  const { isLoading: configLoading } = useGasketConfig();
  const {
    isAuthenticated,
    isLoading: authLoading,
    isAuthDisabled,
    isMockAuth
  } = useAuthContext();
  const { signIn, useSsoModal } = useSsoSignIn();
  const { isSsoLoginOpen } = useAuthUIStore();

  // Set client flag after hydration
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Auto-trigger SSO when user is not authenticated and auth state has loaded
  useEffect(() => {
    // Only trigger once per mount, after client hydration, when auth is resolved
    if (!isClient || authLoading || configLoading || ssoState !== 'idle') {
      return;
    }

    // Skip if auth is disabled or user is already authenticated
    if (isAuthDisabled || isAuthenticated) {
      return;
    }

    // Auto-trigger SSO for unauthenticated users
    logger.info('protected_route.auto_sso', {
      message: 'Auto-triggering SSO for protected route',
      isMockAuth
    });

    setSsoState('triggered');
    signIn({ onShowMockLogin: () => setShowMockLogin(true) });
  }, [isClient, authLoading, configLoading, ssoState, isAuthDisabled, isAuthenticated, isMockAuth, signIn]);

  // Reset SSO state after successful auth
  useEffect(() => {
    if (isAuthenticated && ssoState !== 'idle') {
      setSsoState('idle');
      setShowMockLogin(false);
      ssoOpenedRef.current = false;
    }
  }, [isAuthenticated, ssoState]);

  // If the SSO modal was closed without authenticating, allow manual sign-in
  useEffect(() => {
    if (!useSsoModal) {
      return;
    }
    if (isMockAuth) {
      return;
    }
    if (isSsoLoginOpen) {
      ssoOpenedRef.current = true;
      return;
    }
    if (ssoState === 'triggered' && ssoOpenedRef.current && !isAuthenticated) {
      setSsoState('cancelled');
      setShowMockLogin(false);
      ssoOpenedRef.current = false;
    }
  }, [useSsoModal, isMockAuth, ssoState, isSsoLoginOpen, isAuthenticated]);

  // Configure auth parameters based on access level
  const authParams = {
    realm: realm || 'idp' as AuthRealmType,
    risk: risk || 'low' as AuthRiskType,
    type: type || ['basic'] as AuthIdpType[],
    groups,
    allowHeartbeat: true,
    use12HourExpiration: true
  };

  const shouldAutoSso = (
    isClient &&
    !authLoading &&
    !configLoading &&
    !isAuthDisabled &&
    !isAuthenticated &&
    ssoState === 'idle'
  );

  // Show loading state while config is loading, during hydration, or while triggering SSO
  if (configLoading || !isClient || authLoading) {
    return <LoadingComponent />;
  }

  // Prevent unauthorized flash while auto-SSO is about to trigger
  if (shouldAutoSso) {
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
      // Show loading while SSO is being triggered, otherwise show unauthorized screen
      if (ssoState === 'triggered') {
        return (
          <>
            <LoadingComponent />
            <MockLoginDialog
              isOpen={showMockLogin}
              onClose={() => {
                setShowMockLogin(false);
                if (!isAuthenticated) {
                  setSsoState('cancelled');
                }
              }}
            />
          </>
        );
      }
      return (
        <UnauthorizedComponent
          unauthorizedMessage={unauthorizedMessage}
          onSignIn={() => setSsoState('triggered')}
        />
      );
    }
    // Mock user is authenticated
    return <>{children}</>;
  }

  // JWT mode - if SSO was triggered but user still not authenticated, show loading
  // This handles the window between SSO trigger and redirect
  if (ssoState === 'triggered' && !isAuthenticated) {
    return <LoadingComponent />;
  }

  if (ssoState === 'cancelled' && !isAuthenticated) {
    return (
      <UnauthorizedComponent
        unauthorizedMessage={unauthorizedMessage}
        onSignIn={() => setSsoState('triggered')}
      />
    );
  }

  // JWT mode - use Gasket AuthRequired
  return (
    <AuthRequired
      {...authParams}
      loading={<LoadingComponent />}
      alt={
        <UnauthorizedComponent
          unauthorizedMessage={unauthorizedMessage}
          onSignIn={() => setSsoState('triggered')}
        />
      }
    >
      <>{children}</>
    </AuthRequired>
  );
}
