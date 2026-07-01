/**
 * Service for incrementing coupon usage
 *
 * Handles business logic for tracking coupon usage during checkout.
 * Validates usage limits before incrementing.
 */

import { findCouponByCode, incrementCouponUsage } from "./repository";

/**
 * Custom error for coupon not found
 */
export class CouponNotFoundError extends Error {
  constructor(code: string) {
    super(`Coupon '${code}' not found`);
    this.name = "CouponNotFoundError";
  }
}

/**
 * Custom error for usage limit exceeded
 */
export class UsageLimitExceededError extends Error {
  constructor(code: string, limit: number) {
    super(`Coupon '${code}' has reached its usage limit of ${limit}`);
    this.name = "UsageLimitExceededError";
  }
}

/**
 * Increment coupon usage counter
 *
 * Validates that:
 * - Coupon exists
 * - Coupon has not exceeded usage limit (if limited)
 *
 * Then atomically increments the usage counter.
 *
 * @param code - Coupon code
 * @throws {CouponNotFoundError} If coupon doesn't exist
 * @throws {UsageLimitExceededError} If usage limit exceeded
 */
export async function incrementUsage(code: string): Promise<void> {
  // Fetch coupon to validate limits
  const coupon = await findCouponByCode(code);

  if (!coupon) {
    throw new CouponNotFoundError(code);
  }

  // Check usage limit if enabled
  if (coupon.limitUses && coupon.limit !== null) {
    const currentUsage = coupon.currentUsage ?? 0;
    if (currentUsage >= coupon.limit) {
      throw new UsageLimitExceededError(code, coupon.limit);
    }
  }

  // Atomically increment usage
  await incrementCouponUsage(code);
}
