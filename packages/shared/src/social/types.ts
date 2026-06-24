/**
 * Shared social platform constant
 */
export const CONNECT_REQUEST_FROM_PUBLISH = 'social_connect_with_post'

/**
 * Context attachment type sent by frontend after fetching Google reviews
 */
export const GOOGLE_REVIEWS_READY = 'google_reviews_ready'

/**
 * A single Google review as returned by the My Business Reviews API
 */
export interface GoogleReview {
  reviewId: string
  reviewer: {
    displayName: string
    profilePhotoUrl?: string
  }
  starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE'
  comment?: string
  createTime: string
  updateTime: string
}

/**
 * Context attachment type sent by the frontend after reading the editable
 * Google Business Profile listing (the GBP read round-trip — RUBICON-469).
 */
export const GBP_PROFILE_READY = 'gbp_profile_ready'

/**
 * Context attachment type sent by the frontend after writing a field back to
 * the Google Business Profile listing (the GBP write round-trip — RUBICON-469).
 */
export const GBP_UPDATE_DONE = 'gbp_update_done'

/**
 * Structured postal address as returned by the GBP Business Information API
 * (`location.storefrontAddress`, a google.type.PostalAddress subset).
 */
export interface GbpPostalAddress {
  regionCode?: string
  languageCode?: string
  postalCode?: string
  administrativeArea?: string
  locality?: string
  addressLines?: string[]
}

/** A wall-clock time-of-day as returned by the GBP regularHours periods. */
export interface GbpTimeOfDay {
  hours?: number
  minutes?: number
}

/** One open→close period within a GBP location's regular hours. */
export interface GbpTimePeriod {
  openDay: string
  openTime?: GbpTimeOfDay
  closeDay: string
  closeTime?: GbpTimeOfDay
}

/** Regular opening hours as returned by the GBP Business Information API. */
export interface GbpRegularHours {
  periods: GbpTimePeriod[]
}

/**
 * The subset of a Google Business Profile listing this skill reads and may
 * sync. Mapped from the GBP Business Information `location` resource:
 * `title`, `storefrontAddress`, `phoneNumbers.primaryPhone`, `regularHours`,
 * `websiteUri`, `profile.description`. (categories are out of scope.)
 */
export interface GoogleBusinessProfile {
  name: string
  storefrontAddress?: GbpPostalAddress
  primaryPhone?: string
  regularHours?: GbpRegularHours
  websiteUri?: string
  /** Business description (GBP `profile.description`; free text, ~750 chars, no URLs). */
  description?: string
}
