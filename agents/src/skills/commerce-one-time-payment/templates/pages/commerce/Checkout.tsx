import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { type CheckoutCustomer, formatPrice } from '../../../lib/commerce-client';
import { getCommerceProductBySkuId } from '../../../lib/commerce/products';
import { startOneTimeCommerceCheckout } from '../../../lib/commerce/payment-flow';

export default function CommerceCheckoutPage() {
  const { skuId } = useParams<{ skuId: string }>();
  const location = useLocation();
  const product = skuId ? getCommerceProductBySkuId(skuId) : undefined;
  // Contact info forwarded from a prior form (e.g. appointment booking).
  // Prefer location.state (set by navigate()), fall back to sessionStorage for
  // robustness against page refreshes or direct URL navigation.
  // Read+remove in a useState lazy initializer so it runs exactly once at mount
  // (avoids React StrictMode double-invoke dropping the value on the second render).
  const stateCustomer = (location.state as { customer?: CheckoutCustomer } | null)?.customer;
  const [storedCustomer] = useState<CheckoutCustomer | undefined>(() => {
    const raw = sessionStorage.getItem('commerce-checkout-customer');
    if (!raw) return undefined;
    sessionStorage.removeItem('commerce-checkout-customer');
    try {
      return JSON.parse(raw) as CheckoutCustomer;
    } catch {
      return undefined;
    }
  });
  const customer = stateCustomer ?? storedCustomer;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!skuId || !product) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Product not found</h1>
        <p className="mt-2 text-gray-600">Invalid SKU ID: {skuId ?? 'unknown'}</p>
        <Link to="/products" className="mt-6 inline-block underline">
          Back to products
        </Link>
      </div>
    );
  }

  const handleCheckout = async () => {
    setIsSubmitting(true);
    setError(null);
    // Clear any stale order ID from a previous/abandoned checkout attempt.
    sessionStorage.removeItem('commerce-order-id');

    const result = await startOneTimeCommerceCheckout({
      skuId: product.skuId,
      quantity: 1,
      ...(customer && { customer }),
    });

    if (result.success && result.checkoutUrl) {
      if (result.draftOrderId) {
        sessionStorage.setItem('commerce-order-id', result.draftOrderId);
      }
      window.location.href = result.checkoutUrl;
      return;
    }

    setError(result.error || 'Failed to create checkout session.');
    setIsSubmitting(false);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link to="/products" className="text-sm underline">
        Back to products
      </Link>

      <div className="mt-6 rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Checkout</h1>

        <div className="mt-6 space-y-3">
          <div>
            <div className="text-sm text-gray-500">Product</div>
            <div className="font-medium">{product.title}</div>
          </div>

          <div>
            <div className="text-sm text-gray-500">Amount</div>
            <div className="text-xl font-semibold">
              {formatPrice(product.price, product.currencyCode)}
            </div>
          </div>
        </div>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

        <button
          type="button"
          onClick={handleCheckout}
          disabled={isSubmitting}
          className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-black px-4 py-3 font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Creating checkout session...' : 'Continue to Payment'}
        </button>
      </div>
    </div>
  );
}
