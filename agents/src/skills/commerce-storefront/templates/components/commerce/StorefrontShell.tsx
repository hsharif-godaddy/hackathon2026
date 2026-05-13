import type { PropsWithChildren } from 'react';
import { createContext, useState } from 'react';
import { Cart } from '@godaddy/react';
import { createCheckoutSession } from '../../lib/commerce-client';
import { getCommercePreviewUrl, getStorefrontRuntimeConfig } from '../../lib/commerce/storefront-config';

export interface StorefrontCartContextValue {
  openCart: () => void;
  closeCart: () => void;
  isCheckingOut: boolean;
}

export const StorefrontCartContext = createContext<StorefrontCartContextValue | undefined>(undefined);

export function StorefrontShell({ children }: PropsWithChildren) {
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  const config = getStorefrontRuntimeConfig();

  const openCart = () => setIsCartOpen(true);
  const closeCart = () => setIsCartOpen(false);

  const handleCheckout = async (orderId: string) => {
    setIsCheckingOut(true);

    try {
      const previewUrl = getCommercePreviewUrl();

      const result = await createCheckoutSession({
        storeId: config.storeId,
        channelId: config.channelId,
        draftOrderId: orderId,
        returnUrl: `${previewUrl}/checkout/cancel`,
        successUrl: `${previewUrl}/checkout/success?orderId=${orderId}`,
      });

      if (result.success && result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }

      throw new Error(result.error || 'Failed to create checkout session');
    } catch (error) {
      setIsCheckingOut(false);
      throw error;
    }
  };

  return (
    <StorefrontCartContext.Provider value={{ openCart, closeCart, isCheckingOut }}>
      <div className="mx-auto max-w-6xl px-4 py-4">
        <button
          type="button"
          onClick={openCart}
          disabled={isCheckingOut}
          className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
        >
          {isCheckingOut ? 'Processing Checkout...' : 'Open Cart'}
        </button>
      </div>

      {children}

      <Cart
        open={isCartOpen}
        onOpenChange={setIsCartOpen}
        onCheckout={handleCheckout}
        isCheckingOut={isCheckingOut}
      />
    </StorefrontCartContext.Provider>
  );
}
