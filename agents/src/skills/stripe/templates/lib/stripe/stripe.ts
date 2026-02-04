/** TREAT AS IMMUTABLE - This file is protected by the file-edit tool
 *
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

// Browser-safe formatPrice moved to format.ts - import from there in frontend code
export { formatPrice } from './format.js';

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
  customerName: string | null;
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
    customerName: session.customer_details?.name || null,
    amountTotal: session.amount_total,
    currency: session.currency,
    paymentStatus: session.payment_status,
    subscription:
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id || null,
  };
}
