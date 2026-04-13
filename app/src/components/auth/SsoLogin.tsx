'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import Alert from '@ux/alert';
import Modal from '@ux/modal';
import Spinner from '@ux/spinner';

import { useBreakpoints } from '@/hooks/useBreakpoints';
import { SsoExpirationCode } from '@/lib/features';
import { logger } from '@/lib/request-context';
import { useAuthUIStore } from '@/stores/useAuthUIStore';
import { useSitesStore } from '@/stores/useSitesStore';
import { getRootDomain } from '@/utils/getRootDomain';

/**
 * Props interface for SsoDeck component
 *
 * Defined manually to avoid static imports from @sso/deck which break SSR
 */
interface SsoDeckComponentProps {
  host: string;
  ssoApp: string;
  ssoPort: string;
  consumingApp: string;
  consumingPath: string;
  consumingPort?: string;
  pageToLoad: string;
  pageToLoadParams?: Record<string, string>;
  onAuth: (data?: unknown) => void;
  onLoad?: () => void;
  autoResize?: boolean;
}

/**
 * Dynamically import SsoDeck with SSR disabled
 *
 * CRITICAL: @sso/deck does not support SSR. ALL imports from this package
 * (including CSS and types) MUST be inside the dynamic import factory function.
 * Any static imports at module level will cause SSR errors.
 */
const SsoDeckDynamic = dynamic<SsoDeckComponentProps>(
  async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@sso/deck/dist/index.css');

    const { SsoDeck } = await import('@sso/deck');

    return {
      default: function SsoDeckWrapper(props: SsoDeckComponentProps) {
        return <SsoDeck {...props} />;
      },
    };
  },
  {
    ssr: false,
  }
);

/**
 * Global SsoDeck wrapper component for in-app SSO authentication
 *
 * This component should be rendered once at the root layout level and controlled
 * via the useAuthUIStore Zustand store.
 */
