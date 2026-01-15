'use client';

import { useEffect, useRef } from 'react';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { getAuthTokenFromCookie } from '@/lib/auth/cookie-utils';
import { logger } from '@/lib/request-context';
import { getErrorMessage } from '@/lib/social-utils';
import { decodeJWT } from '@/lib/utils/jwt-utils';

const WARNING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const CHECK_INTERVAL_MS = 30 * 1000; // Check every 30 seconds

interface SessionTimeoutManagerProps {
  enabled?: boolean;
}

/**
 * Manages JWT session timeout warnings
 *
 * Monitors the auth_idp token expiration and dispatches events when the session
 * is approaching expiration. This allows other components to show warnings and
 * prompt users to extend their session before being logged out.
 *
 * Emits two events:
 * - 'session-expiring': When token will expire within 5 minutes (emitted continuously)
 * - 'session-safe': When token is refreshed and has more than 5 minutes remaining
 *
 * Only active in JWT auth mode.
 */
export default function SessionTimeoutManager({ enabled = true }: SessionTimeoutManagerProps) {
  const { isAuthDisabled, authType } = useAuthContext();
  const lastWarningState = useRef<boolean>(false);

  useEffect(() => {
    // Only run in JWT mode when enabled
    if (!enabled || isAuthDisabled || authType !== 'jwt') {
      return;
    }

    function checkTokenExpiration() {
      try {
        // Get token from cookie
        const token = getAuthTokenFromCookie();
        if (!token) {
          return;
        }

        // Decode JWT to get expiration
        const payload = decodeJWT(token);
        if (!payload?.exp) {
          return;
        }

        // Calculate time until expiration
        const expiresAt = payload.exp * 1000; // Convert to milliseconds
        const now = Date.now();
        const timeUntilExpiry = expiresAt - now;

        // If already expired, let normal auth flow handle it
        if (timeUntilExpiry <= 0) {
          return;
        }

        const isInWarningWindow = timeUntilExpiry <= WARNING_THRESHOLD_MS;

        // Entering warning window
        if (isInWarningWindow && !lastWarningState.current) {
          const minutesRemaining = Math.ceil(timeUntilExpiry / (60 * 1000));

          logger.info('auth.session.expiration-warning', {
            message: 'Session approaching expiration',
            minutesRemaining,
            expiresAt: new Date(expiresAt).toISOString()
          });

          lastWarningState.current = true;
        }

        // Dispatch warning event continuously while in warning window
        // This allows dismissed banners to reappear on next check
        if (isInWarningWindow) {
          const minutesRemaining = Math.ceil(timeUntilExpiry / (60 * 1000));

          window.dispatchEvent(new CustomEvent('session-expiring', {
            detail: {
              expiresAt,
              minutesRemaining,
              timeUntilExpiry
            }
          }));
        }

        // Token was refreshed - dispatch safe event to hide warnings
        if (!isInWarningWindow && lastWarningState.current) {
          logger.info('auth.session.token-refreshed', {
            message: 'Token refreshed, session is safe',
            minutesRemaining: Math.ceil(timeUntilExpiry / (60 * 1000))
          });

          window.dispatchEvent(new CustomEvent('session-safe', {
            detail: { expiresAt, timeUntilExpiry }
          }));

          lastWarningState.current = false;
        }
      } catch (error) {
        logger.error('auth.session.check-error', {
          message: 'Error checking token expiration',
          error: getErrorMessage(error)
        });
      }
    }

    // Check immediately on mount
    checkTokenExpiration();

    // Then check periodically
    const interval = setInterval(checkTokenExpiration, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled, isAuthDisabled, authType]);

  // This component doesn't render anything
  return null;
}
