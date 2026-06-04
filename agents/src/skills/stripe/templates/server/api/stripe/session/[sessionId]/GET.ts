/**
 * Stripe Session Details API
 *
 * Retrieves checkout session details for order confirmation.
 * Used by the success page to show order summary.
 *
 * Usage:
 *   GET /api/stripe/session/:sessionId
 *   Returns: { session: { customerName, amountTotal, currency, paymentStatus } }
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

export default async function handler(req: Request, res: Response) {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      res.status(400).json({
        success: false,
        error: 'Missing sessionId parameter',
      });
      return;
    }

    // Validate session ID format
    if (!sessionId.startsWith('cs_')) {
      res.status(400).json({
        success: false,
        error: 'Invalid session ID format',
      });
      return;
    }

    const stripe = getStripe();

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'subscription'],
    });

    res.json({
      success: true,
      session: {
        customerName: session.customer_details?.name,
        amountTotal: session.amount_total,
        currency: session.currency,
        paymentStatus: session.payment_status,
        status: session.status,
        mode: session.mode,
        lineItems: session.line_items?.data.map((item) => ({
          name: item.description,
          quantity: item.quantity,
          amount: item.amount_total,
        })),
      },
    });
  } catch (error) {
    // Log the real error server-side; return only generic, non-sensitive
    // strings to the client (never echo Stripe's verbatim message).
    console.error('get-session failed:', error);

    if (error instanceof Stripe.errors.StripeError) {
      if (error.code === 'resource_missing') {
        res.status(404).json({
          success: false,
          error: 'Session not found',
        });
        return;
      }

      res.status(error.statusCode || 500).json({
        success: false,
        error: 'Failed to retrieve session',
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve session',
    });
  }
}

