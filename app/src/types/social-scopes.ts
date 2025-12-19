/**
 * Social Platform OAuth Scopes
 *
 * Organized by capability for better maintainability and self-documentation.
 * Each category represents a distinct capability or permission level.
 */

export const FACEBOOK_SCOPES = {
  metadata: [
    'pages_show_list',
    'public_profile',
  ],

  contentCreation: [
    'pages_manage_posts',
  ],

  engagement: [
    'pages_read_engagement',
    'pages_manage_engagement',
    'pages_read_user_content',
  ],

  management: [
    'pages_manage_metadata',
    'business_management',
  ],

  insights: [
    'read_insights',
  ],

  ads: [
    'pages_manage_ads',
  ],
}

export const INSTAGRAM_SCOPES = {
  metadata: [
    'pages_show_list',
    'public_profile',
  ],

  contentCreation: [
    'instagram_basic',
    'instagram_content_publish',
  ],

  engagement: [
    'pages_read_engagement',
    'pages_manage_engagement',
  ],

  management: [
    'pages_manage_metadata',
    'business_management',
  ],

  insights: [
    'read_insights',
    'instagram_manage_insights',
  ],

  ads: [
    'pages_manage_ads',
  ],
}

export const GOOGLE_SCOPES = {
  businessManagement: [
    'https://www.googleapis.com/auth/business.manage',
  ],

  siteVerification: [
    'https://www.googleapis.com/auth/siteverification',
  ],

  searchConsole: [
    'https://www.googleapis.com/auth/webmasters',
  ],
}

export const WHATSAPP_SCOPES = {
  /**
   * WhatsApp Business scopes are configured per-app in the Meta App Dashboard
   * using a config_id, not requested dynamically during OAuth. The authorization
   * flow does not accept a scope parameter - configured scopes are granted automatically.
   *
   * Dependencies:
   * - whatsapp_business_messaging requires whatsapp_business_management
   * - whatsapp_business_manage_events requires whatsapp_business_management
   *
   * The granted scopes are returned in the token debug response for reference.
   */
  management: [
    'whatsapp_business_management',
  ],

  messaging: [
    'whatsapp_business_messaging',
  ],

  events: [
    'whatsapp_business_manage_events',
  ],
}

export const YELP_SCOPES = {
  base: [
    'r2r',
  ],

  businesses: [
    'r2r_get_businesses',
  ],

  ownership: [
    'r2r_business_owner',
  ],
}

export const TIKTOK_SCOPES = {
  /**
   * TikTok Shop scopes are configured per-app in the TikTok Seller Center,
   * not requested dynamically during OAuth. The authorization flow does not
   * accept a scope parameter - all configured scopes are granted automatically.
   *
   * Common TikTok Shop scopes (configured in Seller Center):
   * - product.list: Read product catalog
   * - order.list: Read orders
   * - fulfillment: Manage order fulfillment
   * - promotion: Manage promotions
   * - finance: Access financial data
   *
   * The granted scopes are returned in the token response and stored for reference.
   * See: https://partner.tiktokshop.com/doc/page/63fd743c715d622a338c4e5a
   */
  shop: [] as string[],
}

/**
 * Default scopes requested during OAuth for each platform
 *
 * These represent the core permissions needed for social content management:
 * - Viewing and selecting accounts (metadata)
 * - Creating and publishing posts (contentCreation)
 * - Reading and managing engagement (engagement)
 * - Accessing performance data (insights)
 *
 * To extend with additional capabilities (e.g., ads), add the relevant scope category:
 * facebook: [...FACEBOOK_SCOPES.metadata, ...FACEBOOK_SCOPES.ads]
 */
export const DEFAULT_SCOPES: Record<string, string[]> = {
  facebook: [
    ...FACEBOOK_SCOPES.metadata,
    ...FACEBOOK_SCOPES.contentCreation,
    ...FACEBOOK_SCOPES.engagement,
    ...FACEBOOK_SCOPES.insights,
  ],

  instagram: [
    ...INSTAGRAM_SCOPES.metadata,
    ...INSTAGRAM_SCOPES.contentCreation,
    ...INSTAGRAM_SCOPES.engagement,
    ...INSTAGRAM_SCOPES.insights,
  ],

  google: [
    ...GOOGLE_SCOPES.businessManagement,
  ],

  whatsapp: [
    ...WHATSAPP_SCOPES.management,
  ],

  yelp: [
    ...YELP_SCOPES.base,
    ...YELP_SCOPES.businesses,
  ],

  tiktok: [
    ...TIKTOK_SCOPES.shop,
  ],
}
