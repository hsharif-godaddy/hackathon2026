/**
 * Frontend social platform types
 * Shared constants come from @airo/shared/social. Platform enums remain
 * frontend-specific (lowercase values vs agents' uppercase).
 */

export type { GoogleBusinessProfile, GoogleReview } from '@airo/shared/social'
export { CONNECT_REQUEST_FROM_PUBLISH, GBP_PROFILE_READY, GBP_UPDATE_DONE, GOOGLE_REVIEWS_READY } from '@airo/shared/social'

export enum SocialPlatform {
  FACEBOOK = 'facebook',
  INSTAGRAM = 'instagram',
  GOOGLE = 'google',
  GOOGLE_SEARCH_CONSOLE = 'google_search_console',
  TIKTOK = 'tiktok',
  YELP = 'yelp',
  WHATSAPP = 'whatsapp',
}

export enum SocialPlatformKey {
  FACEBOOK = 'FACEBOOK',
  INSTAGRAM = 'INSTAGRAM',
  GOOGLE_BUSINESS_PROFILE = 'GOOGLE_BUSINESS_PROFILE',
  GOOGLE_SEARCH_CONSOLE = 'GOOGLE_SEARCH_CONSOLE',
  TIKTOK = 'TIKTOK',
  YELP = 'YELP',
  WHATSAPP = 'WHATSAPP',
}

export enum FacebookMediaType {
  PHOTO = 'photo',
  POST = 'post',
}

/**
 * Base connection object returned by social-v2 API
 * IMPORTANT: This does NOT include metadata like pageName, locationName, etc.
 * Metadata must be fetched separately via platform proxy APIs
 */
interface BaseSocialConnection {
  socialId: string
  platform: SocialPlatformKey
}

/**
 * Facebook connection
 */
export interface FacebookConnection extends BaseSocialConnection {
  platform: SocialPlatformKey.FACEBOOK
  pageId: string
  userId: string
  pageTokenId?: string
  userTokenId?: string
}

/**
 * Instagram connection (linked to a Facebook page)
 */
export interface InstagramConnection extends BaseSocialConnection {
  platform: SocialPlatformKey.INSTAGRAM
  igAccountId: string
  facebookPageId: string
  userId: string
  userTokenId?: string
}

/**
 * Google Business Profile connection
 */
export interface GoogleConnection extends BaseSocialConnection {
  platform: SocialPlatformKey.GOOGLE_BUSINESS_PROFILE
  locationId: string
  accountId?: string
  userId: string
  locationTokenId?: string
  userTokenId?: string
}

/**
 * Google Search Console connection
 */
export interface GoogleSearchConsoleConnection extends BaseSocialConnection {
  platform: SocialPlatformKey.GOOGLE_SEARCH_CONSOLE
  userId: string
  userTokenId?: string
}

/**
 * TikTok Shop connection
 */
export interface TikTokConnection extends BaseSocialConnection {
  platform: SocialPlatformKey.TIKTOK
  shopId: string
  shopCipher: string
  shopCode: string
  region: string
  userTokenId?: string
}

/**
 * Yelp connection
 */
export interface YelpConnection extends BaseSocialConnection {
  platform: SocialPlatformKey.YELP
  businessId: string
  userTokenId?: string
}

export interface WhatsAppConnection extends BaseSocialConnection {
  platform: SocialPlatformKey.WHATSAPP
  userTokenId?: string
}

/**
 * Union type for all connection types
 * This is what social-v2 API returns - IDs and tokens only, NO metadata
 */
export type SocialConnection =
  | FacebookConnection
  | InstagramConnection
  | GoogleConnection
  | GoogleSearchConsoleConnection
  | TikTokConnection
  | YelpConnection
  | WhatsAppConnection

/**
 * Enriched Facebook connection with metadata from platform APIs
 */
export interface EnrichedFacebookConnection extends FacebookConnection {
  pageName?: string
  category?: string
  pictureUrl?: string
}

/**
 * Enriched Instagram connection with metadata from platform APIs
 */
export interface EnrichedInstagramConnection extends InstagramConnection {
  pageName?: string
  category?: string
  username?: string
  pictureUrl?: string
}

/**
 * Enriched Google connection with metadata from platform APIs
 */
export interface EnrichedGoogleConnection extends GoogleConnection {
  locationName?: string
  address?: string
}

/**
 * Enriched TikTok connection with metadata from platform APIs
 */
export interface EnrichedTikTokConnection extends TikTokConnection {
  shopName?: string
}

