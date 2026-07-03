'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@ux/alert';
import Button from '@ux/button';
import Modal from '@ux/modal';
import Spinner from '@ux/spinner';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { SWITCHBOARD_APPBUILDER_SSO_LITE, SWITCHBOARD_APPBUILDER_SSO_MODAL_FALLBACK } from '@/config/switchboard-flags';
import { useBreakpoints } from '@/hooks/useBreakpoints';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { isReturningUser } from '@/lib/returningUser';
import { getSsoPageToLoad } from '@/lib/ssoPageRoute';
import { useAuthUIStore } from '@/stores/useAuthUIStore';
import { useSitesStore } from '@/stores/useSitesStore';
import { getRootDomain } from '@/utils/getRootDomain';
import { getSsoHostParams } from '@/utils/getSsoHostParams';

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
  onError?: (error?: unknown) => void;
  autoResize?: boolean;
  enableCheckoutLite?: boolean;
  trafficFunc?: (eventType: string, eventId: string) => void;
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

// If the SSO Deck iframe never fires onLoad within this window (CSP / Private
// Network Access / network block, etc.) we surface a retry + full-page-redirect
// fallback instead of leaving the user stranded on an indefinite spinner.
const SSO_LOAD_TIMEOUT_MS = 15_000;

// Shorter threshold for auto-advance: if the handshake hasn't completed within
// this window, automatically invoke the full-page redirect instead of waiting
// the full SSO_LOAD_TIMEOUT_MS. The fallback UI still renders at SSO_LOAD_TIMEOUT_MS
// as a secondary affordance for users who dismissed the redirect or it was blocked.
const SSO_AUTO_ADVANCE_MS = 8_000;

// PostMessage actions from @sso/deck's bilateral handshake protocol. Used by the
// parallel instrumentation listener to classify handshake phases without forking
// the deck's control flow.
const SSODECK_ACTION = {
  HANDSHAKE_REQUEST: 'ssodeck_handshake_request',
  ON_LOAD: 'on_load',
  ON_AUTH: 'on_auth',
  ON_ERROR: 'on_error',
  ON_TRAFFIC: 'on_traffic',
} as const;

/**
 * Global SsoDeck wrapper component for in-app SSO authentication
 *
 * This component should be rendered once at the root layout level and controlled
 * via the useAuthUIStore Zustand store.
 */
