/**
 * Register Product with Stripe
 *
 * Creates a product and price in Stripe. Fast, reliable, no shell scripts.
 * Use this API to register app products with Stripe one by one.
 *
 * Usage:
 *   POST /api/stripe/register-product
 *   Body: { name, description?, price, currency?, recurring? }
 *   Returns: { success, productId, priceId }
 *
 * Price handling:
 *   - Standard currencies (USD, EUR, INR, etc.): price in smallest unit (cents/paise)
 *   - Zero-decimal currencies (JPY, KRW, VND, etc.): price in base unit (no conversion)
 */
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { getSecret } from '#airo/secrets';

// Stripe zero-decimal currencies - no cents/smallest unit conversion needed
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

function isZeroDecimal(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase());
}

function getStripe(): Stripe {
  const secretKey = getSecret('STRIPE_SECRET_KEY');
  if (!secretKey || typeof secretKey !== 'string') {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  return new Stripe(secretKey);
}

interface RegisterProductRequest {
  name: string;
  description?: string;
  price: number; // Price in smallest unit (cents) OR base unit for zero-decimal currencies
  currency?: string;
  recurring?: {
    interval: 'day' | 'week' | 'month' | 'year';
  };
  image?: string;
}

export default async function handler(req: Request, res: Response) {
  try {
    const { name, description, price, currency = 'usd', recurring, image } =
      req.body as RegisterProductRequest;

    if (!name) {
      res.status(400).json({ success: false, error: 'Missing required field: name' });
      return;
    }

    if (typeof price !== 'number' || price <= 0) {
      res.status(400).json({ success: false, error: 'Invalid price: must be positive number' });
      return;
    }

    const stripe = getStripe();
    const normalizedCurrency = currency.toLowerCase();

    // Create product
    const product = await stripe.products.create({
      name,
      description: description || undefined,
      images: image ? [image] : undefined,
    });

    // Create price - Stripe expects integers
    // Zero-decimal currencies (JPY, KRW, etc.) use base unit, others use smallest unit (cents)
    const priceParams: Stripe.PriceCreateParams = {
      product: product.id,
      unit_amount: Math.round(price),
      currency: normalizedCurrency,
    };

    if (recurring) {
      priceParams.recurring = { interval: recurring.interval };
    }

    const stripePrice = await stripe.prices.create(priceParams);

    // Set as default price
    await stripe.products.update(product.id, {
      default_price: stripePrice.id,
    });

    res.json({
      success: true,
      productId: product.id,
      priceId: stripePrice.id,
      name: product.name,
      currency: normalizedCurrency,
      zeroDecimal: isZeroDecimal(normalizedCurrency),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (error instanceof Stripe.errors.StripeError) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
        code: error.code,
      });
      return;
    }

    res.status(500).json({ success: false, error: errorMessage });
  }
}