export default function SsoLogin() {
  const [error, setError] = useState<string | null>(null);
  const [ssoHost, setSsoHost] = useState<string | null>(null);
  const [currentOrigin, setCurrentOrigin] = useState<string>('');
  const { isSmBreakpoint } = useBreakpoints();

  const { isSsoLoginOpen, isSsoLoading, closeSsoLogin, setSsoLoaded, redirectUrl, setRedirectUrl, authReason } = useAuthUIStore();
  const clearRequiresAuth = useSitesStore((state) => state.clearRequiresAuth);

  function dismissSsoModal() {
    closeSsoLogin('dismiss');
  }

  // Determine consuming port on client-side only using lazy initializer to avoid SSR hydration issues
  // Only pass non-standard ports (not 80, 443, or 3000) to SsoDeck for proper origin validation
  const [consumingPort] = useState(() => {
    if (typeof window === 'undefined') return '';
    const port = window.location.port;
    return (port && port !== '80' && port !== '443' && port !== '3000') ? port : '';
  });

  // Determine SSO host and current origin on client-side only
  useEffect(function determineSsoHost() {
    setSsoHost(getRootDomain() || 'godaddy.com');
    setCurrentOrigin(window.location.origin);
  }, []);

  const handleLoad = useCallback(function onSsoLoad() {
    setSsoLoaded();
  }, [setSsoLoaded]);

  /**
   * Validate redirect URL for security
   * Prevents auth loops and external redirects
   */
  const isValidRedirectUrl = useCallback((url: string): boolean => {
    if (!url || typeof window === 'undefined') {
      return false;
    }

    try {
      // Parse as absolute URL using current origin as base
      const parsedUrl = new URL(url, window.location.origin);
      const currentOrigin = window.location.origin;
      const currentProtocol = window.location.protocol;

      // Must be same origin and protocol
      if (parsedUrl.origin !== currentOrigin || parsedUrl.protocol !== currentProtocol) {
        logger.warn('sso-login.redirect.validation.origin-mismatch', {
          message: 'Redirect URL origin/protocol mismatch, rejecting',
          redirectUrl: url,
          requestedOrigin: parsedUrl.origin,
          requestedProtocol: parsedUrl.protocol,
          currentOrigin,
          currentProtocol
        });
        return false;
      }

      // Prevent auth loops - don't redirect to auth/login pages
      const pathname = parsedUrl.pathname.toLowerCase();
      const authPaths = ['/login', '/auth', '/sso'];
      if (authPaths.some(path => pathname.startsWith(path))) {
        logger.warn('sso-login.redirect.validation.auth-loop', {
          message: 'Preventing redirect to auth page (would cause loop)',
          redirectUrl: url,
          pathname
        });
        return false;
      }

      return true;
    } catch (error) {
      logger.warn('sso-login.redirect.validation.invalid-url', {
        message: 'Invalid redirect URL format',
        redirectUrl: url,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }, []);

  const redirectToRequestedPath = useCallback(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const redirectParam = searchParams.get('redirect');
    if (!redirectParam) {
      return false;
    }

    try {
      const baseOrigin = window.location.origin;
      const baseProtocol = window.location.protocol;
      const url = new URL(redirectParam, baseOrigin);
      const isSameOrigin = url.origin === baseOrigin;
      const isSameProtocol = url.protocol === baseProtocol;

      if (!isSameOrigin || !isSameProtocol) {
        logger.warn('sso-login.auth.redirect.rejected', {
          message: 'Redirect URL origin mismatch, ignoring',
          redirectUrl: redirectParam,
          requestedOrigin: url.origin,
          requestedProtocol: url.protocol,
        });
        return false;
      }

      logger.info('sso-login.auth.redirect', {
        message: 'Redirecting to requested URL after SSO login',
        redirectPath: url.pathname + url.search + url.hash,
      });
      window.location.assign(url.href);
      return true;
    } catch (error) {
      logger.warn('sso-login.auth.redirect.invalid', {
        message: 'Invalid redirect URL from SSO',
        redirectUrl: redirectParam,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }, []);

  /**
   * Apply redirect from store first, then fallback to query param
   * Returns true if redirect was applied
   */
  const applyRedirect = useCallback((): boolean => {
    if (typeof window === 'undefined') {
      return false;
    }

    // Priority 1: Check store redirectUrl (set by AuthBoundary when modal opened)
    if (redirectUrl) {
      if (isValidRedirectUrl(redirectUrl)) {
        logger.info('sso-login.redirect.from-store', {
          message: 'Redirecting to stored URL after SSO login',
          redirectUrl
        });
        try {
          window.location.assign(redirectUrl);
          // Clear after successful navigation attempt
          setRedirectUrl(null);
          return true;
        } catch (error) {
          logger.warn('sso-login.redirect.from-store.failed', {
            message: 'Failed to navigate to stored redirect URL',
            redirectUrl,
            error: error instanceof Error ? error.message : String(error),
          });
          // Do not clear redirectUrl here so it can potentially be retried
        }
      } else {
        // Invalid redirect URL in store, clear it
        setRedirectUrl(null);
      }
    }

    // Priority 2: Fallback to query param (external SSO flow)
    return redirectToRequestedPath();
  }, [redirectUrl, isValidRedirectUrl, setRedirectUrl, redirectToRequestedPath]);

  const handleAuth = useCallback(function onSsoAuth(data?: unknown) {
    logger.info('sso-login.auth.success', {
      message: 'SSO authentication successful',
      data,
    });

    // Priority 1: Use stored redirect URL (from AuthBoundary) or ?redirect= query param.
    // Both paths inside applyRedirect() navigate via window.location.assign, so the page
    // unloads entirely — cleanup (closeSsoLogin, clearRequiresAuth) is unnecessary and the
    // SSO modal's loading state covers the visual transition until navigation completes.
    if (applyRedirect()) {
      return;
    }

    // Cleanup before fallback redirects (Priorities 2 & 3).
    // Skipped above because applyRedirect() navigates away entirely.
    setError(null);
    closeSsoLogin('success');
    clearRequiresAuth(); // Allow sites store to refetch

    // Priority 2: Use redirect_url from SSO if provided AND it matches our origin
    // This is a fallback for flows where no store redirect was captured (e.g. direct
    // SSO modal open without AuthBoundary, or session extension)
    const ssoData = data as { data?: { redirect_url?: string } } | undefined;
    if (ssoData?.data?.redirect_url) {
      if (isValidRedirectUrl(ssoData.data.redirect_url)) {
        logger.info('sso-login.redirect.sso', {
          message: 'Navigating to SSO-provided redirect URL',
          url: ssoData.data.redirect_url,
        });
        window.location.assign(ssoData.data.redirect_url);
        return;
      } else {
        logger.warn('sso-login.redirect.sso-rejected', {
          message: 'SSO redirect URL does not match current origin, using fallback',
          ssoRedirectUrl: ssoData.data.redirect_url,
          currentOrigin: window.location.origin,
        });
      }
    }

    // Priority 3: No redirect available - reload current page to pick up new auth cookie
    // This ensures Gasket Auth does a fresh check instead of using stale cached state
    logger.info('sso-login.reload', {
      message: 'No redirect available, reloading page to pick up new auth cookie',
    });
    window.location.reload();
  }, [closeSsoLogin, clearRequiresAuth, applyRedirect, isValidRedirectUrl]);

  // Don't render if not open
  if (!isSsoLoginOpen) {
    return null;
  }

  // Route to the correct SSO page based on auth failure type:
  // HBI = 2FA challenge page (not password re-entry)
  // LOGIN and VAT both route to /login, which is the correct default
  const pageToLoad = authReason === SsoExpirationCode.HBI ? '/hbi' : '/login';

  logger.info('sso-login.auth-reason', {
    message: `SSO routing to ${pageToLoad}`,
    authReason,
    pageToLoad
  });

  // Min dimensions sized to fit SsoDeck iframe content and prevent layout shift when loading
  return (
    <Modal
      className='sso-login-modal min-h-[520px] sm:min-h-[620px] sm:min-w-[580px] max-sm:!px-0'
      title=''
      onClose={dismissSsoModal}
      strategy='fixed'
      stretch={!isSmBreakpoint}
      portalElem={document.body}
    >
      <>
        {error && (
          <Alert emphasis='critical' className='mb-4'>
            {error}
          </Alert>
        )}
        <div className='relative w-full pt-2 md:pt-1 min-h-[480px] sm:min-h-[580px]'>
          {(isSsoLoading || !ssoHost) && (
            <div className='absolute inset-0 flex items-center justify-center'>
              <Spinner />
            </div>
          )}
          {ssoHost && (
            <SsoDeckDynamic
              host={ssoHost}
              ssoApp='sso'
              ssoPort=''
              consumingApp='airo-builder'
              consumingPath='/'
              {...(consumingPort && { consumingPort })}
              pageToLoad={pageToLoad}
              pageToLoadParams={(() => {
                if (!currentOrigin) return {};

                // Build full redirect URL including path from store (captured by AuthBoundary)
                // This ensures SSO redirects back to the specific page (e.g., /develop/abc123)
                // instead of just the homepage
                let fullUrl = currentOrigin;

                if (redirectUrl) {
                  try {
                    // Validate redirect URL before building full URL (security check)
                    if (!isValidRedirectUrl(redirectUrl)) {
                      logger.warn('sso-login.pageToLoadParams.invalid-redirect', {
                        message: 'redirectUrl failed validation, falling back to currentOrigin',
                        redirectUrl
                      });
                    } else {
                      // Convert relative paths to absolute URLs using current origin as base
                      fullUrl = new URL(redirectUrl, currentOrigin).href;
                    }
                  } catch (error) {
                    logger.warn('sso-login.pageToLoadParams.url-construction-error', {
                      message: 'Failed to construct URL from redirectUrl, falling back to currentOrigin',
                      redirectUrl,
                      error: error instanceof Error ? error.message : String(error)
                    });
                  }
                }

                return {
                  redirect_url: fullUrl,
                  ...(authReason != null ? { auth_reason: String(authReason) } : {})
                };
              })()}
              onAuth={handleAuth}
              onLoad={handleLoad}
              autoResize
            />
          )}
        </div>
      </>
    </Modal>
  );
}
