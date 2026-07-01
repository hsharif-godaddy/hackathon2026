/**
 * Service for updating coupons
 *
 * Handles business logic for updating coupons with restrictions:
 * - endDate can only be extended, not reduced
 * - limit can only be increased, not decreased
 * - Cannot update expired coupons
 * - Cannot activate an expired coupon
 */

import { findCouponById } from "./repository";
import type { Coupon } from "../../../../db/schema";

/**
 * Request body for updating a coupon
 */
export type UpdateCouponBody = {
  endDate?: Date;
  limit?: number;
  isActive?: boolean;
};

/**
 * Custom error for coupon not found
 */
export class CouponNotFoundError extends Error {
  constructor(id: string) {
    super(`Coupon with ID ${id} not found`);
    this.name = "CouponNotFoundError";
  }
}

/**
 * Custom error for invalid update operations
 */
export class InvalidUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUpdateError";
  }
}

/**
 * Check if a coupon is expired
 */
function isExpired(coupon: Coupon): boolean {
  const now = new Date();
  const endDate = new Date(coupon.endDate);
  endDate.setHours(23, 59, 59, 999);
  return now > endDate;
}

/**
 * Validate update request against business rules
 */
function validateUpdate(coupon: Coupon, updates: UpdateCouponBody): void {
  // Cannot update expired coupons
  if (isExpired(coupon)) {
    throw new InvalidUpdateError("Cannot update an expired coupon");
  }

  // If updating endDate, can only extend it
  if (updates.endDate !== undefined) {
    const currentEndDate = new Date(coupon.endDate);
    const newEndDate = new Date(updates.endDate);

    if (newEndDate < currentEndDate) {
      throw new InvalidUpdateError("End date can only be extended, not reduced");
    }
  }

  // If updating limit, can only increase it
  if (updates.limit !== undefined && coupon.limitUses) {
    const currentLimit = coupon.limit ?? 0;
    if (updates.limit < currentLimit) {
      throw new InvalidUpdateError("Usage limit can only be increased, not decreased");
    }
  }

  // Cannot activate an expired coupon
  if (updates.isActive === true && isExpired(coupon)) {
    throw new InvalidUpdateError("Cannot activate an expired coupon");
  }
}

/**
 * Update a coupon by ID
 *
 * Updates only the provided fields. Validates business rules:
 * - Cannot update expired coupons
 * - endDate can only be extended
 * - limit can only be increased
 * - Cannot activate expired coupons
 *
 * @param id - Coupon ID
 * @param updates - Fields to update
 * @returns Updated coupon
 * @throws {CouponNotFoundError} If coupon doesn't exist
 * @throws {InvalidUpdateError} If update violates business rules
 */
export async function updateCoupon(id: string, updates: UpdateCouponBody): Promise<Coupon> {
  // Fetch current coupon
  const coupon = await findCouponById(id);

  if (!coupon) {
    throw new CouponNotFoundError(id);
  }

  // Validate update against business rules
  validateUpdate(coupon, updates);

  // Build update object (only include provided fields)
  const updateData: Partial<Coupon> = {};

  if (updates.endDate !== undefined) {
    updateData.endDate = updates.endDate;
  }

  if (updates.limit !== undefined) {
    updateData.limit = updates.limit;
  }

  if (updates.isActive !== undefined) {
    updateData.isActive = updates.isActive;
  }

  // If no fields to update, return current coupon
  if (Object.keys(updateData).length === 0) {
    return coupon;
  }

  // Import dynamically to avoid circular dependency
  const { updateCouponById } = await import("./repository");

  // Update in database
  const updated = await updateCouponById(id, updateData);

  if (!updated) {
    throw new CouponNotFoundError(id);
  }

  return updated;
}
