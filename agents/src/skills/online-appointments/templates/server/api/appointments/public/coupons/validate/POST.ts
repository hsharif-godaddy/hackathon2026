/**
 * POST /api/appointments/public/coupons/validate
 *
 * Validates a coupon code and returns discount information if valid.
 * Public endpoint - no authentication required (used during checkout).
 *
 * Request body:
 * - couponCode: string (alphanumeric, uppercase)
 * - cartTotal: number (in cents)
 * - currency: string (3 characters, e.g., "USD")
 *
 * Response:
 * - valid: boolean
 * - couponDiscount?: number (in cents, if valid)
 * - reason?: string (if invalid)
 * - code?: string (error code if invalid)
 * - eligible_amount?: number (minimum cart value in cents if below threshold)
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { validateCoupon } from "../../../services/coupons/validate.service";
import { isFeatureEnabled } from "../../../../../../lib/features";

const validateCouponSchema = z.object({
  couponCode: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9]+$/, "Coupon code must contain only letters and numbers")
    .max(50, "Coupon code must be at most 50 characters")
    .toUpperCase(),
  cartTotal: z.number().int().positive("Cart total must be a positive integer"),
  currency: z.string().max(3, "Currency must be 3 characters or less").optional().default("USD"),
});

export default async function POST(req: Request, res: Response, next: NextFunction) {
  try {
    // Check if coupon feature is enabled
    if (!isFeatureEnabled("customer.booking_flow.coupons")) {
      return res.status(403).json({ error: "Feature disabled" });
    }

    // Validate request body
    const payload = validateCouponSchema.parse(req.body);

    // Validate coupon
    const result = await validateCoupon(payload);

    res.status(200).json(result);
  } catch (err) {
    // Zod validation errors
    if (err && typeof err === "object" && "issues" in err) {
      res.status(400).json({
        error: "Validation error",
        details: err.issues,
      });
      return;
    }

    // Pass other errors to error handler middleware
    return next(err);
  }
}
