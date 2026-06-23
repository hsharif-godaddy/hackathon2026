import { useCallback, useMemo } from 'react';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { useAuthUIStore } from '@/stores/useAuthUIStore';
import { getRootDomain } from '@/utils/getRootDomain';

/**
 * Single entry point for triggering SSO sign-in. Every caller that wants to
 * prompt the user to authenticate MUST go through this hook - do not call
 * `openSsoLogin()` or `handleSignIn()` directly. The environment decision
 * below lives here and only here.
 *
 * Why the env gate:
 *   Chrome's Private Network Access (PNA) check blocks the SSO Deck iframe
 *   in `test-godaddy.com` and `dev-godaddy.com`, because those envs serve the
 *   app from a public edge but resolve `sso.<root>` to a GoDaddy internal IP.
 *   Public -> private subresource loads are blocked with
 *   `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` unless SSO sends
 *   `Access-Control-Allow-Private-Network: true`, which it does not.
 *   Prod works because `sso.godaddy.com` is public. Local dev works because
 *   the origin is localhost (PNA "local" tier, unrestricted).
 *
 *   See `docs/sso-login-env-gating.md` for the full write-up and incident
 *   history (PRs #871, #3089, #3123). Do not remove this gate until the
 *   identity/infra teams confirm the PNA block is lifted.
 */
export function useSsoSignIn() {
  const { handleSignIn, isMockAuth } = useAuthContext();
  const { openSsoLogin } = useAuthUIStore();

  const useSsoModal = useMemo(() => {
    // Local dev: hosts-file-mapped to localhost, PNA "local" -> modal works.
    if (process.env.NODE_ENV === 'development') return true;
    // Prod: sso.godaddy.com is public -> modal works.
    // Deployed test/dev: sso.<root> is private -> must redirect.
    return getRootDomain() === 'godaddy.com';
  }, []);

  /**
   * Trigger sign-in. Picks modal / redirect / mock-dialog based on env.
   *
   * @param options.redirectUrl   Where to return after SSO. Only used by the
   *                              redirect path; modal callers set this via
   *                              `useAuthUIStore.setRedirectUrl` before the
   *                              modal opens.
   * @param options.onShowMockLogin Callback invoked when `AUTH_TYPE=mock`.
   *                              Host component is responsible for rendering
   *                              the `MockLoginDialog`.
   * @param options.authReason   Auth failure reason (e.g. HBI step-up). Only
   *                              used by the redirect path, where it is appended
   *                              as `auth_reason` so SSO performs the right
   *                              step-up rather than a plain login.
   */
  const signIn = useCallback((options?: {
    redirectUrl?: string;
    onShowMockLogin?: () => void;
    authReason?: number | null;
  }) => {
    const { redirectUrl, onShowMockLogin, authReason } = options || {};

    if (isMockAuth) {
      onShowMockLogin?.();
      return;
    }

    if (useSsoModal) {
      openSsoLogin();
    } else {
      handleSignIn(redirectUrl, authReason);
    }
  }, [isMockAuth, useSsoModal, openSsoLogin, handleSignIn]);

  return {
    signIn,
    useSsoModal,
  };
}
