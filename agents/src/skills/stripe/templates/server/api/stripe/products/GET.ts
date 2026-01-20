/**
 * Stripe Products API
 *
 * Fetches active products from Stripe with their prices.
 * Used to display product catalog from existing Stripe products.
 *
 * Usage:
 *   GET /api/stripe/products
 *   Returns: { products: [...] }
 */
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { getSecret } from '#airo/secrets';

function getStripe(): Stripe {
  const secretKey = getSecret('STRIPE_SECRET_KEY');
  if (!secretKey || typeof secretKey !== 'string') {
    throw new Error('STRIPE_SECRET_KEY not configured. Please add it via the secrets panel.');
  }
  return new Stripe(secretKey);
}

interface ProductResponse {
  id: string;
  name: string;
  description: string | null;
  images: string[];
  priceId: string | null;
  amount: number;
  currency: string;
  recurring: {
    interval: Stripe.Price.Recurring.Interval;
    intervalCount: number;
  } | null;
}

export default async function handler(req: Request, res: Response) {
  try {
    const stripe = getStripe();

    // Get limit from query param (default: 50, max: 100)
    const limitParam = parseInt(req.query.limit as string) || 50;
    const limit = Math.min(Math.max(limitParam, 1), 100);

    // Fetch active products with their default prices expanded
    const stripeProducts = await stripe.products.list({
      active: true,
      expand: ['data.default_price'],
      limit,
    });

    const products: ProductResponse[] = stripeProducts.data.map((product) => {
      const defaultPrice = product.default_price as Stripe.Price | null;

      return {
        id: product.id,
        name: product.name,
        description: product.description,
        images: product.images,
        priceId: defaultPrice?.id || null,
        amount: defaultPrice?.unit_amount || 0,
        currency: defaultPrice?.currency || 'usd',
        recurring: defaultPrice?.recurring
          ? {
              interval: defaultPrice.recurring.interval,
              intervalCount: defaultPrice.recurring.interval_count,
            }
          : null,
      };
    });

    // Filter out products without prices (can't be purchased)
    const purchasableProducts = products.filter((p) => p.priceId !== null);

    res.json({
      success: true,
      products: purchasableProducts,
      count: purchasableProducts.length,
      hasMore: stripeProducts.has_more,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    if (error instanceof Stripe.errors.StripeError) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
        code: error.code,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
}

