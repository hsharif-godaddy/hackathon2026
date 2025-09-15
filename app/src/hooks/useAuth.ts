import { useAuthState, AuthRealmType, AuthRiskType, AuthIdpType } from '@godaddy/gasket-auth';
import { authConfigs } from '@/lib/gasket-config';
import { useGasketConfig } from '@/hooks/useGasketConfig';
import { isFeatureEnabled } from '@/lib/features';
import { useMockAuth } from '@/hooks/useMockAuth';

export function useAuth(onShowMockLogin?: () => void) {
  const isMockLoginEnabled = isFeatureEnabled.mockLogin();
  const mockAuth = useMockAuth();
  const { config: gasketConfig, isLoading: configLoading } = useGasketConfig();

  // Get auth state to check if user is actually signed in
  const authState = useAuthState({
    realm: authConfigs.user.realm as AuthRealmType,
    risk: authConfigs.user.risk as AuthRiskType,
    type: authConfigs.user.type as AuthIdpType[],
    allowHeartbeat: authConfigs.user.allowHeartbeat,
    use12HourExpiration: authConfigs.user.use12HourExpiration,
  });

  // Determine if user is authenticated (either mock or real)
  const isAuthenticated = isMockLoginEnabled
    ? mockAuth.isAuthenticated
    : authState.valid;

  // Helper function to get user email
  const getUserEmail = () => {
    if (isMockLoginEnabled && mockAuth.isAuthenticated && mockAuth.user) {
      return mockAuth.user.email;
    }
    // For real auth, you might extract email from authState.details
    return 'user@example.com';
  };

  // Handle sign out
  const handleSignOut = async () => {
    if (isMockLoginEnabled) {
      await mockAuth.logout();
    } else {
      const url = new URL(gasketConfig.sso.logoutUrl);
      url.searchParams.set('app', 'airo-builder');
      url.searchParams.set('redirect', gasketConfig.redirects.logoutRedirectUrl);
      window.location.href = url.toString();
    }
  };

  // Handle sign in
  const handleSignIn = (redirectUrl?: string) => {
    if (isMockLoginEnabled) {
      // If callback is provided, use it to show the modal
      if (onShowMockLogin) {
        onShowMockLogin();
        return { showModal: false };
      }
      // Fallback for components that handle their own modal
      return { showModal: true };
    } else {
      const url = new URL(gasketConfig.sso.loginUrl);
      url.searchParams.set('app', 'airo-builder');
      url.searchParams.set('redirect', redirectUrl || gasketConfig.redirects.loginRedirectUrl);
      window.location.href = url.toString();
      return { showModal: false };
    }
  };

  return {
    isAuthenticated,
    isLoading: configLoading,
    isAuthDisabled: gasketConfig?.auth?.disableInDev,
    authState,
    mockAuth,
    getUserEmail,
    gasketConfig,
    handleSignOut,
    handleSignIn
  };
}
