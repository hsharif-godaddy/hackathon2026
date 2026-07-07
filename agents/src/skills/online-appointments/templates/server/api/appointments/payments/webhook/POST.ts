import type { Request, Response } from "express";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getSecret } from "#airo/secrets";
import { db } from "../../../../db/client";
import { booking, transaction } from "../../../../db/schema";

function getStripe(): Stripe {
  const secretKey = getSecret("STRIPE_SECRET_KEY");
  if (!secretKey || typeof secretKey !== "string") {
    throw new Error("STRIPE_SECRET_KEY not provisioned. Re-run Stripe setup or contact support.");
  }
  return new Stripe(secretKey);
}

export default async function handler(req: Request, res: Response) {
  let stripe: Stripe;
  let webhookSecret: string;

  try {
    stripe = getStripe();
  } catch (err) {
    console.error("[Stripe webhook] Failed to get Stripe instance:", err instanceof Error ? err.message : String(err));
    return res.status(500).json({ error: "Stripe is not configured" });
  }

  // STRIPE_WEBHOOK_SECRET is user-provided via requestSecrets (not auto-provisioned)
  const secret = getSecret("STRIPE_WEBHOOK_SECRET");
  if (!secret || typeof secret !== "string") {
    console.error("[Stripe webhook] STRIPE_WEBHOOK_SECRET not configured");
    return res.status(500).json({ error: "Stripe webhook secret is not configured" });
  }
  webhookSecret = secret;

  const sig = req.headers["stripe-signature"] as string;
  const { rawBody } = req as Request & { rawBody?: Buffer };

  if (!rawBody) {
    console.error("[Stripe webhook] rawBody missing — ensure express.json verify is set up");
    return res.status(400).json({ error: "Missing raw body" });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Signature verification failed";
    console.error("[Stripe webhook] constructEvent failed:", msg);
    return res.status(400).json({ error: msg });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const bookingId = session.metadata?.bookingId ?? null;

    if (!bookingId) {
      console.error("[Stripe webhook] checkout.session.completed — no bookingId in metadata", {
        sessionId: session.id,
      });
      return res.status(400).json({ error: "Missing bookingId in session metadata" });
    }

    // SECURITY: Validate the payment amount matches what we expect
    const [txn] = await db
      .select({ amount: transaction.amount, status: transaction.status })
      .from(transaction)
      .where(eq(transaction.sessionId, session.id))
      .limit(1);

    if (!txn) {
      console.error("[Stripe webhook] No transaction found for session", { sessionId: session.id });
      return res.status(400).json({ error: "Transaction not found" });
    }

    // Idempotency: skip if already processed
    if (txn.status === "succeeded") {
      console.log("[Stripe webhook] Session already processed", { sessionId: session.id });
      return res.status(200).json({ received: true, note: "Already processed" });
    }

    // Validate amount matches (session.amount_total is in cents)
    if (session.amount_total !== txn.amount) {
      console.error("[Stripe webhook] Amount mismatch", {
        sessionId: session.id,
        expected: txn.amount,
        actual: session.amount_total,
      });
      return res.status(400).json({ error: "Payment amount mismatch" });
    }

    const now = new Date();

    // Update transaction status (idempotent — safe to run multiple times)
    await db
      .update(transaction)
      .set({
        status: "succeeded",
        transactionId: session.payment_intent as string,
        updatedAt: now,
      })
      .where(eq(transaction.sessionId, session.id));

    // Always update booking to paid — idempotent, Stripe guarantees at-least-once delivery
    await db
      .update(booking)
      .set({
        status: "paid",
        paidDate: now,
        paidAmount: String(((session.amount_total ?? 0) / 100).toFixed(2)),
        currency: (session.currency ?? "usd").toUpperCase(),
        paymentTransactionId: session.payment_intent as string,
        updatedAt: now,
      })
      .where(eq(booking.id, bookingId));

    console.log("[Stripe webhook] Booking marked paid", { bookingId, sessionId: session.id });
  }

  if (event.type === "charge.succeeded") {
    const charge = event.data.object;

    // charge.succeeded fires before checkout.session.completed
    // We need to get the checkout session from the payment intent to find our transaction
    if (typeof charge.payment_intent === "string") {
      try {
        // Get the checkout session ID from the payment intent's metadata or description
        // Stripe checkout sessions link to payment intents automatically
        const sessions = await stripe.checkout.sessions.list({
          payment_intent: charge.payment_intent,
          limit: 1,
        });

        if (sessions.data.length > 0) {
          const sessionId = sessions.data[0].id;
          await db
            .update(transaction)
            .set({
              paymentMethod: charge.payment_method_details?.type ?? null,
              updatedAt: new Date(),
            })
            .where(eq(transaction.sessionId, sessionId));
        } else {
          console.warn("[Stripe webhook] charge.succeeded — no session found for payment_intent", {
            paymentIntent: charge.payment_intent,
          });
        }
      } catch (err) {
        console.error("[Stripe webhook] charge.succeeded — failed to retrieve session", {
          paymentIntent: charge.payment_intent,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object;

    await db
      .update(transaction)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(transaction.sessionId, session.id));
  }

  return res.status(200).json({ received: true });
}
