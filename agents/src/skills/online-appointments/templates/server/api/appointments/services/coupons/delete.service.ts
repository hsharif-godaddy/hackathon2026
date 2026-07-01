/**
 * Service for deleting coupons
 *
 * Handles soft deletion of coupons (sets deletedAt timestamp).
 * Preserves coupon data for historical records and auditing.
 */

import { softDeleteCoupon } from "./repository";

/**
 * Custom error for coupon not found
 */
export class CouponNotFoundError extends Error {
  constructor(id: string) {
    super(`Coupon with ID ${id} not found or already deleted`);
    this.name = "CouponNotFoundError";
  }
}

/**
 * Soft delete a coupon by ID
 *
 * Sets the deletedAt timestamp without removing the record from the database.
 * This preserves historical data for auditing and prevents issues with
 * foreign key references.
 *
 * @param id - Coupon ID
 * @throws {CouponNotFoundError} If coupon doesn't exist or already deleted
 */
export async function deleteCoupon(id: string): Promise<void> {
  const deleted = await softDeleteCoupon(id);

  if (!deleted) {
    throw new CouponNotFoundError(id);
  }
}
