'use client';
import { useState, useEffect } from 'react';
import { Cart as GoDaddyCart } from '@godaddy/react';

export function Cart({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const storeId = import.meta.env.VITE_GODADDY_STORE_ID;

  // Only mount GoDaddyCart after the user opens the cart at least once.
  // GoDaddyCart fetches the cart order on mount — if a stale order ID exists
  // in localStorage, this fetch fails with "Order not found". Deferring the
  // mount until the cart is actually opened avoids the premature fetch.
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const handleCheckout = async (orderId: string) => {
    try {
      setCheckoutError(null);
      const previewUrl =
        import.meta.env.VITE_PREVIEW_URL ||
        (typeof window !== 'undefined' ? window.location.origin : 'https://placeholder.godaddy.com');
      const response = await fetch('/api/commerce/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          draftOrderId: orderId,
          returnUrl: `${previewUrl}/checkout/success`,
          successUrl: `${previewUrl}/checkout/success`,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Checkout failed (${response.status})`);
      }
      const result = await response.json();
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Checkout failed';
      setCheckoutError(message);
      console.error('Checkout error:', err);
    }
  };

  if (!hasOpened) return null;

  return (
    <>
      <GoDaddyCart
        open={open}
        onOpenChange={onOpenChange}
        onCheckout={handleCheckout}
      />
      {checkoutError && (
        <div role="alert" className="fixed bottom-4 right-4 z-50 flex items-start gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-800 shadow-lg">
          <div>
            <p className="font-medium">Checkout error</p>
            <p>{checkoutError}</p>
          </div>
          <button type="button" onClick={() => setCheckoutError(null)} className="shrink-0 text-red-500 hover:text-red-700" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </>
  );
}
