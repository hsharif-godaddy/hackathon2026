/**
 * Service for getting a single coupon by ID
 *
 * Fetches a coupon and calculates its current state.
 */

import { findCouponById } from "./repository";
import type { Coupon } from "../../../../db/schema";

export const COUPONS_STATE = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  EXPIRED: "EXPIRED",
} as const;

type CouponState = (typeof COUPONS_STATE)[keyof typeof COUPONS_STATE];

/**
 * Coupon with calculated state
 */
export interface CouponWithState extends Coupon {
  state: CouponState;
}

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
 * Determine the current state of a coupon
 *
 * State is calculated based on:
 * - isActive flag
 * - Current date vs endDate
 * - Usage limits (if enabled)
 */
function calculateCouponState(coupon: Coupon): CouponState {
  const now = new Date();
  const endDate = new Date(coupon.endDate);
  endDate.setHours(23, 59, 59, 999); // End of day

  if (!coupon.isActive) {
    return COUPONS_STATE.INACTIVE;
  } else if (now > endDate) {
    return COUPONS_STATE.EXPIRED;
  } else if (coupon.limitUses && (coupon.currentUsage ?? 0) >= (coupon.limit ?? 0)) {
    return COUPONS_STATE.EXPIRED;
  }

  return COUPONS_STATE.ACTIVE;
}

/**
 * Get a single coupon by ID
 *
 * Fetches the coupon from database and calculates its current state.
 *
 * @param id - Coupon ID
 * @returns Coupon with calculated state
 * @throws {CouponNotFoundError} If coupon doesn't exist
 */
export async function getCoupon(id: string): Promise<CouponWithState> {
  const coupon = await findCouponById(id);

  if (!coupon) {
    throw new CouponNotFoundError(id);
  }

  return {
    ...coupon,
    state: calculateCouponState(coupon),
  };
}
