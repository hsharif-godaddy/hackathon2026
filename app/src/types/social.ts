/**
 * Frontend social platform types
 * These match the backend types but are defined separately to avoid coupling
 */

export enum SocialPlatform {
  FACEBOOK = 'facebook',
  INSTAGRAM = 'instagram',
  GOOGLE_BUSINESS_PROFILE = 'google',
  TIKTOK = 'tiktok',
  YELP = 'yelp',
  WHATSAPP = 'whatsapp',
}

export interface SocialConnection {
  id?: string
  platform?: string
  customerId?: string
  socialId?: string
  // Facebook/Instagram
  pageId?: string
  pageName?: string
  userId?: string
  igAccountId?: string
  userTokenId?: string
  pageTokenId?: string
  // Google Business Profile
  locationId?: string
  locationName?: string
  locationToken?: string
  // TikTok
  shopId?: string
  shopName?: string
  // Yelp
  businessId?: string
  credentialType?: string
  // Legacy fields
  pageToken?: string
  userToken?: string
  createdAt?: string
  updatedAt?: string
  metadata?: Record<string, unknown>
}

export interface SocialConnectResult {
  success: boolean
  platform: SocialPlatform | string
  authUrl?: string
  appId?: string
  error?: string
  message?: string
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
