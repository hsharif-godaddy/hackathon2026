/**
 * GET /api/coupons
 *
 * List all coupons with optional filtering.
 *
 * Query parameters:
 * - code: string (optional) - Filter by coupon code
 * - type: "PERCENTAGE" | "FIXED" (optional) - Filter by discount type
 * - isActive: "true" | "false" (optional) - Filter by active status
 *
 * Response:
 * - coupons: Array of coupons with calculated state
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getCoupons } from "../../services/coupons/list.service";

const listCouponsQuerySchema = z.object({
  code: z
    .string()
    .regex(/^[a-zA-Z0-9]+$/, "Code must contain only letters and numbers")
    .max(50)
    .toUpperCase()
    .optional(),

  type: z.enum(["PERCENTAGE", "FIXED"]).optional(),

  isActive: z
    .enum(["true", "false"])
    .transform((val) => val === "true")
    .optional(),
});

export default async function GET(req: Request, res: Response, next: NextFunction) {
  try {
    // Validate query parameters
    const query = listCouponsQuerySchema.parse(req.query);

    // Fetch coupons
    const coupons = await getCoupons(query);

    res.status(200).json({ coupons });
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
    next(err);
  }
}
