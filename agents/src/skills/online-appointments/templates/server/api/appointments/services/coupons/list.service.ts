/**
 * Service for listing coupons
 *
 * Fetches coupons for an account with optional filters and calculates
 * their current state (active, inactive, expired).
 */

import { findCoupons, type CouponFilter } from "./repository";
import type { Coupon } from "../../../../db/schema";

/**
 * Query parameters for listing coupons
 */
export type ListCouponsQuery = {
  code?: string;
  type?: "PERCENTAGE" | "FIXED";
  isActive?: boolean;
};

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
 * Get list of coupons
 *
 * Fetches coupons from database, calculates their state, and optionally
 * filters to only active coupons.
 *
 * @param query - Query parameters (filters)
 * @returns Array of coupons with calculated state
 */
export async function getCoupons(query: ListCouponsQuery): Promise<CouponWithState[]> {
  // Build filter object for repository
  const filter: CouponFilter = {
    deletedAt: null, // Exclude soft-deleted coupons
  };

  // Add optional filters
  if (query.code !== undefined) {
    filter.code = query.code;
  }
  if (query.type !== undefined) {
    filter.type = query.type;
  }
  if (query.isActive !== undefined) {
    filter.isActive = query.isActive;
  }

  // Fetch coupons from database
  const coupons = await findCoupons(filter);

  // Calculate state for each coupon
  const couponsWithState: CouponWithState[] = coupons.map((coupon) => ({
    ...coupon,
    state: calculateCouponState(coupon),
  }));

  return couponsWithState;
}
