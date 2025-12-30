import type { FacebookConnection, GoogleConnection, InstagramConnection, SocialConnection, TikTokConnection, WhatsAppConnection,YelpConnection } from '@/types/social'
import { SocialPlatformKey } from '@/types/social'

/**
 * Type guards for narrowing SocialConnection discriminated unions
 */

export function isFacebookConnection(conn: SocialConnection): conn is FacebookConnection {
  return conn.platform === SocialPlatformKey.FACEBOOK
}

export function isInstagramConnection(conn: SocialConnection): conn is InstagramConnection {
  return conn.platform === SocialPlatformKey.INSTAGRAM
}

export function isGoogleConnection(conn: SocialConnection): conn is GoogleConnection {
  return conn.platform === SocialPlatformKey.GOOGLE_BUSINESS_PROFILE
}

export function isTikTokConnection(conn: SocialConnection): conn is TikTokConnection {
  return conn.platform === SocialPlatformKey.TIKTOK
}

export function isYelpConnection(conn: SocialConnection): conn is YelpConnection {
  return conn.platform === SocialPlatformKey.YELP
}

export function isWhatsAppConnection(conn: SocialConnection): conn is WhatsAppConnection {
  return conn.platform === SocialPlatformKey.WHATSAPP
}
