'use client';

import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useRef } from 'react';
import Button from '@ux/button';
import Modal from '@ux/modal';
import text from '@ux/text';

import { isLandingPagePathname } from '@/data/landing-pages/landing-page-paths';
import { useTranslations } from '@/hooks/useTranslations';
import { shipAnalyticsLog } from '@/lib/logging';
import { logger } from '@/lib/request-context';
import { useAuthUIStore } from '@/stores/useAuthUIStore';

interface AuthBoundaryProps {
  children: ReactNode;
}

/**
 * Fallback auth boundary - shows a sign-in prompt only after the user dismisses
 * the auto-opened SSO Deck without completing auth.
 *
 * On 401, this component auto-opens the SSO modal. If the user dismisses it
 * (ssoCloseReason === 'dismiss'), this boundary appears as a fallback with a
 * "Sign in" button.
 *
 * Key behaviors:
 * - Skips homepage (/) which should work for unauthenticated users
 * - Skips explore YAML landings listed in `lookup.json` (see `isLandingPagePathname`)
 * - Only shows after SSO dismiss, not on initial 401
 * - Modal cannot be dismissed (no onClose) - user must sign in
 *
 * @example
 * ```tsx
 * // In layout.tsx
 * <AuthBoundary>
 *   {children}
 * </AuthBoundary>
 * ```
 */
export default function AuthBoundary({ children }: AuthBoundaryProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const { needsReauth, reauthReason, openSsoLogin, isSsoLoginOpen, setRedirectUrl, ssoCloseReason, redirectUrl } = useAuthUIStore();
  const hasLoggedModalShown = useRef(false);
  const hasAutoOpened = useRef(false);
  const reauthReasonRef = useRef(reauthReason);
  const pathnameRef = useRef(pathname);

  const isHomepage = pathname === '/' || pathname === '';
  const isLandingPage = isLandingPagePathname(pathname);

  // Only show as fallback: user dismissed SSO modal without completing auth
  const shouldShowModal = !isHomepage && !isLandingPage && needsReauth && !isSsoLoginOpen && ssoCloseReason === 'dismiss';

  // Keep refs in sync with current values
  useEffect(() => {
    reauthReasonRef.current = reauthReason;
    pathnameRef.current = pathname;
  });

  // Auto-open SSO modal on 401, unless on a public page or already tried this cycle.
  // Uses a ref guard so dismiss + another 401 won't re-open (prevents loops).
  // Guard resets when needsReauth clears (successful auth or explicit clear).
  // If SSO is already open when 401 fires, mark the guard immediately so a
  // concurrent success close doesn't re-open SSO before clearNeedsReauth arrives.
  useEffect(() => {
    if (needsReauth && !isHomepage && !isLandingPage) {
      if (isSsoLoginOpen) {
        hasAutoOpened.current = true;
      } else if (!hasAutoOpened.current) {
        openSsoLogin();
        hasAutoOpened.current = true;
      }
    }
    if (!needsReauth) {
      hasAutoOpened.current = false;
    }
  }, [needsReauth, isSsoLoginOpen, isHomepage, isLandingPage, openSsoLogin]);

  // Track when modal is shown for analytics
  useEffect(() => {
    if (shouldShowModal && !hasLoggedModalShown.current) {
      try {
        shipAnalyticsLog('auth.boundary.modal_shown', {
          reason: reauthReasonRef.current || 'not_authenticated',
          pathname: pathnameRef.current
        });
      } catch (error) {
        // Analytics failures should not break the UI
        logger.error('auth.boundary.analytics-failed', { error });
      }
      hasLoggedModalShown.current = true;
    } else if (!needsReauth) {
      // Only reset when needsReauth is cleared (auth succeeded), not when
      // shouldShowModal temporarily becomes false due to SSO modal opening
      hasLoggedModalShown.current = false;
    }
  }, [shouldShowModal, needsReauth]);

  // Don't show boundary if:
  // - We're on homepage or a landing page
  // - Auth is not required
  // - SSO modal is already open (user is in the process of signing in)
  // - SSO hasn't been dismissed yet (initial 401 auto-opens SSO directly)
  if (!shouldShowModal) {
    return <>{children}</>;
  }

  const handleSignIn = () => {
    if (typeof window !== 'undefined') {
      // Only capture URL if not already set (appFetch captures at 401 time)
      const effectiveRedirectUrl = redirectUrl
        ?? (window.location.pathname + window.location.search + window.location.hash);
      if (!redirectUrl) {
        setRedirectUrl(effectiveRedirectUrl);
      }

      logger.info('auth.boundary.sign-in-clicked', {
        message: 'User clicked sign in from auth boundary',
        reason: reauthReason,
        pathname,
        redirectUrl: effectiveRedirectUrl
      });
    }

    openSsoLogin();
  };

  // Determine message based on reason
  const getMessage = () => {
    switch (reauthReason) {
      case 'session_stale':
        return t(
          'auth_boundary_session_stale',
          undefined,
          'Your session needs to be refreshed. Please sign in to continue.'
        );
      case 'session_expired':
        return t(
          'auth_boundary_session_expired',
          undefined,
          'Your session has expired. Please sign in to continue.'
        );
      case 'not_authenticated':
      default:
        return t(
          'auth_boundary_not_authenticated',
          undefined,
          'Please sign in to continue.'
        );
    }
  };

  return (
    <>
      {children}
      <Modal
        title={t('builder_common_signin_required')}
        strategy="fixed"
      >
        <div className="text-center py-4">
          <text.p
            as="paragraph"
            size={0}
            text={getMessage()}
            className="mb-6"
          />
          <Button
            design="primary"
            onClick={handleSignIn}
          >
            {t('builder_common_signin')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
