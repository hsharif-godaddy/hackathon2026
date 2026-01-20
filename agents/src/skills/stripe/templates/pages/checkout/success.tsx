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
import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';

interface SessionDetails {
  customerEmail?: string;
  amountTotal?: number;
  currency?: string;
  paymentStatus?: string; // "paid" | "unpaid" | "no_payment_required"
  status?: string; // "open" | "complete" | "expired"
}

// Verification states
type VerificationState = 'verifying' | 'verified' | 'failed' | 'no_session';

export default function CheckoutSuccess() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [details, setDetails] = useState<SessionDetails | null>(null);
  const [verification, setVerification] = useState<VerificationState>('verifying');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // MANDATORY: Verify payment status with Stripe before showing success
  useEffect(() => {
    // No session_id in URL
    if (!sessionId) {
      setVerification('no_session');
      setErrorMessage('No payment session found. Please try again.');
      return;
    }

    // Validate session_id format (Stripe checkout sessions start with "cs_")
    if (!sessionId.startsWith('cs_')) {
      setVerification('failed');
      setErrorMessage('Invalid session format.');
      return;
    }

    // Fetch session from backend (which calls Stripe API)
    fetch(`/api/stripe/session/${sessionId}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error('Failed to retrieve session');
        }
        return res.json();
      })
      .then((data) => {
        if (!data?.success || !data?.session) {
          throw new Error('Invalid session response');
        }

        const session = data.session;
        setDetails(session);

        // ROBUST CHECK: Verify BOTH status AND payment_status per Stripe docs
        // status: "complete" means checkout flow finished
        // payment_status: "paid" means payment was successful
        const isComplete = session.status === 'complete';
        const isPaid = session.paymentStatus === 'paid';

        if (isComplete && isPaid) {
          setVerification('verified');
        } else if (session.paymentStatus === 'unpaid') {
          setVerification('failed');
          setErrorMessage('Payment was not completed. Please try again.');
        } else if (session.status === 'expired') {
          setVerification('failed');
          setErrorMessage('Payment session expired. Please try again.');
        } else if (session.status === 'open') {
          setVerification('failed');
          setErrorMessage('Payment is still processing. Please wait or contact support.');
        } else {
          // Fallback for any unexpected state
          setVerification('failed');
          setErrorMessage('Unable to verify payment. Please contact support.');
        }
      })
      .catch((error) => {
        console.error('Payment verification failed:', error);
        setVerification('failed');
        setErrorMessage('Unable to verify payment. Please contact support if you were charged.');
      });
  }, [sessionId]);

  // VERIFYING STATE - Show loading spinner
  if (verification === 'verifying') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Verifying Payment...</h1>
          <p className="text-gray-600">Please wait while we confirm your payment with Stripe.</p>
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
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Verification Failed</h1>
          <p className="text-gray-600 mb-6">{errorMessage}</p>
          <div className="space-y-3">
            <Link
              to="/products"
              className="block w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Try Again
            </Link>
            <Link
              to="/"
              className="block w-full bg-gray-100 text-gray-700 py-3 px-4 rounded-lg font-medium hover:bg-gray-200 transition-colors"
            >
              Return Home
            </Link>
          </div>
          {sessionId && (
            <p className="mt-6 text-xs text-gray-400">Reference: {sessionId.slice(0, 20)}...</p>
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

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Successful!</h1>

        <p className="text-gray-600 mb-6">
          Thank you for your purchase. You will receive a confirmation email shortly.
        </p>

        {/* Order details from verified session */}
        {details && (
          <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
            {details.customerEmail && (
              <p className="text-sm text-gray-600">
                <span className="font-medium">Email:</span> {details.customerEmail}
              </p>
            )}
            {details.amountTotal != null && details.currency && (
              <p className="text-sm text-gray-600">
                <span className="font-medium">Total:</span>{' '}
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: details.currency,
                }).format(details.amountTotal / 100)}
              </p>
            )}
            <p className="text-sm text-gray-600">
              <span className="font-medium">Status:</span>{' '}
              <span className="text-green-600 font-medium">Verified ✓</span>
            </p>
          </div>
        )}

        <div className="space-y-3">
          <Link
            to="/"
            className="block w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Return Home
          </Link>

          <Link
            to="/products"
            className="block w-full bg-gray-100 text-gray-700 py-3 px-4 rounded-lg font-medium hover:bg-gray-200 transition-colors"
          >
            Continue Shopping
          </Link>
        </div>

        {sessionId && (
          <p className="mt-6 text-xs text-gray-400">Order reference: {sessionId.slice(0, 20)}...</p>
        )}
      </div>
    </div>
  );
}
