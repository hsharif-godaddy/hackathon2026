/**
 * POST /api/coupons/:code/decrementUse
 *
 * Decrement the usage counter for a coupon.
 * Called when an order using a coupon is cancelled or refunded.
 *
 * URL parameters:
 * - code: string (required) - Coupon code (alphanumeric, will be uppercased)
 *
 * Response:
 * - 204 No Content on success
 * - 400 Bad Request for validation errors
 * - 404 Not Found if coupon doesn't exist
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  decrementUsage,
  CouponNotFoundError,
} from "../../../../services/coupons/decrement.service";

const usageParamsSchema = z.object({
  code: z
    .string()
    .min(1, "Coupon code is required")
    .max(50)
    .regex(/^[a-zA-Z0-9]+$/, "Code must contain only letters and numbers")
    .toUpperCase(),
});

export default async function POST(req: Request, res: Response, next: NextFunction) {
  try {
    // Validate params
    const params = usageParamsSchema.parse(req.params);

    // Decrement usage
    await decrementUsage(params.code);

    res.status(204).send();
  } catch (err) {
    // Zod validation errors
    if (err && typeof err === "object" && "issues" in err) {
      res.status(400).json({
        error: "Validation error",
        details: err.issues,
      });
      return;
    }

    // Coupon not found
    if (err instanceof CouponNotFoundError) {
      res.status(404).json({
        error: "Coupon not found",
        message: err.message,
      });
      return;
    }

    // Pass other errors to error handler middleware
    next(err);
  }
}
