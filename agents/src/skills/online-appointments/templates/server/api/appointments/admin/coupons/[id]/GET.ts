/**
 * GET /api/coupons/:id
 *
 * Get a single coupon by ID with calculated state.
 *
 * URL parameters:
 * - id: string (required) - Coupon ID (UUID)
 *
 * Response:
 * - coupon: Coupon object with calculated state
 * - 200 OK on success
 * - 400 Bad Request for validation errors
 * - 404 Not Found if coupon doesn't exist
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getCoupon, CouponNotFoundError } from "../../../services/coupons/get.service";

const getCouponParamsSchema = z.object({
  id: z.string().min(1, "Coupon ID is required"),
});

export default async function GET(req: Request, res: Response, next: NextFunction) {
  try {
    // Validate params
    const params = getCouponParamsSchema.parse(req.params);

    // Fetch coupon
    const coupon = await getCoupon(params.id);

    res.status(200).json({ coupon });
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
