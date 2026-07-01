/**
 * POST /api/coupons
 *
 * Create a new coupon.
 *
 * Request body:
 * - code: string (required) - Coupon code (alphanumeric, will be uppercased)
 * - type: "PERCENTAGE" | "FIXED" (required) - Discount type
 * - minimumCartValue: number (optional, default 0) - Minimum cart value in cents
 * - discountPercentage: number (required for PERCENTAGE) - Discount percentage (1-100)
 * - discountPrice: number (required for FIXED) - Discount amount in cents
 * - startDate: string (required) - Start date (ISO 8601)
 * - endDate: string (required) - End date (ISO 8601)
 * - limitUses: boolean (optional, default false) - Whether to limit usage
 * - limit: number (required if limitUses=true) - Maximum number of uses
 * - isActive: boolean (optional, default true) - Whether coupon is active
 *
 * Response:
 * - coupon: Created coupon object
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { createCoupon, DuplicateCouponError } from "../../services/coupons/create.service";

const CouponTypeEnum = z.enum(["PERCENTAGE", "FIXED"]);

const createCouponSchema = z
  .object({
    code: z
      .string()
      .min(1, "Coupon code is required")
      .max(50, "Code cannot exceed 50 characters")
      .regex(/^[a-zA-Z0-9]+$/, "Code must contain only letters and numbers")
      .toUpperCase(),

    type: CouponTypeEnum,

    minimumCartValue: z
      .number()
      .int("Minimum cart value must be in cents (integer)")
      .nonnegative("Minimum cart value cannot be negative")
      .default(0),

    discountPercentage: z
      .number()
      .int("Discount percentage must be a whole number")
      .min(1, "Discount percentage must be at least 1")
      .max(100, "Discount percentage cannot exceed 100")
      .optional(),

    discountPrice: z
      .number()
      .int("Discount price must be in cents (integer)")
      .positive("Discount price must be greater than 0")
      .optional(),

    startDate: z.coerce.date(),
    endDate: z.coerce.date(),

    limitUses: z.boolean().default(false),

    limit: z
      .number()
      .int("Limit must be a whole number")
      .positive("Limit must be greater than 0")
      .optional(),

    isActive: z.boolean().default(true),
  })
  .refine(
    (data) => {
      if (data.type === "PERCENTAGE") {
        return data.discountPercentage !== undefined;
      }
      return true;
    },
    {
      message: "discountPercentage is required when type is PERCENTAGE",
      path: ["discountPercentage"],
    },
  )
  .refine(
    (data) => {
      if (data.type === "FIXED") {
        return data.discountPrice !== undefined;
      }
      return true;
    },
    {
      message: "discountPrice is required when type is FIXED",
      path: ["discountPrice"],
    },
  )
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be on or after start date",
    path: ["endDate"],
  })
  .refine(
    (data) => {
      if (data.limitUses) {
        return data.limit !== undefined && data.limit > 0;
      }
      return true;
    },
    {
      message: "limit is required and must be greater than 0 when limitUses is true",
      path: ["limit"],
    },
  );

export default async function POST(req: Request, res: Response, next: NextFunction) {
  try {
    // Validate request body
    const data = createCouponSchema.parse(req.body);

    // Create coupon
    const coupon = await createCoupon(data);

    res.status(201).json({ coupon });
  } catch (err) {
    // Zod validation errors
    if (err && typeof err === "object" && "issues" in err) {
      res.status(400).json({
        error: "Validation error",
        details: err.issues,
      });
      return;
    }

    // Duplicate coupon code
    if (err instanceof DuplicateCouponError) {
      res.status(409).json({
        error: "Duplicate coupon code",
        message: err.message,
      });
      return;
    }

    // Pass other errors to error handler middleware
    next(err);
  }
}
