'use client';

import { useEffect } from 'react';
import { useAuthState, AuthRealmType, AuthRiskType, AuthIdpType } from '@godaddy/gasket-auth';
import { ArrowRightOnRectangleIcon, UserPlusIcon } from '@heroicons/react/24/outline';
import { getLoginUrl, getLogoutUrl, isAuthDisabled, authConfigs } from '@/lib/gasket-config';

// Dev mode component when auth is disabled
function DevModeDisplay() {
  return (
    <div className="flex items-center space-x-3">
      {/* Plan Display for Dev Mode */}
      <div className="flex items-center">
        <span className="px-3 py-1 text-xs font-medium bg-yellow-50 text-yellow-600 rounded-full border border-yellow-100">
          Dev Mode
        </span>
      </div>
      
      {/* Dev Mode Indicator */}
      <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
        <span className="text-yellow-600 text-sm">🛠️</span>
      </div>
    </div>
  );
}

// Auth-enabled component
function AuthEnabledMenu() {


  // Helper function to get user's plan (can be enhanced to fetch from API)
  const getUserPlan = (authDetails?: Record<string, unknown>) => {
    // TODO: Fetch actual plan from /api/accounts API using authDetails?.shopperId
    // For now, defaulting to 'Free' plan
    // Future enhancement: Call API to get real plan name (Free, Starter, Pro)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = authDetails; // Acknowledge parameter for future use
    return 'Free';
  };
  
  // Get auth state from Gasket auth with heartbeat enabled
  const authState = useAuthState({
    realm: authConfigs.user.realm as AuthRealmType,
    risk: authConfigs.user.risk as AuthRiskType,
    type: authConfigs.user.type as AuthIdpType[],
    allowHeartbeat: authConfigs.user.allowHeartbeat,
    use12HourExpiration: authConfigs.user.use12HourExpiration,
    alt: <div></div> // Don't redirect, handle manually
  });





  // Check for successful login return from SSO and clean up URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const hasAuthParams = urlParams.has('token') || urlParams.has('auth') || urlParams.has('session');
    
    if (hasAuthParams) {
      // Clean up URL parameters after SSO return
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
      
      // Force a refresh of auth state after SSO return
      // The auth_idp cookie should now be set by GoDaddy SSO
      setTimeout(() => {
        window.location.reload();
      }, 500);
    }
  }, []);

  if (!authState.valid) {
    return null; // Don't show anything here, Sign In button will be separate
  }

  return (
    // Just return plan display for now - logout will be separate
    <div className="flex items-center">
      <span className="px-3 py-1 text-xs font-medium bg-green-50 text-green-600 rounded-full border border-green-100">
        Plan: {getUserPlan(authState.details)}
      </span>
    </div>
  );
}

// Separate Sign In Button Component
interface SignInButtonProps {
  iconOnly?: boolean;
}

export function SignInButton({ iconOnly = false }: SignInButtonProps) {
  // Get auth state to check if user is actually signed in
  const authState = useAuthState({
    realm: authConfigs.user.realm as AuthRealmType,
    risk: authConfigs.user.risk as AuthRiskType,
    type: authConfigs.user.type as AuthIdpType[],
    allowHeartbeat: authConfigs.user.allowHeartbeat,
    use12HourExpiration: authConfigs.user.use12HourExpiration,
    alt: <div></div> // Don't redirect, handle manually
  });

  // Don't show in dev mode or if user is already authenticated
  if (isAuthDisabled() || authState.valid) {
    return null;
  }

  const handleLogin = () => {
    window.location.href = getLoginUrl();
  };

  if (iconOnly) {
    return (
      <button
        onClick={handleLogin}
        className="flex items-center justify-center w-10 h-10 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm hover:shadow-md"
        title="Sign In"
        aria-label="Sign In"
      >
        <UserPlusIcon className="w-5 h-5" />
      </button>
    );
  }

  return (
    <button
      onClick={handleLogin}
      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium"
    >
      Sign In
    </button>
  );
}

// Separate Sign Out Button Component
interface SignOutButtonProps {
  iconOnly?: boolean;
}

export function SignOutButton({ iconOnly = false }: SignOutButtonProps) {
  // Get auth state first (hooks must be called at top level)
  const authState = useAuthState({
    realm: authConfigs.user.realm as AuthRealmType,
    risk: authConfigs.user.risk as AuthRiskType,
    type: authConfigs.user.type as AuthIdpType[],
    allowHeartbeat: authConfigs.user.allowHeartbeat,
    use12HourExpiration: authConfigs.user.use12HourExpiration,
    alt: <div></div> // Don't redirect, handle manually
  });

  // Don't show in dev mode or if user is not authenticated
  if (isAuthDisabled() || !authState.valid) {
    return null;
  }

  const handleLogout = () => {
    window.location.href = getLogoutUrl();
  };

  if (iconOnly) {
    return (
      <button
        onClick={handleLogout}
        className="flex items-center justify-center w-10 h-10 bg-slate-600 hover:bg-slate-700 text-white rounded-lg transition-colors shadow-sm hover:shadow-md"
        title="Sign Out"
        aria-label="Sign Out"
      >
        <ArrowRightOnRectangleIcon className="w-5 h-5" />
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      className="flex items-center space-x-2 bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg transition-colors font-medium shadow-sm"
    >
      <ArrowRightOnRectangleIcon className="w-4 h-4" />
      <span>Sign Out</span>
    </button>
  );
}

export default function UserMenu() {
  // Show dev mode when auth is disabled
  if (isAuthDisabled()) {
    return <DevModeDisplay />;
  }

  return <AuthEnabledMenu />;
}
