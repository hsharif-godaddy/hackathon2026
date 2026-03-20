import { createCheckoutSession } from '../commerce-client';

/**
 * Replace with real store ID from Commerce onboarding/handoff context.
 */
export const STORE_ID = 'REPLACE_WITH_STORE_ID';

function getPreviewUrl(): string {
  if (import.meta.env.VITE_PREVIEW_URL) {
    return import.meta.env.VITE_PREVIEW_URL;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return 'https://placeholder.godaddy.com';
}

export async function startOneTimeCommerceCheckout(params: {
  skuId: string;
  quantity?: number;
  storeId?: string;
}) {
  const previewUrl = getPreviewUrl();
  const quantity = params.quantity ?? 1;
  const storeId = params.storeId ?? STORE_ID;

  if (!storeId || storeId === 'REPLACE_WITH_STORE_ID') {
    return {
      success: false,
      error: 'Store ID is not configured. Update STORE_ID in src/lib/commerce/payment-flow.ts',
    };
  }

  return createCheckoutSession({
    storeId,
    lineItems: [{ skuId: params.skuId, quantity }],
    returnUrl: `${previewUrl}/checkout/cancel`,
    successUrl: `${previewUrl}/checkout/success`,
  });
}
