#!/usr/bin/env npx tsx
/**
 * Stripe List Products Script
 *
 * Fetches existing products from Stripe account.
 * Runs in the app container with access to secrets.
 *
 * Usage:
 *   npx tsx scripts/stripe-list-products.ts
 *
 * Output (JSON):
 *   {
 *     "success": true,
 *     "products": [
 *       { "productId": "prod_xxx", "priceId": "price_xxx", "name": "T-Shirt", ... }
 *     ]
 *   }
 */
import Stripe from 'stripe';
import { getSecret } from '#airo/secrets';

async function main() {
  // Get Stripe secret key using the secrets library
  const secretKey = getSecret('STRIPE_SECRET_KEY');
  if (!secretKey || typeof secretKey !== 'string') {
    console.log(JSON.stringify({
      success: false,
      error: 'STRIPE_SECRET_KEY not configured. Add it via Settings → Secrets first.'
    }));
    process.exit(1);
  }

  const stripe = new Stripe(secretKey);

  try {
    const products = await stripe.products.list({
      active: true,
      expand: ['data.default_price'],
      limit: 100,
    });

    const results = products.data
      .filter(p => p.default_price)
      .map(product => {
        const price = product.default_price as Stripe.Price;
        const unitAmount = price.unit_amount || 0;
        const currency = price.currency;

        return {
          productId: product.id,
          priceId: price.id,
          name: product.name,
          description: product.description || undefined,
          price: unitAmount,
          currency: currency,
          recurring: price.recurring
            ? { interval: price.recurring.interval }
            : undefined,
        };
      });

    if (results.length === 0) {
      console.log(JSON.stringify({
        success: false,
        error: 'No active products found in Stripe. Create products in Stripe Dashboard first.'
      }));
      process.exit(0);
    }

    console.log(JSON.stringify({
      success: true,
      products: results,
      message: `Found ${results.length} product(s) in Stripe.`
    }));
  } catch (err) {
    console.log(JSON.stringify({
      success: false,
      error: 'Failed to fetch products: ' + (err instanceof Error ? err.message : String(err))
    }));
    process.exit(1);
  }
}

main().catch(err => {
  console.log(JSON.stringify({
    success: false,
    error: err instanceof Error ? err.message : String(err)
  }));
  process.exit(1);
});

