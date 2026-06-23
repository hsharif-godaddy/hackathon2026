/**
 * Tracked Stripe checkout
 *
 * Single source of truth for the checkout-intent funnel. Builds the funnel
 * payload, fires checkout_begin → checkout_redirect / checkout_error, saves
 * the snapshot for the cancel/success pages, and redirects to Stripe.
 *
 * Used by Products.tsx (buy-now), cart.tsx (cart checkout), and any page
 * enhanced via the stripe skill's "Option B" flow — so every checkout path
 * emits identical events without re-implementing them.
 *
 * On success the browser navigates away. On failure it returns
 * { success: false, error } so the caller can reset its own spinner and
 * show the message; it does not own any UI itself.
 */
import { formatPrice } from '@/lib/stripe/format';

import { getFunnelSessionId, getStripeMode, saveCheckoutSnapshot } from './funnel-session';
import { track } from './track';

export interface CheckoutItem {
  productId: string;
  name: string;
  priceId: string;
  amount: number;
  currency: string;
  quantity: number;
}

export type CheckoutSource = 'cart' | 'products_buy_now';

export interface CheckoutResult {
  success: boolean;
  error?: string;
}

export async function startTrackedCheckout(
  source: CheckoutSource,
  items: CheckoutItem[],
): Promise<CheckoutResult> {
  if (items.length === 0) return { success: false, error: 'Cart is empty' };

  const funnelSessionId = getFunnelSessionId();
  const currency = items[0].currency;
  const amountTotal = items.reduce((sum, i) => sum + i.amount * i.quantity, 0);
  const quantityTotal = items.reduce((sum, i) => sum + i.quantity, 0);
  const amountTotalDisplay = formatPrice(amountTotal, currency);
  const lineItemsJson = JSON.stringify(items.map((i) => ({
    product_id: i.productId,
    name: i.name,
    price_id: i.priceId,
    quantity: i.quantity,
    unit_price_display: formatPrice(i.amount, i.currency),
    line_total_display: formatPrice(i.amount * i.quantity, i.currency),
  })));
  const checkoutProps = {
    checkout_source: source,
    page_path: window.location.pathname,
    currency,
    line_count: items.length,
    quantity_total: quantityTotal,
    amount_total: amountTotal,
    amount_total_display: amountTotalDisplay,
    line_items_json: lineItemsJson,
    funnel_session_id: funnelSessionId,
  };

  track('airo.website.stripe.checkout_begin', 'action', 'checkout_begin', checkoutProps);

  try {
    const response = await fetch('/api/stripe/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lineItems: items.map((i) => ({ priceId: i.priceId, quantity: i.quantity })),
      }),
    });

    if (!response.ok) {
      track('airo.website.stripe.checkout_error', 'action', 'checkout_error', {
        ...checkoutProps,
        error: `http_${response.status}`,
      });
      return { success: false, error: 'Failed to create checkout session' };
    }

    const data = await response.json();

    if (data.success && data.url) {
      const stripeMode = getStripeMode(data.sessionId ?? '');
      saveCheckoutSnapshot({
        checkout_source: source,
        currency,
        line_count: items.length,
        quantity_total: quantityTotal,
        amount_total: amountTotal,
        amount_total_display: amountTotalDisplay,
        line_items_json: lineItemsJson,
        funnel_session_id: funnelSessionId,
        stripe_mode: stripeMode,
      });
      track('airo.website.stripe.checkout_redirect', 'action', 'checkout_redirect', {
        ...checkoutProps,
        stripe_mode: stripeMode,
      });
      window.location.href = data.url;
      return { success: true };
    }

    track('airo.website.stripe.checkout_error', 'action', 'checkout_error', {
      ...checkoutProps,
      error: data.error || 'session_create_failed',
    });
    return { success: false, error: data.error || 'Failed to create checkout session' };
  } catch (e) {
    console.error('checkout failed', e);
    track('airo.website.stripe.checkout_error', 'action', 'checkout_error', {
      ...checkoutProps,
      error: 'network_or_parse',
    });
    return { success: false, error: 'Failed to create checkout session' };
  }
}
