/**
 * Service for decrementing coupon usage
 *
 * Handles business logic for reversing coupon usage during refunds/cancellations.
 * Safe to call even if usage is already zero.
 */

import { findCouponByCode, decrementCouponUsage } from "./repository";

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
 * Decrement coupon usage counter
 *
 * Decrements the usage counter when an order is cancelled or refunded.
 * Safe to call even if usage is zero (will not go negative).
 *
 * @param code - Coupon code
 * @throws {CouponNotFoundError} If coupon doesn't exist
 */
export async function decrementUsage(code: string): Promise<void> {
  // Verify coupon exists
  const coupon = await findCouponByCode(code);

  if (!coupon) {
    throw new CouponNotFoundError(code);
  }

  // Atomically decrement usage (never goes below 0)
  await decrementCouponUsage(code);
}
