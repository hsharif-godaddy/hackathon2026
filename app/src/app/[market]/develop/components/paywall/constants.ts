/**
 * Product IDs for unified plans and pricing library
 */
export const UPGRADE_PRODUCT_IDS = {
  /** Legacy Airo Plus product */
  AIRO_PLUS: 'AiroPlusAppBuilderProduct',
  /** New Airo Builder subscription product */
  AIRO_BUILDER: 'AiroBuilderProduct',
  /** Plan add-on credit packs (quantity selector) */
  AIRO_BUILDER_CREDITS: 'AiroBuilderCreditsProduct',
  /** Standalone credit pack plan (quantity selector) */
  AIRO_STANDALONE_CREDIT_PACK: 'AiroReserveCreditsProduct',
} as const

/**
 * Offer group IDs for Direct-to-Paid flows
 */
export const D2P_OFFER_GROUP_IDS = {
  /** Airo Builder lineup for new users without subscription */
  AIRO_BUILDER_LINEUP: 'airoBuilderLineup',
} as const

export type UpgradeProductId = typeof UPGRADE_PRODUCT_IDS[keyof typeof UPGRADE_PRODUCT_IDS]
