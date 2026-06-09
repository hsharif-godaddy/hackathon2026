import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

export default function CommerceCheckoutSuccessPage() {
  const [searchParams] = useSearchParams();
  const [orderId, setOrderId] = useState<string | null>(() => searchParams.get('orderId'));

  useEffect(() => {
    // URL ?orderId= takes precedence — don't let a stale sessionStorage value
    // overwrite it (e.g. cross-tab case where one tab already has the param).
    if (searchParams.get('orderId')) return;
    const stored = sessionStorage.getItem('commerce-order-id');
    if (stored) {
      setOrderId(stored);
      sessionStorage.removeItem('commerce-order-id');
      const url = new URL(window.location.href);
      url.searchParams.set('orderId', stored);
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <div className="rounded-xl border bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold">Payment Successful</h1>
        <p className="mt-3 text-gray-600">
          Thank you for your purchase. Your checkout has been completed successfully.
        </p>
        {orderId && (
          <p className="mt-2 text-sm text-gray-500">Order ID: {orderId}</p>
        )}

        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            to="/products"
            className="inline-flex items-center justify-center rounded-lg bg-black px-5 py-2 text-white hover:bg-gray-800"
          >
            Continue Shopping
          </Link>
          <Link to="/" className="underline">
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}
