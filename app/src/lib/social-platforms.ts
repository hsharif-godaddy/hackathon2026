import type { ComponentType } from 'react'
import FacebookIcon from '@ux/icon/facebook'
import GoogleIcon from '@ux/icon/google'
import InstagramIcon from '@ux/icon/instagram'
import TiktokIcon from '@ux/icon/tiktok'
import WhatsappIcon from '@ux/icon/whatsapp'
import YelpIcon from '@ux/icon/yelp'

import { SocialConnection, SocialPlatform } from '@/types/social'

interface PlatformConfig {
  name: string
  Icon: ComponentType<{ className?: string }>
}

export const PLATFORM_CONFIG: Record<string, PlatformConfig> = {
  [SocialPlatform.FACEBOOK]: { name: 'Facebook', Icon: FacebookIcon },
  [SocialPlatform.INSTAGRAM]: { name: 'Instagram', Icon: InstagramIcon },
  [SocialPlatform.GOOGLE_BUSINESS_PROFILE]: { name: 'Google', Icon: GoogleIcon },
  [SocialPlatform.TIKTOK]: { name: 'TikTok Shop', Icon: TiktokIcon },
}


export const ALL_PLATFORM_CONFIG: Record<SocialPlatform, PlatformConfig> = {
  [SocialPlatform.FACEBOOK]: { name: 'Facebook', Icon: FacebookIcon },
  [SocialPlatform.INSTAGRAM]: { name: 'Instagram', Icon: InstagramIcon },
  [SocialPlatform.GOOGLE_BUSINESS_PROFILE]: { name: 'Google', Icon: GoogleIcon },
  [SocialPlatform.TIKTOK]: { name: 'TikTok Shop', Icon: TiktokIcon },
  [SocialPlatform.YELP]: { name: 'Yelp', Icon: YelpIcon },
  [SocialPlatform.WHATSAPP]: { name: 'WhatsApp', Icon: WhatsappIcon },
}

export type SocialPlatformKey = keyof typeof PLATFORM_CONFIG

/**
 * Normalize platform name for comparison
 * Converts platform names to lowercase and handles special cases like google_business_profile -> google
 */
export function normalizePlatform(platform: string): string {
  const normalized = platform.toLowerCase()
  if (normalized === 'google_business_profile') {
    return 'google'
  }
  return normalized
}

/**
 * Platform status with connection information
 */
export interface PlatformStatus extends PlatformConfig {
  platform: string
  connection?: SocialConnection
}

/**
 * Map platform configurations with their connection status
 *
 * @param connections - Array of social connections
 * @returns Array of platform statuses with connection information
 */
export function mapPlatformStatuses(connections: SocialConnection[]): PlatformStatus[] {
  return Object.entries(ALL_PLATFORM_CONFIG).map(([key, config]) => ({
    platform: key,
    ...config,
    connection: connections.find(c => normalizePlatform(c.platform || '') === key),
  }))
}

export type { SocialConnection } from '@/types/social'
export { SocialPlatform } from '@/types/social'
