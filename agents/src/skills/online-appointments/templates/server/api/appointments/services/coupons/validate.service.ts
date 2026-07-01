/**
 * Coupon validation service
 *
 * Validates coupon codes and calculates discounts for appointment bookings.
 */

import { findCouponByCode } from "./repository";
import type { Coupon } from "../../../../db/schema";

/**
 * Input for validating a coupon
 */
export type ValidateCouponInput = {
  couponCode: string;
  cartTotal: number;
  currency: string;
};

export const COUPON_TYPE = {
  PERCENTAGE: "PERCENTAGE",
  FIXED: "FIXED",
} as const;

export const COUPONS_STATE = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  EXPIRED: "EXPIRED",
} as const;

export const AMOUNT_ERROR_CODE = "AMOUNT_ERROR";

type CouponState = (typeof COUPONS_STATE)[keyof typeof COUPONS_STATE];

interface ValidateResponse {
  valid: boolean;
  couponDiscount?: number;
  reason?: string;
  code?: string;
  eligible_amount?: number;
}

/**
 * Convert cents to dollars
 */
function fromUnit(cents: number): number {
  return cents / 100;
}

/**
 * Convert dollars to cents
 */
function toUnit(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Determine the current state of a coupon
 */
function getCouponState(coupon: Coupon): CouponState {
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
 * Calculate discount based on coupon type
 */
function calculateDiscount(coupon: Coupon, cartTotal: number): number {
  switch (coupon.type) {
    case COUPON_TYPE.FIXED:
      return fromUnit(coupon.discountPrice ?? 0);
    case COUPON_TYPE.PERCENTAGE:
      return ((coupon.discountPercentage ?? 0) / 100) * cartTotal;
    default:
      return 0;
  }
}

/**
 * Validate a coupon code and calculate discount
 *
 * Fetches the coupon from the database and validates it against:
 * - Existence
 * - Active state
 * - Expiration date
 * - Usage limits
 * - Minimum cart value
 */
export async function validateCoupon(input: ValidateCouponInput): Promise<ValidateResponse> {
  // Fetch coupon from database
  const coupon = await findCouponByCode(input.couponCode);

  if (!coupon) {
    return {
      valid: false,
      reason: "Coupon not found",
      code: "NOT_FOUND",
    };
  }

  // Check coupon state (active, inactive, expired)
  const state = getCouponState(coupon);
  if (state === COUPONS_STATE.EXPIRED || state === COUPONS_STATE.INACTIVE) {
    return {
      valid: false,
      reason: state,
      code: state,
    };
  }

  // Convert cart total from cents to dollars for calculation
  const cartTotal = fromUnit(input.cartTotal);
  const minimumCartValue = fromUnit(coupon.minimumCartValue);

  // Check if cart meets minimum value requirement
  if (minimumCartValue > cartTotal) {
    return {
      valid: false,
      reason: "Cart total amount is below minimum required",
      code: AMOUNT_ERROR_CODE,
      eligible_amount: coupon.minimumCartValue,
    };
  }

  // Calculate discount and convert back to cents
  const discount = calculateDiscount(coupon, cartTotal);

  // Unknown coupon type produces $0 discount — reject rather than silently apply no discount
  if (discount <= 0) {
    return {
      valid: false,
      reason: "Coupon does not produce a valid discount",
      code: "INVALID_DISCOUNT",
    };
  }

  const couponDiscount = toUnit(discount);

  return {
    valid: true,
    couponDiscount,
  };
}
