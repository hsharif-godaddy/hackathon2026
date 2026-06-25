/**
 * Social Platform OAuth Scopes
 *
 * Organized by capability tier for better maintainability and self-documentation.
 * Each tier represents a distinct capability level for social media management.
 *
 * Facebook API reference: https://developers.facebook.com/docs/permissions/
 */

/**
 * CRITICAL SCOPE DEPENDENCIES (Facebook/Instagram):
 *
 * These dependencies MUST be maintained - removing dependency scopes will break functionality:
 * - pages_manage_posts REQUIRES pages_read_engagement
 * - pages_manage_engagement REQUIRES pages_read_engagement
 * - instagram_content_publish REQUIRES instagram_basic
 * - Any pages_* scope REQUIRES pages_show_list and business_management
 *
 * Always validate scope dependencies before removal.
 */

export const FACEBOOK_SCOPES = {
  /**
   * Social - Connect, publish, engage, and analyze
   * Core social media management features for Facebook Pages
   */
  social: [
    'pages_show_list',
    'public_profile',
    'business_management',
    'pages_manage_posts',
    'pages_manage_metadata',
    'pages_read_engagement',
    'pages_read_user_content',
    'pages_manage_engagement',
    'read_insights',
  ],

  /**
   * Ad - Paid advertising features
   */
  ad: [
    'ads_management',
    'pages_manage_ads',
  ],
}

export const INSTAGRAM_SCOPES = {
  /**
   * Social - Connect, publish, engage, and analyze
   * Core social media management features for Instagram Business accounts
   */
  social: [
    'pages_show_list',
    'public_profile',
    'business_management',
    'instagram_basic',
    'instagram_content_publish',
    'pages_manage_posts',
    'pages_manage_metadata',
    'pages_read_engagement',
    'pages_read_user_content',
    'pages_manage_engagement',
    'read_insights',
    'instagram_manage_insights',
  ],

  /**
   * Ad - Paid advertising features
   */
  ad: [
    'ads_management',
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

  userInfo: [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
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
 * Social scopes for organic social media management
 *
 * Follows OAuth principle of least privilege - only requests scopes necessary for
 * core social media management features (connect, publish, engage, analyze).
 *
 * Additional capabilities (advertising) should be requested conditionally via
 * ADVERTISING_SCOPES when those features are explicitly used.
 */
export const SOCIAL_SCOPES: Record<string, string[]> = {
  facebook: FACEBOOK_SCOPES.social,
  instagram: INSTAGRAM_SCOPES.social,
  google: GOOGLE_SCOPES.businessManagement,
  google_search_console: [...GOOGLE_SCOPES.searchConsole, ...GOOGLE_SCOPES.siteVerification, ...GOOGLE_SCOPES.userInfo],
  whatsapp: WHATSAPP_SCOPES.management,
  yelp: [...YELP_SCOPES.base, ...YELP_SCOPES.businesses],
  tiktok: TIKTOK_SCOPES.shop,
}

/**
 * Advertising scopes for paid advertising features
 *
 * REQUIREMENTS:
 * - Meta app review approval required
 * - Explicit user consent required
 * - Business use case justification required
 *
 * Only request when user explicitly enables advertising features.
 */
export const ADVERTISING_SCOPES: Record<string, string[]> = {
  facebook: FACEBOOK_SCOPES.ad,
  instagram: INSTAGRAM_SCOPES.ad,
}
