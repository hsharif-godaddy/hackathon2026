import type { PropsWithChildren } from 'react';
import { createContext, useContext, useState } from 'react';
import { Cart } from '@godaddy/react';
import { createCheckoutSession } from '../../lib/commerce-client';
import { getCommercePreviewUrl, getStorefrontRuntimeConfig } from '../../lib/commerce/storefront-config';

interface StorefrontCartContextValue {
  openCart: () => void;
  closeCart: () => void;
  isCheckingOut: boolean;
}

const StorefrontCartContext = createContext<StorefrontCartContextValue | undefined>(undefined);

export function useStorefrontCart() {
  const context = useContext(StorefrontCartContext);

  if (!context) {
    throw new Error('useStorefrontCart must be used within StorefrontShell');
  }

  return context;
}

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
        draftOrderId: orderId,
        returnUrl: `${previewUrl}/checkout/cancel`,
        successUrl: `${previewUrl}/checkout/success`,
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
