/**
 * Stripe Utility Functions
 *
 * Helper functions for common Stripe operations.
 * All data is stored in Stripe - no local database required.
 */
import Stripe from 'stripe';
import { getSecret } from '#airo/secrets';

let stripeInstance: Stripe | null = null;

/**
 * Get configured Stripe instance (singleton)
 */
export function getStripe(): Stripe {
  if (!stripeInstance) {
    const secretKey = getSecret('STRIPE_SECRET_KEY');
    if (!secretKey || typeof secretKey !== 'string') {
      throw new Error('STRIPE_SECRET_KEY not configured. Please add it via the secrets panel.');
    }
    stripeInstance = new Stripe(secretKey);
  }
  return stripeInstance;
}

/**
 * Get publishable key for client-side use
 */
export function getPublishableKey(): string {
  const key = getSecret('STRIPE_PUBLISHABLE_KEY');
  if (!key || typeof key !== 'string') {
    throw new Error('STRIPE_PUBLISHABLE_KEY not configured.');
  }
  return key;
}

// Browser-safe formatPrice moved to format.ts - import from there in frontend code
export { formatPrice } from './format';

/**
 * Create a new product with price in Stripe
 * Use this when registering app products with Stripe
 */
export async function createProduct(params: {
  name: string;
  description?: string;
  images?: string[];
  priceInCents: number;
  currency?: string;
  recurring?: {
    interval: 'day' | 'week' | 'month' | 'year';
    intervalCount?: number;
  };
}): Promise<{ product: Stripe.Product; price: Stripe.Price }> {
  const stripe = getStripe();

  // Create the product
  const product = await stripe.products.create({
    name: params.name,
    description: params.description,
    images: params.images,
  });

  // Create the price
  const priceParams: Stripe.PriceCreateParams = {
    product: product.id,
    unit_amount: params.priceInCents,
    currency: params.currency || 'usd',
  };

  if (params.recurring) {
    priceParams.recurring = {
      interval: params.recurring.interval,
      interval_count: params.recurring.intervalCount || 1,
    };
  }

  const price = await stripe.prices.create(priceParams);

  // Set as default price
  await stripe.products.update(product.id, {
    default_price: price.id,
  });

  return { product, price };
}

/**
 * Get all active products with prices
 */
export async function listProducts(): Promise<
  Array<{
    id: string;
    name: string;
    description: string | null;
    images: string[];
    priceId: string;
    amount: number;
    currency: string;
    recurring: Stripe.Price.Recurring | null;
  }>
> {
  const stripe = getStripe();

  const products = await stripe.products.list({
    active: true,
    expand: ['data.default_price'],
    limit: 100,
  });

  return products.data
    .filter((p) => p.default_price)
    .map((product) => {
      const price = product.default_price as Stripe.Price;
      return {
        id: product.id,
        name: product.name,
        description: product.description,
        images: product.images,
        priceId: price.id,
        amount: price.unit_amount || 0,
        currency: price.currency,
        recurring: price.recurring,
      };
    });
}

/**
 * Get checkout session details (for success page)
 */
export async function getSessionDetails(sessionId: string): Promise<{
  customerEmail: string | null;
  amountTotal: number | null;
  currency: string | null;
  paymentStatus: string;
  subscription: string | null;
}> {
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['subscription'],
  });

  return {
    customerEmail: session.customer_details?.email || null,
    amountTotal: session.amount_total,
    currency: session.currency,
    paymentStatus: session.payment_status,
    subscription:
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id || null,
  };
}

// /**
//  * Check if a customer has an active subscription
//  * Use email to look up customer (works for guest checkout)
//  *
//  * COMMENTED OUT: Not currently used. Uncomment when needed for subscription checks.
//  */
// export async function hasActiveSubscription(customerEmail: string): Promise<boolean> {
//   const stripe = getStripe();
//
//   // Find customer by email
//   const customers = await stripe.customers.list({
//     email: customerEmail,
//     limit: 1,
//   });
//
//   if (customers.data.length === 0) {
//     return false;
//   }
//
//   // Check for active subscriptions
//   const subscriptions = await stripe.subscriptions.list({
//     customer: customers.data[0].id,
//     status: 'active',
//     limit: 1,
//   });
//
//   return subscriptions.data.length > 0;
// }

// /**
//  * Get order history for a customer by email
//  * Useful for "My Orders" page
//  *
//  * Uses efficient customer lookup first, then fetches their payment intents
//  *
//  * COMMENTED OUT: Not currently used. Uncomment when needed for order history page.
//  */
// export async function getOrderHistory(
//   customerEmail: string
// ): Promise<
//   Array<{
//     id: string;
//     amount: number;
//     currency: string;
//     status: string;
//     created: Date;
//     items: Array<{ name: string; quantity: number }>;
//   }>
// > {
//   const stripe = getStripe();
//
//   // First, find customer by email (efficient lookup)
//   const customers = await stripe.customers.list({
//     email: customerEmail,
//     limit: 1,
//   });
//
//   if (customers.data.length === 0) {
//     return []; // No customer found with this email
//   }
//
//   const customerId = customers.data[0].id;
//
//   // Get checkout sessions for this specific customer
//   const sessions = await stripe.checkout.sessions.list({
//     customer: customerId,
//     limit: 100,
//     expand: ['data.line_items'],
//   });
//
//   // Filter to completed payments only
//   const completedSessions = sessions.data.filter(
//     (s) => s.payment_status === 'paid' || s.status === 'complete'
//   );
//
//   return completedSessions.map((session) => ({
//     id: session.id,
//     amount: session.amount_total || 0,
//     currency: session.currency || 'usd',
//     status: session.payment_status,
//     created: new Date(session.created * 1000),
//     items:
//       session.line_items?.data.map((item) => ({
//         name: item.description || 'Unknown item',
//         quantity: item.quantity || 1,
//       })) || [],
//   }));
// }

