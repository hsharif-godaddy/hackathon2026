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

