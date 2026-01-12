/**
 * Social Platform OAuth Scopes
 *
 * Organized by capability tier for better maintainability and self-documentation.
 * Each tier represents a distinct capability level for social media management.
 *
 * IMPORTANT: Some scopes have dependencies that must be included even if not directly used.
 * For example, pages_manage_posts requires pages_read_engagement to function.
 *
 * Facebook API reference: https://developers.facebook.com/docs/permissions/
 */

export const FACEBOOK_SCOPES = {
  /**
   * TIER 1: Core - Essential scopes for any Facebook Page integration
   * Required to authenticate and identify Pages
   */
  core: [
    'pages_show_list',        // List Pages user manages (required for all Page operations)
    'public_profile',         // Basic user profile info
  ],

  /**
   * TIER 2: Publishing - Create and manage posts
   * Allows posting photos, videos, and text to Facebook Pages
   */
  publishing: [
    // 'pages_manage_posts',     // Create, edit, delete Page posts
    // 'publish_video',       // Live video streaming (future)
    // 'pages_manage_contents', // Delete posts (future - if separate delete access needed)
  ],

  /**
   * TIER 3: Engagement - Read and respond to audience
   * NOTE: pages_read_engagement is a REQUIRED dependency for pages_manage_posts
   */
  engagement: [
    'pages_read_engagement',  // Read posts, followers, metadata (REQUIRED for publishing)
    // 'pages_read_user_content',     // Read user comments/ratings (future)
    // 'pages_manage_engagement',     // Reply to/manage comments (future)
  ],

  /**
   * TIER 4: Analytics - Performance insights (future)
   */
  // analytics: [
  //   'read_insights',       // Page performance metrics
  // ],

  /**
   * TIER 5: Messaging - Direct messaging (future)
   */
  // messaging: [
  //   'pages_messaging',     // Manage Messenger conversations
  //   'pages_manage_metadata', // Required for pages_messaging
  // ],

  /**
   * TIER 6: Advertising - Ad management (not currently needed)
   */
  // advertising: [
  //   'pages_manage_ads',
  // ],

  /**
   * TIER 7: Advanced - Business management (future)
   */
  // advanced: [
  //   'business_management', // Manage business assets
  //   'pages_manage_metadata', // Webhooks, settings
  // ],
}

export const INSTAGRAM_SCOPES = {
  /**
   * TIER 1: Core - Essential scopes for any Instagram integration
   * Required to authenticate and identify Instagram Business accounts
   */
  core: [
    'pages_show_list',        // List Pages user manages (required for Instagram access)
    'public_profile',         // Basic user profile info
  ],

  /**
   * TIER 2: Publishing - Create and manage posts
   * Allows posting photos and videos to Instagram Business accounts
   */
  publishing: [
    'instagram_basic',        // Basic Instagram profile metadata (REQUIRED for content_publish)
    'instagram_content_publish', // Publish organic feed photos/videos
    // 'instagram_manage_contents',  // Delete posts (future)
  ],

  /**
   * TIER 3: Engagement - Read and respond to audience
   * NOTE: pages_read_engagement is a REQUIRED dependency for instagram_content_publish
   */
  engagement: [
    'pages_read_engagement',  // Read Page engagement data (REQUIRED for publishing)
    // 'instagram_manage_comments',  // Manage comments (future)
  ],

  /**
   * TIER 4: Analytics - Performance insights (future)
   */
  // analytics: [
  //   'instagram_manage_insights',  // Performance metrics
  // ],

  /**
   * TIER 5: Messaging - Direct messaging (future)
   */
  // messaging: [
  //   'instagram_manage_messages',  // DM management
  // ],

  /**
   * TIER 6: Commerce - Shopping features (future)
   */
  // commerce: [
  //   'instagram_shopping_tag_products', // Product tagging
  // ],

  /**
   * TIER 7: Advertising - Ad management (not currently needed)
   */
  // advertising: [
  //   'pages_manage_ads',
  // ],
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
 * These represent the minimum permissions needed for social content publishing:
 * - Core: Authenticate and identify accounts
 * - Publishing: Create and publish posts
 * - Engagement: Read engagement data (required dependency for publishing)
 *
 * IMPORTANT: engagement scopes are included as REQUIRED dependencies for publishing,
 * even though we don't directly use engagement features yet.
 *
 * To extend with additional capabilities in the future, add the relevant scope tier:
 * facebook: [...FACEBOOK_SCOPES.core, ...FACEBOOK_SCOPES.publishing, ...FACEBOOK_SCOPES.analytics]
 */
export const DEFAULT_SCOPES: Record<string, string[]> = {
  facebook: [
    ...FACEBOOK_SCOPES.core,
    ...FACEBOOK_SCOPES.publishing,
    ...FACEBOOK_SCOPES.engagement,  // Required dependency for publishing
  ],

  instagram: [
    ...INSTAGRAM_SCOPES.core,
    ...INSTAGRAM_SCOPES.publishing,
    ...INSTAGRAM_SCOPES.engagement,  // Required dependency for publishing
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
