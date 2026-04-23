import { useCallback } from 'react';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { useAuthUIStore } from '@/stores/useAuthUIStore';

/**
 * Hook for triggering the SSO sign-in flow.
 * Opens the SSO login UI unless mock auth is enabled.
 */
export function useSsoSignIn() {
  const { isMockAuth } = useAuthContext();
  const { openSsoLogin } = useAuthUIStore();

  const signIn = useCallback((options?: {
    onShowMockLogin?: () => void;
  }) => {
    if (isMockAuth) {
      options?.onShowMockLogin?.();
      return;
    }

    openSsoLogin();
  }, [isMockAuth, openSsoLogin]);

  return { signIn };
}
