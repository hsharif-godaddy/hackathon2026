const FUNNEL_SESSION_KEY = 'airo-funnel-session-id';
const CHECKOUT_SNAPSHOT_KEY = 'stripe-checkout-snapshot';

export interface CheckoutSnapshot {
  checkout_source: string;
  currency: string;
  line_count: number;
  quantity_total: number;
  amount_total: number;
  amount_total_display: string;
  line_items_json: string;
  funnel_session_id: string;
  stripe_mode?: 'test' | 'live';
}

/**
 * Derives whether a Stripe session is test or live from its ID prefix.
 * cs_test_* = sandbox/test mode, cs_live_* = real payments.
 * Used to filter out test purchases from revenue metrics.
 */
export function getStripeMode(sessionId: string): 'test' | 'live' {
  return sessionId.startsWith('cs_test_') ? 'test' : 'live';
}

/**
 * Returns the existing funnel session ID for this shopping attempt,
 * or creates and persists a new one if none exists.
 * The ID is shared across all events in a single checkout funnel.
 */
export function getFunnelSessionId(): string {
  if (typeof window === 'undefined') return '';
  const existing = sessionStorage.getItem(FUNNEL_SESSION_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(FUNNEL_SESSION_KEY, id);
  return id;
}

/**
 * Saves the cart snapshot before redirecting to Stripe.
 * Used by cancel and success pages to read back the cart state after the redirect.
 */
export function saveCheckoutSnapshot(snapshot: CheckoutSnapshot): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(CHECKOUT_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

/**
 * Reads the saved checkout snapshot. Returns null if no snapshot exists
 * (e.g. user navigated directly to the success/cancel URL).
 */
export function getCheckoutSnapshot(): CheckoutSnapshot | null {
  if (typeof window === 'undefined') return null;
  const saved = sessionStorage.getItem(CHECKOUT_SNAPSHOT_KEY);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as CheckoutSnapshot;
  } catch {
    return null;
  }
}

/**
 * Clears funnel session ID and checkout snapshot after a verified purchase.
 * Must be called after firing purchase_verified, not before.
 */
export function clearFunnelSession(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(FUNNEL_SESSION_KEY);
  sessionStorage.removeItem(CHECKOUT_SNAPSHOT_KEY);
}