export default function SsoLogin() {
  const t = useTranslations();
  const [error, setError] = useState<string | null>(null);
  const [ssoHost, setSsoHost] = useState<string | null>(null);
  // The iframe errored (onError) or never loaded within SSO_LOAD_TIMEOUT_MS.
  const [loadFailed, setLoadFailed] = useState(false);
  // Bumped to force a fresh SsoDeck mount when the user retries.
  const [reloadKey, setReloadKey] = useState(0);
  const { isSmBreakpoint } = useBreakpoints();

  const { isSsoLoginOpen, isSsoLoading, closeSsoLogin, setSsoLoaded, redirectUrl, setRedirectUrl, ssoAuthReason, inFlightReauth, isSessionReauth } = useAuthUIStore();
  const clearRequiresAuth = useSitesStore((state) => state.clearRequiresAuth);
  const { authState, handleSignIn } = useAuthContext();
  const ssoLiteEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_SSO_LITE) ?? false;
  // Gates the iframe error/timeout fallback (retry + full-page redirect). When
  // off, the modal keeps its prior behavior: spinner until onLoad, no timeout,
  // and no fallback UI — so a blocked iframe can still strand the user, exactly
  // as before this fix. Lets the recovery roll out / roll back on prod alone.
  const ssoFallbackEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_SSO_MODAL_FALLBACK) ?? false;
  // Prefer preflight-set reason (store) over Gasket authState, since preflight
  // may detect a 401 before Gasket's next validation cycle updates authState.
  // Gasket spreads the /api/auth/validate response onto authState; authReason
  // is not in its typed surface.
  const gasketAuthReason = (authState as { authReason?: number } | null)?.authReason;
  const authReason = ssoAuthReason ?? gasketAuthReason ?? null;

  // Tracks whether auto-advance has already fired for this mount cycle so it
  // doesn't re-trigger on re-renders or after a retry resets loadFailed.
  const autoAdvancedRef = useRef<boolean>(false);
  // Stable ref to the auto-advance action so the timer effect doesn't need the
  // callback in its dependency array (avoids forward-reference issues and
  // unnecessary effect re-arms when authReason changes).
  const autoAdvanceActionRef = useRef<(() => void) | null>(null);
  // Distinguishes user-initiated dismiss from genuine handshake timeout in the
  // instrumentation cleanup. Set synchronously before closeSsoLogin triggers
  // the effect cleanup via isSsoLoginOpen change.
  const dismissedRef = useRef<boolean>(false);

  function dismissSsoModal() {
    dismissedRef.current = true;
    closeSsoLogin('dismiss');
  }

  // Lazy initializer matches getSsoHostParams' SSR-safe contract.
  const [{ app: consumingApp, port: consumingPort }] = useState<{ app: string; port: string }>(getSsoHostParams);

  // Determine SSO host on client-side only
  useEffect(function determineSsoHost() {
    setSsoHost(getRootDomain() || 'godaddy.com');
  }, []);

  // --- Parallel handshake instrumentation ---
  // Additive listener on 'message' that observes the SsoDeck ↔ SSO iframe
  // postMessage handshake without forking the deck's control flow. Failure
  // events (on-error, origin-mismatch, timeout) at warn for ESSP indexing;
  // success events (on-load, on-auth) at info for local debugging.
  useEffect(function ssoHandshakeInstrumentation() {
    if (!isSsoLoginOpen || !ssoHost) return;

    const expectedOrigin: string = `https://sso.${ssoHost}`;
    const openedAt: number = performance.now();
    let onLoadReceivedAt: number = 0;
    let onAuthReceivedAt: number = 0;
    let settled: boolean = false;

    function handleMessage(event: MessageEvent): void {
      const data: unknown = event.data;
      if (!data || typeof data !== 'object') return;

      const action: unknown = (data as Record<string, unknown>).action;
      if (typeof action !== 'string') return;

      // Origin gate: log mismatches that the deck silently drops
      if (event.origin !== expectedOrigin) {
        // Only log SSO-deck-shaped messages from wrong origins
        if (Object.values(SSODECK_ACTION).includes(action as typeof SSODECK_ACTION[keyof typeof SSODECK_ACTION])) {
          logger.warn('sso-login.handshake.origin-mismatch', {
            expectedOrigin,
            actualOrigin: event.origin,
            action,
            elapsedMs: Math.round(performance.now() - openedAt),
          });
        }
        return;
      }

      switch (action) {
        case SSODECK_ACTION.ON_LOAD: {
          onLoadReceivedAt = performance.now();
          const timeToReady: number = Math.round(onLoadReceivedAt - openedAt);
          settled = true;
          logger.info('sso-login.handshake.on-load', {
            timeToReadyMs: timeToReady,
          });
          break;
        }
        case SSODECK_ACTION.ON_AUTH: {
          onAuthReceivedAt = performance.now();
          logger.info('sso-login.handshake.on-auth', {
            timeToAuthMs: Math.round(onAuthReceivedAt - openedAt),
            timeSinceOnLoadMs: onLoadReceivedAt
              ? Math.round(onAuthReceivedAt - onLoadReceivedAt)
              : null,
          });
          break;
        }
        case SSODECK_ACTION.ON_ERROR: {
          logger.warn('sso-login.handshake.on-error', {
            elapsedMs: Math.round(performance.now() - openedAt),
            hadOnLoad: onLoadReceivedAt > 0,
          });
          break;
        }
      }
    }

    window.addEventListener('message', handleMessage);

    return function cleanupHandshakeListener() {
      window.removeEventListener('message', handleMessage);

      // On unmount (close or retry), if we never received ON_LOAD and the user
      // didn't manually dismiss, classify as handshake-timeout. dismissedRef
      // distinguishes user-initiated close from genuine load failure.
      if (!settled && isSsoLoginOpen && !dismissedRef.current) {
        const elapsed: number = Math.round(performance.now() - openedAt);
        logger.warn('sso-login.handshake.timeout', {
          elapsedMs: elapsed,
          hadOnLoad: false,
          hadAuth: onAuthReceivedAt > 0,
        });
      }
    };
  }, [isSsoLoginOpen, ssoHost, reloadKey]);

  // Guard against a stuck spinner: if the iframe hasn't loaded within the
  // timeout while the modal is open, treat it as a load failure so the fallback
  // UI (retry + full-page redirect) renders instead of spinning forever.
  useEffect(function ssoLoadTimeout() {
    if (!ssoFallbackEnabled || !isSsoLoginOpen || !ssoHost || !isSsoLoading) {
      return;
    }
    const timer = window.setTimeout(function onSsoLoadTimeout() {
      if (!autoAdvancedRef.current) {
        logger.warn('sso-login.iframe.load-timeout', {
          message: 'SSO Deck iframe did not load within timeout; showing fallback',
          timeoutMs: SSO_LOAD_TIMEOUT_MS,
        });
      }
      setLoadFailed(true);
    }, SSO_LOAD_TIMEOUT_MS);
    return function clearSsoLoadTimer() {
      window.clearTimeout(timer);
    };
  }, [ssoFallbackEnabled, isSsoLoginOpen, ssoHost, isSsoLoading, reloadKey]);

  // Auto-advance: if the handshake hasn't completed within SSO_AUTO_ADVANCE_MS,
  // automatically invoke the full-page redirect. This fires before the longer
  // SSO_LOAD_TIMEOUT_MS fallback UI — users who would have loaded fine see a
  // brief full-page redirect instead of being stranded on a spinner for 15s.
  // Gated behind the same ssoFallbackEnabled flag for safe rollout.
  useEffect(function ssoAutoAdvance() {
    if (!ssoFallbackEnabled || !isSsoLoginOpen || !ssoHost || !isSsoLoading) {
      return;
    }
    const timer = window.setTimeout(function onSsoAutoAdvance() {
      if (autoAdvancedRef.current) return;
      autoAdvancedRef.current = true;
      logger.warn('sso-login.iframe.auto-advance', {
        message: 'SSO handshake not completed within auto-advance threshold; redirecting to full-page SSO',
        thresholdMs: SSO_AUTO_ADVANCE_MS,
      });
      autoAdvanceActionRef.current?.();
    }, SSO_AUTO_ADVANCE_MS);
    return function clearAutoAdvanceTimer() {
      window.clearTimeout(timer);
    };
  }, [ssoFallbackEnabled, isSsoLoginOpen, ssoHost, isSsoLoading, reloadKey]);

  // SsoLogin stays mounted at the root and only returns null when closed, so
  // local state persists across opens. Clear the failure flag on close so a
  // prior failed attempt doesn't show the fallback immediately on the next open.
  // reloadKey is intentionally NOT reset — it's a monotonic counter whose only
  // purpose is forcing a fresh SsoDeck mount; resetting could collide with a
  // stale key from a previous open and skip the remount.
  useEffect(function resetFallbackOnClose() {
    if (!isSsoLoginOpen) {
      setLoadFailed(false);
      autoAdvancedRef.current = false;
      dismissedRef.current = false;
    }
  }, [isSsoLoginOpen]);

  const handleLoad = useCallback(function onSsoLoad() {
    setLoadFailed(false);
    // Handshake succeeded — suppress any pending auto-advance timer callback
    autoAdvancedRef.current = true;
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

  const getCurrentRelativePath = useCallback((): string => {
    if (typeof window === 'undefined') {
      return '/';
    }

    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }, []);

  const getSsoReturnTarget = useCallback((): { fullUrl: string; path: string } => {
    if (typeof window === 'undefined') {
      return { fullUrl: '', path: '/' };
    }

    const fallbackPath = getCurrentRelativePath();
    const fallbackUrl = `${window.location.origin}${fallbackPath}`;

    if (!redirectUrl) {
      return { fullUrl: fallbackUrl, path: fallbackPath };
    }

    if (!isValidRedirectUrl(redirectUrl)) {
      logger.warn('sso-login.return-target.invalid-redirect', {
        message: 'redirectUrl failed validation, falling back to current page',
        redirectUrl
      });
      return { fullUrl: fallbackUrl, path: fallbackPath };
    }

    const targetUrl = new URL(redirectUrl, window.location.origin);

    return {
      fullUrl: targetUrl.href,
      path: `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`
    };
  }, [getCurrentRelativePath, isValidRedirectUrl, redirectUrl]);

  /**
   * Apply redirect from store first, then fallback to query param
   * Returns true if redirect was applied
   */
  const applyRedirect = useCallback((): boolean => {
    if (typeof window === 'undefined') {
      return false;
    }

    // Priority 1: Check store redirectUrl (set when SSO modal opened)
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
      inFlightReauth,
    });

    // In-flight step-up (authPreflight awaiting) or passive session re-auth
    // (AuthRequired/SsoLoginPrompt path): the page is still mounted behind
    // the modal — close without navigation. The fresh cookie is sufficient
    // for subsequent API calls; ProtectedRoute keeps children rendered after
    // first auth so the page was never unmounted.
    if (inFlightReauth || isSessionReauth) {
      clearRequiresAuth();
      closeSsoLogin('success');
      return;
    }

    // Priority 1: Use stored redirect URL (from the store) or ?redirect= query param.
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
    clearRequiresAuth();

    // Priority 2: Use redirect_url from SSO if provided AND it matches our origin
    // This is a fallback for flows where no store redirect was captured (e.g. direct
    // SSO modal open for session extension)
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
  }, [closeSsoLogin, clearRequiresAuth, applyRedirect, isValidRedirectUrl, inFlightReauth, isSessionReauth]);

  const handleSsoError = useCallback(function onSsoError(err?: unknown) {
    logger.warn('sso-login.iframe.error', {
      message: 'SSO Deck iframe reported an error; showing fallback',
      error: err instanceof Error ? err.message : String(err ?? 'unknown'),
      stack: err instanceof Error ? err.stack : undefined,
    });
    setLoadFailed(true);
  }, []);

  const handleRetrySso = useCallback(function retrySso() {
    logger.info('sso-login.iframe.retry', { message: 'Retrying SSO Deck load' });
    setLoadFailed(false);
    autoAdvancedRef.current = false;
    // Re-open resets isSsoLoading to true so the timeout effect re-arms for
    // this attempt. Without this, an onLoad→onError→retry sequence leaves
    // isSsoLoading false and the timer early-returns, creating a dead-end if
    // the remount hangs without firing onLoad or onError again.
    useAuthUIStore.setState({ isSsoLoading: true });
    setReloadKey(function bumpReloadKey(key) {
      return key + 1;
    });
  }, []);

  // Full-page SSO redirect — bypasses the iframe entirely, so it still works
  // when the iframe itself is blocked (CSP / PNA / network). Carries authReason
  // so an HBI step-up performs the right challenge rather than a plain login.
  // Calls handleSignIn directly rather than useSsoSignIn().signIn() because the
  // latter re-opens the SsoLogin modal on prod — the very thing that failed.
  const handleContinueToSignIn = useCallback(async function continueToSignIn() {
    const target = getSsoReturnTarget();
    logger.info('sso-login.iframe.fallback-redirect', {
      message: 'Falling back to full-page SSO redirect after iframe load failure',
      authReason,
    });
    await handleSignIn(target.fullUrl, authReason);
  }, [getSsoReturnTarget, handleSignIn, authReason]);

  // Keep the ref in sync so the timer effect can call the latest version.
  // Assigned in useEffect (not render body) for concurrent-mode correctness.
  useEffect(function syncAutoAdvanceRef() {
    autoAdvanceActionRef.current = handleContinueToSignIn;
  }, [handleContinueToSignIn]);

  // Wire SsoDeck's internal traffic events (sso.ssodeck.*) to our logger so
  // they reach ESSP. The deck calls trafficFunc(eventType, eventId) for its own
  // internal events (e.g. iframe.error.redirect) and for ON_TRAFFIC messages
  // forwarded from the SSO iframe.
  const handleTraffic = useCallback(function onSsoDeckTraffic(eventType: string, eventId: string) {
    logger.info('sso-login.deck.traffic', { eventType, eventId });
  }, []);

  // Don't render if not open
  if (!isSsoLoginOpen) {
    return null;
  }

  const pageToLoad = getSsoPageToLoad(authReason, isReturningUser(), ssoLiteEnabled);

  logger.info('sso-login.auth-reason', {
    message: `SSO routing to ${pageToLoad}`,
    authReason,
    pageToLoad
  });

  const ssoReturnTarget = getSsoReturnTarget();

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
          {ssoFallbackEnabled && loadFailed ? (
            <div className='absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center'>
              <p className='text-lg font-semibold'>{t('builder_common_error_title')}</p>
              <p>{t('builder_common_error_generic')}</p>
              <div className='flex gap-3'>
                <Button data-testid='sso-fallback-retry' design='secondary' onClick={handleRetrySso} text={t('builder_common_try_again')} />
                <Button data-testid='sso-fallback-signin' design='primary' onClick={handleContinueToSignIn} text={t('builder_common_signin')} />
              </div>
            </div>
          ) : (
            <>
              {(isSsoLoading || !ssoHost) && (
                <div className='absolute inset-0 flex items-center justify-center'>
                  <Spinner />
                </div>
              )}
              {ssoHost && (
                <SsoDeckDynamic
                  key={reloadKey}
                  host={ssoHost}
                  ssoApp='sso'
                  ssoPort=''
                  consumingApp={consumingApp}
                  consumingPath={ssoReturnTarget.path}
                  {...(consumingPort && { consumingPort })}
                  pageToLoad={pageToLoad}
                  pageToLoadParams={{
                    ...(ssoReturnTarget.fullUrl ? { redirect_url: ssoReturnTarget.fullUrl } : {}),
                    ...(authReason != null ? { auth_reason: String(authReason) } : {})
                  }}
                  onAuth={handleAuth}
                  onLoad={handleLoad}
                  onError={ssoFallbackEnabled ? handleSsoError : undefined}
                  trafficFunc={handleTraffic}
                  autoResize
                  {...(ssoLiteEnabled && { enableCheckoutLite: true })}
                />
              )}
            </>
          )}
        </div>
</>
    </Modal>
  );
}