/**
 * Enriched Yelp connection with metadata from platform APIs
 */
export interface EnrichedYelpConnection extends YelpConnection {
  businessName?: string
  address?: string
  city?: string
  state?: string
  rating?: number
}

/**
 * Union type for enriched connections with metadata
 * Use this type after merging connection with platform proxy data
 */
export type EnrichedSocialConnection =
  | EnrichedFacebookConnection
  | EnrichedInstagramConnection
  | EnrichedGoogleConnection
  | EnrichedTikTokConnection
  | EnrichedYelpConnection

export interface SocialConnectResult {
  success: boolean
  platform: SocialPlatform | string
  authUrl?: string
  appId?: string
  error?: string
  message?: string
}

/**
 * Result from publishing a post to a social platform
 */
export interface SocialPublishResult {
  id: string
  platformUrl?: string
  permalink?: string
  permalink_url?: string
  post_id?: string
  [key: string]: any
}

/**
 * Association between a site and a social connection
 */
export interface SiteAssociation {
  id: string
  appId: string
  socialId: string
  platform: string
  createdAt: string
}

export interface SocialPlatformStatus {
  platform: SocialPlatform | string
  platformName: string
  connected: boolean
  connectionId?: string
  accountName?: string
  accountId?: string
}


/**
 * Actions that can be dispatched to the social connect flow state machine
 */
export enum SocialFlowAction {
  Error = 'ERROR',
  OAuthError = 'OAUTH_ERROR',
  OAuthTimeout = 'OAUTH_TIMEOUT',
  OAuthSuccess = 'OAUTH_SUCCESS',
  ExistingSelected = 'EXISTING_SELECTED',
  StartSelectExisting = 'START_SELECT_EXISTING',
  PageSelected = 'PAGE_SELECTED',
  ExecutePendingRetry = 'EXECUTE_PENDING_RETRY',
  StartOAuth = 'START_OAUTH',
  ForceNewConnection = 'FORCE_NEW_CONNECTION',
  ConnectionCreating = 'CONNECTION_CREATING',
  ConnectionCreated = 'CONNECTION_CREATED',
  PermissionsInvalid = 'PERMISSIONS_INVALID',
  PermissionsValid = 'PERMISSIONS_VALID',
  PermissionsError = 'PERMISSIONS_ERROR',
  PagesLoaded = 'PAGES_LOADED',
  PagesPartialFailure = 'PAGES_PARTIAL_FAILURE',
  SkipSelectExisting = 'SKIP_SELECT_EXISTING',
  Retry = 'RETRY',
  Reset = 'RESET',
}

/**
 * Pending publish data types for sequential connect flow
 */

// Legacy format (single platform) - for backwards compatibility
export interface LegacyPendingPublish {
  platform: string
  message: string
  imageUrls: string[]
  scheduledAt?: Date
}

// New format (multi-platform support)
export interface MultiPlatformPendingPublish {
  platforms: string[]
  platformData: Array<{
    platform: string
    message: string
    imageUrls: string[]
    scheduledAt?: Date
  }>
  message: string
  imageUrls: string[]
  scheduledAt?: Date
}

export type PendingPublishData = LegacyPendingPublish | MultiPlatformPendingPublish

// Type guard for multi-platform format
export function isMultiPlatformPublish(data: PendingPublishData): data is MultiPlatformPendingPublish {
  return 'platforms' in data && Array.isArray(data.platforms)
}

/**
 * Google Ads API Types (Performance Max)
 */

export interface GoogleAdsCustomer {
  id: string                     // Customer ID (numeric)
  resourceName: string           // "customers/{customer_id}"
  descriptiveName?: string       // Optional: only present in getGoogleAdsCustomer() response
  currencyCode?: string          // Optional: only present in getGoogleAdsCustomer() response
  timeZone?: string              // Optional: only present in getGoogleAdsCustomer() response
  manager?: boolean              // Optional: only present in getGoogleAdsCustomer() response (True if MCC account)
}

export enum GoogleAdsCampaignStatus {
  ENABLED = 'ENABLED',
  PAUSED = 'PAUSED',
  REMOVED = 'REMOVED',
}

