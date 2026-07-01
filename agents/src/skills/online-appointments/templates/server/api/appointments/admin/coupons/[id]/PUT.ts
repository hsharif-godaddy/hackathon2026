/**
 * PUT /api/coupons/:id
 *
 * Update a coupon by ID (limited fields only).
 *
 * URL parameters:
 * - id: string (required) - Coupon ID (UUID)
 *
 * Request body (all optional):
 * - endDate: string (ISO 8601) - Can only be extended
 * - limit: number - Can only be increased
 * - isActive: boolean - Toggle active state
 *
 * Business rules:
 * - Cannot update expired coupons
 * - endDate can only be extended, not reduced
 * - limit can only be increased, not decreased
 * - Cannot activate an expired coupon
 *
 * Response:
 * - coupon: Updated coupon object
 * - 200 OK on success
 * - 400 Bad Request for validation or business rule errors
 * - 404 Not Found if coupon doesn't exist
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  updateCoupon,
  CouponNotFoundError,
  InvalidUpdateError,
} from "../../../services/coupons/update.service";

const updateCouponParamsSchema = z.object({
  id: z.string().min(1, "Coupon ID is required"),
});

const updateCouponBodySchema = z.object({
  endDate: z.coerce.date().optional(),

  limit: z
    .number()
    .int("Limit must be a whole number")
    .positive("Limit must be greater than 0")
    .optional(),

  isActive: z.boolean().optional(),
});

export default async function PUT(req: Request, res: Response, next: NextFunction) {
  try {
    // Validate params and body
    const params = updateCouponParamsSchema.parse(req.params);
    const body = updateCouponBodySchema.parse(req.body);

    // Update coupon
    const coupon = await updateCoupon(params.id, body);

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

    // Business rule violations
    if (err instanceof InvalidUpdateError) {
      res.status(400).json({
        error: "Invalid update",
        message: err.message,
      });
      return;
    }

    // Pass other errors to error handler middleware
    next(err);
  }
}
