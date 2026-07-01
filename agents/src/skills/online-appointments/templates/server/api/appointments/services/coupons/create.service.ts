/**
 * Service for creating coupons
 *
 * Handles business logic for coupon creation including:
 * - Maximum coupon count validation
 * - Code uniqueness validation
 * - Data normalization
 * - Database insertion
 */

import { findCouponByCode, insertCoupon, countCoupons } from "./repository";
import type { Coupon } from "../../../../db/schema";

/**
 * Input type for creating a coupon
 */
export type CreateCouponInput = {
  code: string;
  type: "PERCENTAGE" | "FIXED";
  minimumCartValue: number;
  discountPercentage?: number;
  discountPrice?: number;
  startDate: Date;
  endDate: Date;
  limitUses: boolean;
  limit?: number;
  isActive: boolean;
};

/**
 * Maximum number of coupons allowed per account
 */
const MAX_COUPON_COUNT = 20;

/**
 * Custom error for duplicate coupon codes
 */
export class DuplicateCouponError extends Error {
  constructor(code: string) {
    super(`Coupon code '${code}' already exists`);
    this.name = "DuplicateCouponError";
  }
}

/**
 * Custom error for exceeding maximum coupon count
 */
export class MaxCouponCountError extends Error {
  constructor(max: number) {
    super(`Maximum number of coupons (${max}) reached`);
    this.name = "MaxCouponCountError";
  }
}

/**
 * Create a new coupon
 *
 * Validates that:
 * - Maximum coupon count hasn't been exceeded
 * - Coupon code is unique
 * Then inserts the coupon into the database.
 *
 * @param input - Coupon data from request
 * @returns The created coupon
 * @throws {MaxCouponCountError} If maximum coupon count has been reached
 * @throws {DuplicateCouponError} If code already exists
 */
export async function createCoupon(input: CreateCouponInput): Promise<Coupon> {
  // Check if maximum coupon count has been reached
  const count = await countCoupons({
    deletedAt: null,
  });

  if (count >= MAX_COUPON_COUNT) {
    throw new MaxCouponCountError(MAX_COUPON_COUNT);
  }

  // Check if coupon code already exists
  const existing = await findCouponByCode(input.code);

  if (existing) {
    throw new DuplicateCouponError(input.code);
  }

  // Insert the coupon
  const coupon = await insertCoupon({
    code: input.code,
    type: input.type,
    minimumCartValue: input.minimumCartValue,
    discountPrice: input.discountPrice,
    discountPercentage: input.discountPercentage,
    startDate: input.startDate,
    endDate: input.endDate,
    limitUses: input.limitUses,
    limit: input.limit ?? undefined,
    isActive: input.isActive,
  });

  return coupon;
}
