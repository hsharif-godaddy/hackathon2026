import { useCallback, useMemo } from 'react';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { useAuthUIStore } from '@/stores/useAuthUIStore';
import { getRootDomain } from '@/utils/getRootDomain';

/**
 * Hook for handling SSO sign-in based on environment
 *
 * In production (godaddy.com), uses the SSO modal.
 * In test/dev environments, redirects to SSO login page.
 */
export function useSsoSignIn() {
  const { handleSignIn, isMockAuth } = useAuthContext();
  const { openSsoLogin } = useAuthUIStore();

  // Use SSO modal in production and local development, redirect in deployed test environments
  const useSsoModal = useMemo(() => {
    // Local development - use modal (local overrides test-godaddy.com via hosts file)
    if (process.env.NODE_ENV === 'development') return true;
    // Production (godaddy.com) - use modal
    // Deployed test environments (test-godaddy.com, dev-godaddy.com) - use redirect
    return getRootDomain() === 'godaddy.com';
  }, []);

  /**
   * Trigger sign-in flow based on environment
   *
   * @param options.redirectUrl - URL to redirect after successful login (used for redirect mode)
   * @param options.onShowMockLogin - Callback for mock login (development only)
   */
  const signIn = useCallback((options?: {
    redirectUrl?: string;
    onShowMockLogin?: () => void;
  }) => {
    const { redirectUrl, onShowMockLogin } = options || {};

    // Mock auth takes precedence
    if (isMockAuth) {
      if (onShowMockLogin) {
        onShowMockLogin();
      }
      return;
    }

    // Production uses modal, test/dev uses redirect
    if (useSsoModal) {
      openSsoLogin();
    } else {
      handleSignIn(redirectUrl);
    }
  }, [isMockAuth, useSsoModal, openSsoLogin, handleSignIn]);

  return {
    signIn,
    useSsoModal,
  };
}
