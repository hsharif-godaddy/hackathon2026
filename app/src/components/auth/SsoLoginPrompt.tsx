'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@ux/button';
import Spinner from '@ux/spinner';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { useSsoSignIn } from '@/hooks/useSsoSignIn';
import { useTranslations } from '@/hooks/useTranslations';
import { awaitHeartbeatRecovery, shouldAttemptHeartbeatPatience } from '@/lib/auth/heartbeat-patience';
import { useAuthUIStore } from '@/stores/useAuthUIStore';
import { MockLoginDialog } from './MockLogin';

/**
 * Rendered as the `alt` content of Gasket's AuthRequired (or directly in mock
 * mode). Auto-triggers the sign-in flow on mount: SSODeck modal in JWT mode,
 * MockLoginDialog in mock mode.
 *
 * If the user dismisses SSO without authenticating, authState remains invalid
 * so AuthRequired keeps rendering this component. We reset the trigger guard
 * on dismiss and show a retry button so the user isn't stuck on an infinite
 * spinner.
 */
export default function SsoLoginPrompt() {
  const t = useTranslations();
  const { isMockAuth } = useAuthContext();
  const { signIn } = useSsoSignIn();
  const [showMockLogin, setShowMockLogin] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const triggered = useRef(false);
  const hasAttemptedPatience = useRef(false);
  const ssoCloseReason = useAuthUIStore((s) => s.ssoCloseReason);
  const clearSsoCloseReason = useAuthUIStore((s) => s.clearSsoCloseReason);

  useEffect(() => {
    if (triggered.current || dismissed) return;
    triggered.current = true;

    if (hasAttemptedPatience.current || !shouldAttemptHeartbeatPatience()) {
      signIn({ onShowMockLogin: () => setShowMockLogin(true) });
      return;
    }

    hasAttemptedPatience.current = true;

    const controller: AbortController = new AbortController();

    awaitHeartbeatRecovery(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.recovered) {
          signIn({ onShowMockLogin: () => setShowMockLogin(true) });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          signIn({ onShowMockLogin: () => setShowMockLogin(true) });
        }
      });

    return () => {
      controller.abort();
    };
  }, [signIn, dismissed]);

  useEffect(() => {
    if (ssoCloseReason === 'dismiss') {
      triggered.current = false;
      setDismissed(true);
      clearSsoCloseReason();
    }
  }, [ssoCloseReason, clearSsoCloseReason]);

  const handleRetry = () => {
    setDismissed(false);
  };

  return (
    <>
      <div className="flex flex-col items-center justify-center min-h-[200px] gap-4">
        {dismissed ? (
          <Button design="primary" onClick={handleRetry} text={t('builder_common_signin')} />
        ) : (
          <Spinner />
        )}
      </div>
      {isMockAuth && showMockLogin && (
        <MockLoginDialog
          isOpen={showMockLogin}
          onClose={() => setShowMockLogin(false)}
        />
      )}
    </>
  );
}
