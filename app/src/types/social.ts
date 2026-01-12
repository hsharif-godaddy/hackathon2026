/**
 * Frontend social platform types
 * These match the backend types but are defined separately to avoid coupling
 */

export enum SocialPlatform {
  FACEBOOK = 'facebook',
  INSTAGRAM = 'instagram',
  GOOGLE = 'google',
  TIKTOK = 'tiktok',
  YELP = 'yelp',
  WHATSAPP = 'whatsapp',
}

export enum SocialPlatformKey {
  FACEBOOK = 'FACEBOOK',
  INSTAGRAM = 'INSTAGRAM',
  GOOGLE_BUSINESS_PROFILE = 'GOOGLE_BUSINESS_PROFILE',
  TIKTOK = 'TIKTOK',
  YELP = 'YELP',
  WHATSAPP = 'WHATSAPP',
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
  userId: string
  locationTokenId?: string
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
  site_id: string
  social_id: string
  platform: string
  created_at: string
}

export interface SocialPlatformStatus {
  platform: SocialPlatform | string
  platformName: string
  connected: boolean
  connectionId?: string
  accountName?: string
  accountId?: string
}

export interface SocialStatusResult {
  success: boolean
  platforms?: Array<{
    platform: string
    platformName: string
    connected: boolean
    connectionId?: string
    accountName?: string
    accountId?: string
  }>
  totalPlatforms?: number
  connectedCount?: number
  error?: string
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
