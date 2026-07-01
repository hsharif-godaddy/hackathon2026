/**
 * DELETE /api/coupons/:id
 *
 * Soft delete a coupon by ID.
 *
 * URL parameters:
 * - id: string (required) - Coupon ID (UUID)
 *
 * Response:
 * - 204 No Content on success
 * - 400 Bad Request for validation errors
 * - 404 Not Found if coupon doesn't exist or already deleted
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { deleteCoupon, CouponNotFoundError } from "../../../services/coupons/delete.service";

const deleteCouponParamsSchema = z.object({
  id: z.string().min(1, "Coupon ID is required"),
});

export default async function DELETE(req: Request, res: Response, next: NextFunction) {
  try {
    // Validate params
    const params = deleteCouponParamsSchema.parse(req.params);

    // Soft delete the coupon
    await deleteCoupon(params.id);

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
