/**
 * Checkout Success Page
 *
 * Displayed after Stripe payment redirect.
 * VALIDATES payment via S2S call before showing success.
 *
 * URL: /checkout/success?session_id=cs_xxx
 *
 * Stripe enum values (for reference):
 *   session.status: "open" | "complete" | "expired"
 *   session.payment_status: "paid" | "unpaid" | "no_payment_required"
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import { useCart } from '@/contexts/use-cart';
import { clearFunnelSession, getCheckoutSnapshot, getStripeMode } from '@/lib/analytics/funnel-session';
import { track } from '@/lib/analytics/track';
import { formatPrice } from '@/lib/stripe/format';

interface SessionDetails {
  customerName?: string;
  amountTotal?: number;
  currency?: string;
  paymentStatus?: string; // "paid" | "unpaid" | "no_payment_required"
  status?: string; // "open" | "complete" | "expired"
}

// Verification states
type VerificationState = 'verifying' | 'verified' | 'failed' | 'no_session';

export default function CheckoutSuccess() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const { clearCart } = useCart();
  const [details, setDetails] = useState<SessionDetails | null>(null);
  const [verification, setVerification] = useState<VerificationState>('verifying');
  const [errorMessage, setErrorMessage] = useState<string>('');
  // Guard against React StrictMode double-invoking the effect in dev.
  const firedRef = useRef(false);

  // MANDATORY: Verify payment status with Stripe before showing success
  useEffect(() => {
    if (firedRef.current) return;

    const snapshot = getCheckoutSnapshot();
    const pagePath = window.location.pathname;

    // No session_id in URL
    if (!sessionId) {
      firedRef.current = true;
      track('airo.website.stripe.purchase_not_verified', 'action', 'purchase_not_verified', {
        page_path: pagePath,
        reason: 'no_session',
        error_detail: 'no_session',
        ...(snapshot ?? {}),
      });
      clearFunnelSession();
      setVerification('no_session');
      setErrorMessage('No payment session found. Please try again.');
      return;
    }

    // Validate session_id format (Stripe checkout sessions start with "cs_")
    if (!sessionId.startsWith('cs_')) {
      firedRef.current = true;
      track('airo.website.stripe.purchase_not_verified', 'action', 'purchase_not_verified', {
        page_path: pagePath,
        reason: 'failed',
        error_detail: 'invalid_session_id_format',
        stripe_mode: getStripeMode(sessionId),
        ...(snapshot ?? {}),
      });
      clearFunnelSession();
      setVerification('failed');
      setErrorMessage('Invalid session format.');
      return;
    }

    const stripeMode = getStripeMode(sessionId);

    const verify = async () => {
      try {
        const res = await fetch(`/api/stripe/session/${sessionId}`);
        if (!res.ok) {
          firedRef.current = true;
          track('airo.website.stripe.purchase_not_verified', 'action', 'purchase_not_verified', {
            page_path: pagePath,
            reason: 'failed',
            error_detail: `http_${res.status}`,
            stripe_mode: stripeMode,
            ...(snapshot ?? {}),
          });
          clearFunnelSession();
          setVerification('failed');
          setErrorMessage('Unable to verify payment. Please contact support if you were charged.');
          return;
        }

        const data = await res.json();
        if (!data?.success || !data?.session) {
          firedRef.current = true;
          track('airo.website.stripe.purchase_not_verified', 'action', 'purchase_not_verified', {
            page_path: pagePath,
            reason: 'failed',
            error_detail: 'invalid_session_response',
            stripe_mode: stripeMode,
            ...(snapshot ?? {}),
          });
          clearFunnelSession();
          setVerification('failed');
          setErrorMessage('Unable to verify payment. Please contact support if you were charged.');
          return;
        }

        const session = data.session;
        setDetails(session);

        const isComplete = session.status === 'complete';
        const isPaid = session.paymentStatus === 'paid';

        if (isComplete && isPaid) {
          firedRef.current = true;
          track('airo.website.stripe.purchase_verified', 'action', 'purchase_verified', {
            page_path: pagePath,
            stripe_mode: stripeMode,
            currency: session.currency ?? snapshot?.currency,
            amount_total: session.amountTotal,
            amount_total_display: session.amountTotal != null && session.currency
              ? formatPrice(session.amountTotal, session.currency)
              : snapshot?.amount_total_display,
            checkout_source: snapshot?.checkout_source,
            line_count: snapshot?.line_count,
            quantity_total: snapshot?.quantity_total,
            line_items_json: snapshot?.line_items_json,
            funnel_session_id: snapshot?.funnel_session_id,
          });
          clearFunnelSession();
          clearCart();
          setVerification('verified');
        } else if (session.paymentStatus === 'unpaid') {
          firedRef.current = true;
          track('airo.website.stripe.purchase_not_verified', 'action', 'purchase_not_verified', {
            page_path: pagePath,
            reason: 'failed',
            error_detail: 'payment_status_unpaid',
            stripe_mode: stripeMode,
            ...(snapshot ?? {}),
          });
          clearFunnelSession();
          setVerification('failed');
          setErrorMessage('Payment was not completed. Please try again.');
        } else if (session.status === 'expired') {
          firedRef.current = true;
          track('airo.website.stripe.purchase_not_verified', 'action', 'purchase_not_verified', {
            page_path: pagePath,
            reason: 'failed',
            error_detail: 'session_expired',
            stripe_mode: stripeMode,
            ...(snapshot ?? {}),
          });
          clearFunnelSession();
          setVerification('failed');
          setErrorMessage('Payment session expired. Please try again.');
        } else if (session.status === 'open') {
          firedRef.current = true;
          track('airo.website.stripe.purchase_not_verified', 'action', 'purchase_not_verified', {
            page_path: pagePath,
            reason: 'failed',
            error_detail: 'session_open',
            stripe_mode: stripeMode,
            ...(snapshot ?? {}),
          });
          clearFunnelSession();
          setVerification('failed');
          setErrorMessage('Payment is still processing. Please wait or contact support.');
        } else {
          firedRef.current = true;
          track('airo.website.stripe.purchase_not_verified', 'action', 'purchase_not_verified', {
            page_path: pagePath,
            reason: 'failed',
            error_detail: 'unknown',
            stripe_mode: stripeMode,
            ...(snapshot ?? {}),
          });
          clearFunnelSession();
          setVerification('failed');
          setErrorMessage('Unable to verify payment. Please contact support.');
        }
      } catch (error) {
        console.error('Payment verification failed:', error);
        firedRef.current = true;
        track('airo.website.stripe.purchase_not_verified', 'action', 'purchase_not_verified', {
          page_path: pagePath,
          reason: 'failed',
          error_detail: 'network_or_parse',
          stripe_mode: stripeMode,
          ...(snapshot ?? {}),
        });
        clearFunnelSession();
        setVerification('failed');
        setErrorMessage('Unable to verify payment. Please contact support if you were charged.');
      }
    };

    verify();
  }, [sessionId, clearCart]);

  // VERIFYING STATE - Show loading spinner
  if (verification === 'verifying') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('stripe.verifying_payment_title')}</h1>
          <p className="text-gray-600">{t('stripe.verifying_payment_message')}</p>
        </div>
      </div>
    );
  }

  // FAILED or NO_SESSION STATE - Show error
  if (verification === 'failed' || verification === 'no_session') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-8 h-8 text-yellow-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('stripe.payment_failed_title')}</h1>
          <p className="text-gray-600 mb-6">{errorMessage}</p>
          <div className="space-y-3">
            <Link
              to="/"
              className="block w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              {t('stripe.btn_try_again')}
            </Link>
            <Link
              to="/"
              className="block w-full bg-gray-100 text-gray-700 py-3 px-4 rounded-lg font-medium hover:bg-gray-200 transition-colors"
            >
              {t('stripe.btn_return_home')}
            </Link>
          </div>
          {sessionId && (
            <p className="mt-6 text-xs text-gray-400">{t('stripe.reference_label')}: {sessionId.slice(0, 20)}...</p>
          )}
        </div>
      </div>
    );
  }

  // VERIFIED STATE - Payment confirmed! Show success
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        {/* Success Icon */}
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-8 h-8 text-green-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('stripe.payment_success_title')}</h1>

        <p className="text-gray-600 mb-6">
          {t('stripe.payment_success_message')}
        </p>

        {/* Order details from verified session */}
        {details && (
          <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
            {details.customerName && (
              <p className="text-sm text-gray-600">
                <span className="font-medium">{t('stripe.detail_name_label')}:</span> {details.customerName}
              </p>
            )}
            {details.amountTotal != null && details.currency && (
              <p className="text-sm text-gray-600">
                <span className="font-medium">{t('stripe.detail_total_label')}:</span>{' '}
                {formatPrice(details.amountTotal, details.currency)}
              </p>
            )}
            <p className="text-sm text-gray-600">
              <span className="font-medium">{t('stripe.detail_status_label')}:</span>{' '}
              <span className="text-green-600 font-medium">{t('stripe.detail_status_verified')}</span>
            </p>
          </div>
        )}

        <div className="space-y-3">
          <Link
            to="/"
            className="block w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            {t('stripe.btn_return_home')}
          </Link>

          <Link
            to="/"
            className="block w-full bg-gray-100 text-gray-700 py-3 px-4 rounded-lg font-medium hover:bg-gray-200 transition-colors"
          >
            {t('stripe.btn_continue_shopping')}
          </Link>
        </div>

        {sessionId && (
          <p className="mt-6 text-xs text-gray-400">{t('stripe.order_reference_label')}: {sessionId.slice(0, 20)}...</p>
        )}
      </div>
    </div>
  );
}