export interface GoogleAdsCampaign {
  id: string
  resourceName: string           // "customers/{customer_id}/campaigns/{campaign_id}"
  name: string
  status: GoogleAdsCampaignStatus
  advertisingChannelType: 'PERFORMANCE_MAX'
  biddingStrategy: 'MAXIMIZE_CONVERSIONS' | 'MAXIMIZE_CONVERSION_VALUE' | 'TARGET_ROAS'
  budget: {
    resourceName: string         // Budget resource name
    amountMicros: number         // Amount in micros (e.g., 1000000 = $1)
  }
  optimizationGoalTypes?: string[]
  urlExpansionOptOut?: boolean
  startDate?: string             // YYYY-MM-DD
  endDate?: string               // YYYY-MM-DD
}

export enum GoogleAdsAssetType {
  IMAGE = 'IMAGE',
  TEXT = 'TEXT',
  VIDEO = 'VIDEO',
  MEDIA_BUNDLE = 'MEDIA_BUNDLE',
}

export interface GoogleAdsAsset {
  id: string
  resourceName: string           // "customers/{customer_id}/assets/{asset_id}"
  type: GoogleAdsAssetType
  name?: string
  imageAsset?: {
    fileSize: number
    mimeType: string
    fullSize: {
      url: string
      width: number
      height: number
    }
  }
  textAsset?: {
    text: string
  }
  youtubeVideoAsset?: {
    youtubeVideoId: string
    youtubeVideoTitle?: string
  }
}

export enum GoogleAdsAssetFieldType {
  HEADLINE = 'HEADLINE',
  LONG_HEADLINE = 'LONG_HEADLINE',
  DESCRIPTION = 'DESCRIPTION',
  BUSINESS_NAME = 'BUSINESS_NAME',
  MARKETING_IMAGE = 'MARKETING_IMAGE',
  SQUARE_MARKETING_IMAGE = 'SQUARE_MARKETING_IMAGE',
  LOGO = 'LOGO',
  LANDSCAPE_LOGO = 'LANDSCAPE_LOGO',
  VIDEO = 'VIDEO',
  CALL_TO_ACTION = 'CALL_TO_ACTION_SELECTION',
}

export enum GoogleAdsAssetGroupStatus {
  ENABLED = 'ENABLED',
  PAUSED = 'PAUSED',
  REMOVED = 'REMOVED',
}

export interface GoogleAdsAssetGroup {
  id: string
  resourceName: string           // "customers/{customer_id}/assetGroups/{asset_group_id}"
  campaign: string               // Campaign resource name
  name: string
  status: GoogleAdsAssetGroupStatus
  finalUrls: string[]
  finalMobileUrls?: string[]
  assets?: Array<{
    asset: string                // Asset resource name
    fieldType: GoogleAdsAssetFieldType
  }>
}

export interface GoogleAdsCampaignMetrics {
  campaignId: string
  campaignName: string
  impressions: number
  clicks: number
  costMicros: number             // Cost in micros
  conversions: number
  conversionValue: number
  averageCpc: number             // In micros
  ctr: number                    // Click-through rate (0-1)
  dateRange: {
    startDate: string            // YYYY-MM-DD
    endDate: string              // YYYY-MM-DD
  }
}

export enum GoogleAdsConversionCategory {
  DEFAULT = 'DEFAULT',
  PAGE_VIEW = 'PAGE_VIEW',
  PURCHASE = 'PURCHASE',
  SIGNUP = 'SIGNUP',
  LEAD = 'LEAD',
  DOWNLOAD = 'DOWNLOAD',
}

export enum GoogleAdsConversionActionStatus {
  ENABLED = 'ENABLED',
  REMOVED = 'REMOVED',
}

export enum GoogleAdsConversionActionType {
  WEBPAGE = 'WEBPAGE',
  WEBSITE_CALL = 'WEBSITE_CALL',
  APP_DEEP_LINK = 'APP_DEEP_LINK',
}

export enum GoogleAdsConversionCountingType {
  ONE_PER_CLICK = 'ONE_PER_CLICK',
  MANY_PER_CLICK = 'MANY_PER_CLICK',
}

export interface GoogleAdsConversionAction {
  id: string
  resourceName: string           // "customers/{customer_id}/conversionActions/{conversion_action_id}"
  name: string
  status: GoogleAdsConversionActionStatus
  category: GoogleAdsConversionCategory
  type: GoogleAdsConversionActionType
  countingType: GoogleAdsConversionCountingType
  valueMicros?: number           // Default conversion value
  clickThroughLookbackWindowDays?: number
  tagSnippets?: {
    globalSiteTag?: string       // gtag.js snippet
    eventSnippet?: string        // Conversion event snippet
  }
}

