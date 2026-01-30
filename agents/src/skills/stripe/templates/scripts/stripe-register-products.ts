#!/usr/bin/env npx tsx
/**
 * Stripe Product Registration Script
 *
 * Registers a single product with Stripe and returns priceId for checkout.
 * Runs in the app container with access to secrets.
 *
 * Usage:
 *   npx tsx scripts/stripe-register-products.ts '{"name":"T-Shirt","price":2999,"currency":"usd"}'
 *
 * Input (JSON object):
 *   { "name": "T-Shirt", "description": "Cool shirt", "price": 2999, "currency": "usd" }
 *   { "name": "Subscription", "price": 999, "currency": "usd", "recurring": { "interval": "month" } }
 *
 * Output (JSON):
 *   {
 *     "success": true,
 *     "product": { "productId": "prod_xxx", "priceId": "price_xxx", "name": "T-Shirt", ... }
 *   }
 */
import Stripe from 'stripe';
import { getSecret } from '#airo/secrets';

interface ProductInput {
  name: string;
  description?: string;
  price: number;
  currency?: string;
  recurring?: {
    interval: 'day' | 'week' | 'month' | 'year';
  };
}

async function main() {
  // Get product JSON from command line argument
  const productArg = process.argv[2];
  if (!productArg) {
    console.log(JSON.stringify({
      success: false,
      error: 'Usage: npx tsx scripts/stripe-register-products.ts \'{"name":"Product","price":2999,"currency":"usd"}\''
    }));
    process.exit(1);
  }

  let productInput: ProductInput;
  try {
    productInput = JSON.parse(productArg);
  } catch (e) {
    console.log(JSON.stringify({
      success: false,
      error: 'Invalid JSON: ' + (e instanceof Error ? e.message : String(e))
    }));
    process.exit(1);
  }

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
    // Create product
    const product = await stripe.products.create({
      name: productInput.name,
      description: productInput.description,
    });

    // Create price (convert based on currency)
    const currency = productInput.currency || 'usd';
    const zeroDecimalCurrencies = [
      'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
      'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'
    ];
    const unitAmount = zeroDecimalCurrencies.includes(currency.toLowerCase())
      ? productInput.price
      : productInput.price * 100;

    const priceParams: Stripe.PriceCreateParams = {
      product: product.id,
      unit_amount: unitAmount,
      currency: currency,
    };

    if (productInput.recurring) {
      priceParams.recurring = { interval: productInput.recurring.interval };
    }

    const price = await stripe.prices.create(priceParams);

    // Set default price
    await stripe.products.update(product.id, {
      default_price: price.id,
    });

    console.log(JSON.stringify({
      success: true,
      product: {
        productId: product.id,
        priceId: price.id,
        name: productInput.name,
        description: productInput.description,
        price: unitAmount,
        currency: productInput.currency || 'usd',
        recurring: productInput.recurring,
      }
    }));
  } catch (err) {
    console.log(JSON.stringify({
      success: false,
      error: 'Failed to create product: ' + (err instanceof Error ? err.message : String(err))
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

