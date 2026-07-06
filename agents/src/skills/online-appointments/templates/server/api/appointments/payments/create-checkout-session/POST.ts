import type { Request, Response } from "express";
import Stripe from "stripe";
import { z } from "zod";
import { uuidv7 } from "uuidv7";
import { eq } from "drizzle-orm";
import { db } from "../../../../db/client";
import { booking, service, transaction, bookingAddon } from "../../../../db/schema";
import { validateCoupon } from "../../services/coupons/validate.service";

const schema = z.object({
  bookingId: z.string().min(1),
  serviceId: z.string().min(1),
});

export default async function handler(req: Request, res: Response) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Validation failed", fields: parsed.error.flatten().fieldErrors });
  }

  const { bookingId, serviceId } = parsed.data;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ error: "Stripe is not configured" });
  }

  // SECURITY: Validate booking exists and its serviceId matches the requested serviceId
  // to prevent payment amount manipulation attacks
  const [bk] = await db
    .select({
      bookableType: booking.bookableType,
      bookableId: booking.bookableId,
      couponCode: booking.couponCode,
    })
    .from(booking)
    .where(eq(booking.id, bookingId))
    .limit(1);

  if (!bk) {
    return res.status(404).json({ error: "Booking not found" });
  }

  if (bk.bookableType !== "Service" || bk.bookableId !== serviceId) {
    return res.status(403).json({
      error: "Service ID mismatch",
      message: "The requested service does not match the booking",
    });
  }

  const [svc] = await db.select().from(service).where(eq(service.id, serviceId)).limit(1);
  if (!svc) {
    return res.status(404).json({ error: "Service not found" });
  }

  // Charge upfront when explicitly configured, or when paymentOption is unset but service has a cost
  const { paymentOption } = svc;
  const isOffline = paymentOption === "dont_charge_upfront";
  if (isOffline) {
    return res.json({ checkoutUrl: null });
  }

  // Only support full payment - deposit option not implemented
  const baseAmount = parseFloat(svc.salesPrice ?? svc.cost ?? "0");

  // Fetch addon prices from booking_addon table
  const addonRows = await db
    .select({ price: bookingAddon.price })
    .from(bookingAddon)
    .where(eq(bookingAddon.bookingId, bookingId));

  const addonsTotal = addonRows.reduce((sum: number, row: { price: string }) => {
    return sum + parseFloat(row.price);
  }, 0);

  const rawAmount = baseAmount + addonsTotal;

  // SECURITY: Validate coupon and calculate discount server-side
  // Never trust client-provided or stored discount amounts
  let discountCents = 0;
  if (bk.couponCode) {
    const rawAmountCents = Math.round(rawAmount * 100);
    const validation = await validateCoupon({
      couponCode: bk.couponCode,
      cartTotal: rawAmountCents,
      currency: "usd",
    });

    if (!validation.valid) {
      console.error("[Stripe checkout] Invalid coupon", {
        bookingId,
        couponCode: bk.couponCode,
        reason: validation.reason,
      });
      return res.status(400).json({
        error: "Invalid coupon",
        message: validation.reason ?? "Coupon is not valid",
      });
    }

    discountCents = validation.couponDiscount ?? 0;
  }

  const amountCents = Math.max(0, Math.round(rawAmount * 100) - discountCents);

  const base = `${req.protocol}://${req.get("host")}`;
  const successUrl = `${base}/book/payment-success?session_id={CHECKOUT_SESSION_ID}&booking_id=${bookingId}`;
  const cancelUrl = `${base}/book/payment-cancel?booking_id=${bookingId}`;

  const stripe = new Stripe(secretKey);

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: { name: svc.name ?? "Appointment" },
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { bookingId: String(bookingId) },
  };

  const session = await stripe.checkout.sessions.create(sessionParams);

  const now = new Date();

  try {
    // ATOMICITY: Wrap booking update + transaction insert in a single DB transaction
    // Prevents stranded bookings with paymentSessionId but no transaction record
    await db.transaction(async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
      // Update booking with session ID and validated discount amount
      await tx
        .update(booking)
        .set({
          paymentSessionId: session.id,
          discountAmount: String((discountCents / 100).toFixed(2)),
          updatedAt: now,
        })
        .where(eq(booking.id, bookingId));

      // Insert transaction record
      await tx.insert(transaction).values({
        id: uuidv7(),
        bookingId,
        provider: "stripe",
        type: "charge",
        status: "pending",
        amount: amountCents,
        currency: "usd",
        sessionId: session.id,
        createdAt: now,
        updatedAt: now,
      });
    });
  } catch (err) {
    // Database operation failed after creating Stripe session
    // Log the orphaned session for manual reconciliation
    console.error("[Stripe checkout] Database write failed after session creation", {
      sessionId: session.id,
      bookingId,
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({
      error: "Payment setup failed",
      message: "Unable to record payment session. Please contact support.",
    });
  }

  return res.json({ checkoutUrl: session.url });
}
