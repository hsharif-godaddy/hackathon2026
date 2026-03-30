/**
 * ITC (Internal Tracking Code) Override Constants
 *
 * Configuration for the ITC override system that allows marketing campaigns
 * to pass custom tracking codes via URL query parameters.
 */

/** localStorage key for storing the ITC override */
export const ITC_STORAGE_KEY = 'airo-itc-override';

/** URL query parameter name for ITC */
export const ITC_QUERY_PARAM = 'itc';

/** Time-to-live for stored ITC in milliseconds (24 hours) */
export const ITC_TTL_MS = 24 * 60 * 60 * 1000;
