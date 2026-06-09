/**
 * Stripe Checkout Session API
 *
 * Creates a Stripe Checkout session for one-time payments or subscriptions.
 * Automatically determines mode based on price type (recurring vs one-time).
 *
 * Security: Redirect URLs are derived from request origin - NOT accepted from frontend.
 *
 * Usage:
 *   POST /api/stripe/create-checkout-session
 *   Body: { priceId, quantity? } or { lineItems }
 */
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { getSecret } from '#airo/secrets';

function getStripe(): Stripe {
  const secretKey = getSecret('STRIPE_SECRET_KEY');
  if (!secretKey || typeof secretKey !== 'string') {
    throw new Error('STRIPE_SECRET_KEY not provisioned. Re-run Stripe setup or contact support.');
  }
  return new Stripe(secretKey);
}

interface LineItem {
  priceId: string;
  quantity: number;
}

interface CreateCheckoutSessionRequest {
  priceId?: string; // For single item checkout
  lineItems?: LineItem[]; // For cart checkout
  quantity?: number;
  // Note: successUrl/cancelUrl NOT accepted - derived from request origin (security)
}

export default async function handler(req: Request, res: Response) {
  try {
    const {
      priceId,
      lineItems,
      quantity = 1,
    } = req.body as CreateCheckoutSessionRequest;

    if (!priceId && (!lineItems || lineItems.length === 0)) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: priceId or lineItems',
      });
      return;
    }

    // Derive redirect URLs from request origin (security - not from frontend body)
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const successUrl = `${origin}/checkout/success`;
    const cancelUrl = `${origin}/checkout/cancel`;

    const stripe = getStripe();
    let sessionLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    let mode: Stripe.Checkout.SessionCreateParams.Mode = 'payment'; // Default

    // Handle cart checkout (multiple items)
    if (lineItems && lineItems.length > 0) {
      // Fetch all prices to check for mixed modes
      const prices = await Promise.all(
        lineItems.map(async (item) => ({
          ...item,
          price: await stripe.prices.retrieve(item.priceId),
        }))
      );

      // Check for mixed payment modes (Stripe doesn't support this)
      const hasRecurring = prices.some((p) => p.price.recurring);
      const hasOneTime = prices.some((p) => !p.price.recurring);

      if (hasRecurring && hasOneTime) {
        res.status(400).json({
          success: false,
          error: 'Cannot mix subscription and one-time items in the same cart. Please checkout separately.',
        });
        return;
      }

      mode = hasRecurring ? 'subscription' : 'payment';
      sessionLineItems = prices.map((p) => ({ price: p.priceId, quantity: p.quantity }));
    }
    // Handle single item checkout
    else if (priceId) {
      const price = await stripe.prices.retrieve(priceId);
      mode = price.recurring ? 'subscription' : 'payment';
      sessionLineItems = [{ price: priceId, quantity }];
    }

    // Build session parameters
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      line_items: sessionLineItems,
      mode,
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      billing_address_collection: 'required', // Always collect billing address
      phone_number_collection: { enabled: true }, // Always collect phone number
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    res.json({
      success: true,
      url: session.url,
      sessionId: session.id,
      mode,
    });
  } catch (error) {
    // Log the real error server-side for debugging; never echo internal detail
    // (missing-key messages, Stripe account state) back to the shopper, who
    // sees this string rendered as the checkout error.
    console.error('create-checkout-session failed:', error);

    if (error instanceof Stripe.errors.StripeError) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: 'Unable to start checkout. Please try again or contact support.',
        code: error.code,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Unable to start checkout. Please try again or contact support.',
    });
  }
}

