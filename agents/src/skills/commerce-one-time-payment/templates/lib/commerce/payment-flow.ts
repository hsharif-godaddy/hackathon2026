import { createCheckoutSession, type CheckoutCustomer } from '../commerce-client';

/**
 * Store ID configuration
 *
 * Reads from VITE_GODADDY_STORE_ID environment variable (set by commerce skill setup).
 * Final fallback to code constant for manual configuration.
 */
const STORE_ID = 'REPLACE_WITH_STORE_ID';
export const CHANNEL_ID = 'REPLACE_WITH_CHANNEL_ID';

function getStoreId(): string {
  // Use import.meta.env for Vite browser bundle compatibility
  return import.meta.env.VITE_GODADDY_STORE_ID || STORE_ID;
}

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
  channelId?: string;
  customer?: CheckoutCustomer;
}) {
  const previewUrl = getPreviewUrl();
  const quantity = params.quantity ?? 1;
  const storeId = params.storeId ?? getStoreId();
  const channelId = params.channelId ?? (CHANNEL_ID !== 'REPLACE_WITH_CHANNEL_ID' ? CHANNEL_ID : undefined);

  if (!storeId || storeId === 'REPLACE_WITH_STORE_ID') {
    return {
      success: false,
      error: 'Store ID is not configured. Set VITE_GODADDY_STORE_ID environment variable via commerce skill setup.',
    };
  }

  // The POST route normalizes billing.email → shipping.email before calling
  // GoDaddy, because <Checkout /> reads contactEmail from order.shipping.email
  // and billing.email is not exposed in the session query response.
  return createCheckoutSession({
    storeId,
    ...(channelId && { channelId }),
    lineItems: [{ skuId: params.skuId, quantity }],
    returnUrl: `${previewUrl}/checkout/cancel`,
    successUrl: `${previewUrl}/checkout/success`,
    ...(params.customer && { customer: params.customer }),
  });
}
