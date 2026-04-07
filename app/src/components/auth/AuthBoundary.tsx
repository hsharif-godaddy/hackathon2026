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
 * Auth boundary component that shows a sign-in prompt when authentication is required.
 *
 * This component subscribes to `needsReauth` from the auth UI store (set automatically
 * by appFetch on 401 responses) and displays a modal prompting the user to sign in again.
 *
 * Key behaviors:
 * - Skips homepage (/) which should work for unauthenticated users
 * - Skips explore YAML landings listed in `lookup.json` (see `isLandingPagePathname`)
 * - Shows UXCore Modal with "Sign in" button when needsReauth is true
 * - Button opens the SSO modal (same as SessionExpirationBanner)
 * - Does NOT auto-open modal to avoid loops if backend keeps returning 401
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
  const { needsReauth, reauthReason, openSsoLogin, isSsoLoginOpen, setRedirectUrl } = useAuthUIStore();
  const hasLoggedModalShown = useRef(false);
  const reauthReasonRef = useRef(reauthReason);
  const pathnameRef = useRef(pathname);

  const isHomepage = pathname === '/' || pathname === '';
  const isLandingPage = isLandingPagePathname(pathname);

  // Determine if modal should be shown
  const shouldShowModal = !isHomepage && !isLandingPage && needsReauth && !isSsoLoginOpen;

  // Keep refs in sync with current values
  useEffect(() => {
    reauthReasonRef.current = reauthReason;
    pathnameRef.current = pathname;
  });

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
  if (!shouldShowModal) {
    return <>{children}</>;
  }

  const handleSignIn = () => {
    // Capture current URL to redirect back after auth success
    if (typeof window !== 'undefined') {
      const currentUrl = window.location.pathname + window.location.search + window.location.hash;
      setRedirectUrl(currentUrl);

      logger.info('auth.boundary.sign-in-clicked', {
        message: 'User clicked sign in from auth boundary',
        reason: reauthReason,
        pathname,
        redirectUrl: currentUrl
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
