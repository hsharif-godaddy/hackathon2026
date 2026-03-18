'use client';

import { useEffect, useRef, useState } from 'react';

import { useTranslations } from '@/hooks/useTranslations';
import ChatBanner from '@/lib/ChatBanner';
import { logger } from '@/lib/request-context';
import { useAuthUIStore } from '@/stores/useAuthUIStore';
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation';

interface SessionExpirationDetail {
  expiresAt: number;
  minutesRemaining: number;
  timeUntilExpiry: number;
}

/**
 * Banner that warns users when their session is about to expire
 *
 * Listens for events from SessionTimeoutManager:
 * - 'session-expiring': Shows warning banner (reappears every check if dismissed)
 * - 'session-safe': Hides banner when token is refreshed
 *
 * The banner can be dismissed, but will reappear on the next warning check
 * (every 30 seconds) if the session is still approaching expiration.
 */
export default function SessionExpirationBanner() {
  const t = useTranslations();
  const [showBanner, setShowBanner] = useState(false);
  const [minutesRemaining, setMinutesRemaining] = useState(5);
  const { openSsoLogin } = useAuthUIStore();

  // Track whether banner was shown for logging purposes
  // Using ref to avoid re-registering event listeners
  const hasLoggedShownRef = useRef(false);
  const hasLoggedHiddenRef = useRef(false);

  useEffect(() => {
    function handleSessionExpiring(event: Event) {
      const customEvent = event as CustomEvent<SessionExpirationDetail>;
      const { minutesRemaining: mins } = customEvent.detail;

      setMinutesRemaining(mins);

      // Log only on first show
      if (!hasLoggedShownRef.current) {
        logger.info('auth.session-banner.shown', {
          message: 'Session expiration warning displayed',
          minutesRemaining: mins
        });
        logImpressionEvent('chat.sessionExpirationBanner.view')();
        hasLoggedShownRef.current = true;
      }

      setShowBanner(true);
    }

    function handleSessionSafe() {
      // Token was refreshed, hide banner automatically
      if (hasLoggedShownRef.current && !hasLoggedHiddenRef.current) {
        logger.info('auth.session-banner.auto-hidden', {
          message: 'Session banner auto-hidden after token refresh'
        });
        hasLoggedHiddenRef.current = true;
      }

      // Reset logging flags for next warning cycle
      hasLoggedShownRef.current = false;
      hasLoggedHiddenRef.current = false;

      setShowBanner(false);
    }

    window.addEventListener('session-expiring', handleSessionExpiring);
    window.addEventListener('session-safe', handleSessionSafe);

    return () => {
      window.removeEventListener('session-expiring', handleSessionExpiring);
      window.removeEventListener('session-safe', handleSessionSafe);
    };
  }, []); // Empty dependency array - event listeners never re-register

  if (!showBanner) {
    return null;
  }

  const handleExtendSession = () => {
    logger.info('auth.session-banner.extend-clicked', {
      message: 'User clicked extend session',
      minutesRemaining
    });
    logClickEvent('chat.sessionExpirationBanner.extend')();

    // Open SSO login modal to refresh token
    openSsoLogin();
    // Banner will hide automatically when 'session-safe' event is dispatched
  };

  const handleDismiss = () => {
    logger.info('auth.session-banner.dismissed', {
      message: 'User dismissed session expiration warning',
      minutesRemaining
    });
    logClickEvent('chat.sessionExpirationBanner.close')();

    // Reset so next re-show fires an impression
    hasLoggedShownRef.current = false;

    setShowBanner(false);
    // Banner will reappear on next check (30s) if still in warning window
  };

  return (
    <ChatBanner variant="warning" onClose={handleDismiss}>
      {t(
        'auth_session_expiring_message',
        { minutes: minutesRemaining },
        `Your session will expire in ${minutesRemaining} ${minutesRemaining === 1 ? 'minute' : 'minutes'}.`
      )}{' '}
      <button
        type="button"
        className="underline !cursor-pointer !normal-case font-semibold"
        onClick={handleExtendSession}
      >
        {t('auth_session_extend_link', undefined, 'Extend session')}
      </button>
    </ChatBanner>
  );
}
