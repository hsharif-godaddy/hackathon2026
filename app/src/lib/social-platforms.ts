import type { ComponentType } from 'react'
import FacebookIcon from '@ux/icon/facebook'
import GoogleIcon from '@ux/icon/google'
import InstagramIcon from '@ux/icon/instagram'
import TiktokIcon from '@ux/icon/tiktok'
import WhatsappIcon from '@ux/icon/whatsapp'
import YelpIcon from '@ux/icon/yelp'

import { Status } from '@/app/develop/components/settings/social/StatusBadge'
import { SocialConnection, SocialPlatform } from '@/types/social'

export interface PlatformConfig {
  name: string
  Icon: ComponentType<{ className?: string }> | null
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

export const PLATFORM_KEY_MAP: Record<string, SocialPlatform> = {
  facebook: SocialPlatform.FACEBOOK,
  instagram: SocialPlatform.INSTAGRAM,
  google: SocialPlatform.GOOGLE_BUSINESS_PROFILE,
  tiktok: SocialPlatform.TIKTOK,
  yelp: SocialPlatform.YELP,
  whatsapp: SocialPlatform.WHATSAPP
}

export type SocialPlatformKey = keyof typeof PLATFORM_CONFIG

/**
 * Platform name transformations for different contexts
 * Consolidates all platform name conversion logic in one place
 */
export const PLATFORM_TRANSFORMS = {
  /**
   * Normalize for display and comparison
   * google_business_profile → google
   * FACEBOOK → facebook
   */
  toDisplay: (platform: string): string => {
    return platform.toLowerCase().replace('_business_profile', '')
  },

  /**
   * Convert to API enum format for social-v2 API
   * google → GOOGLE_BUSINESS_PROFILE
   * facebook → FACEBOOK
   */
  toApiEnum: (platform: string): 'FACEBOOK' | 'GOOGLE_BUSINESS_PROFILE' | 'TIKTOK' | 'YELP' | 'WHATSAPP' | 'INSTAGRAM' => {
    const map: Record<string, any> = {
      google: 'GOOGLE_BUSINESS_PROFILE',
      facebook: 'FACEBOOK',
      tiktok: 'TIKTOK',
      yelp: 'YELP',
      whatsapp: 'WHATSAPP',
      instagram: 'INSTAGRAM',
    }
    return map[platform.toLowerCase()] || platform.toUpperCase()
  },

  /**
   * Get platform for permission validation
   * Instagram uses Facebook's permissions API
   */
  forValidation: (platform: string): string => {
    return platform.toLowerCase() === 'instagram' ? 'facebook' : platform.toLowerCase()
  },

  /**
   * Convert from API enum to display format
   * GOOGLE_BUSINESS_PROFILE → google
   */
  fromApiEnum: (platform: string): string => {
    return platform.toLowerCase().replace('_business_profile', '')
  },
} as const

/**
 * Platform status with connection information
 */
export interface PlatformStatus extends PlatformConfig {
  platform: string
  connection?: SocialConnection
}

/**
 * Map platform configurations with their connection status (only enabled platforms)
 *
 * @param connections - Array of social connections
 * @returns Array of platform statuses with connection information
 */
export function mapPlatformStatuses(connections: SocialConnection[]): PlatformStatus[] {
  return Object.entries(PLATFORM_CONFIG).map(([key, config]) => ({
    platform: key,
    ...config,
    connection: connections.find(c => PLATFORM_TRANSFORMS.toDisplay(c.platform || '') === key),
  }))
}

/**
 * Simple platform status for widgets
 * Returns all platforms with connected boolean
 */
export interface SimplePlatformStatus extends PlatformConfig {
  platform: SocialPlatform
  connected: boolean
}

/**
 * Get simple platform statuses (connected yes/no)
 * Used by SocialStatusWidget
 */
export function getSimplePlatformStatuses(
  connections: Array<SocialConnection>
): SimplePlatformStatus[] {
  return Object.entries(PLATFORM_CONFIG).map(([platformKey, config]) => {
    const platform = platformKey as SocialPlatform
    const connected = connections.some(c =>
      PLATFORM_TRANSFORMS.toDisplay(c.platform) === platform
    )

    return {
      platform,
      ...config,
      connected
    }
  })
}

/**
 * Detailed platform status for settings panel
 * Includes multiple connections per platform, link status, etc.
 */
export interface DetailedPlatformStatus<T extends SocialConnection = SocialConnection> extends PlatformConfig {
  platform: SocialPlatform
  connections: Array<T & { isLinked: boolean }>
  hiddenCount: number
  overallStatus: Status
}

interface GetDetailedPlatformStatusesOptions<T extends SocialConnection = SocialConnection> {
  connections: T[]
  linkedConnectionIds: Set<string>
  displayLimit?: number
}

/**
 * Get detailed platform statuses with connections and link info
 * Used by SocialPanel
 */
export function getDetailedPlatformStatuses<T extends SocialConnection = SocialConnection>({
  connections,
  linkedConnectionIds,
  displayLimit = 2
}: GetDetailedPlatformStatusesOptions<T>): DetailedPlatformStatus<T>[] {
  // Group connections by platform (using SocialPlatform lowercase keys)
  const grouped = connections.reduce((acc, conn) => {
    const platform = PLATFORM_TRANSFORMS.toDisplay(conn.platform) as SocialPlatform
    if (!acc[platform]) {
      acc[platform] = []
    }
    acc[platform].push(conn)
    return acc
  }, {} as Record<SocialPlatform, T[]>)

  // Build status for each platform (only enabled platforms)
  const statuses = Object.entries(PLATFORM_CONFIG).map(([platformKey, config]) => {
    const platform = platformKey as SocialPlatform
    const platformConnections = grouped[platform] || []

    // Add link status to connections (up to displayLimit)
    const displayConnections = platformConnections
      .slice(0, displayLimit)
      .map(conn => ({
        ...conn,
        isLinked: linkedConnectionIds.has(conn.socialId)
      }))

    const hiddenCount = Math.max(0, platformConnections.length - displayLimit)

    // Determine overall status
    const hasLinkedConnection = displayConnections.some(conn => conn.isLinked)
    const overallStatus: Status =
      platformConnections.length === 0
        ? Status.NotConnected
        : hasLinkedConnection
        ? Status.Linked
        : Status.NotLinked

    return {
      platform,
      ...config,
      connections: displayConnections,
      hiddenCount,
      overallStatus
    }
  })

  // Sort by status: linked first, then notLinked, then notConnected
  const statusOrder = { [Status.Linked]: 0, [Status.NotLinked]: 1, [Status.NotConnected]: 2 }
  return statuses.sort((a, b) => statusOrder[a.overallStatus] - statusOrder[b.overallStatus])
}

/**
 * Platform strategy for OAuth connect flow
 * Encapsulates platform-specific behavior to avoid scattered conditionals
 */
export type PagesType = 'facebook' | 'google' | 'none'

export interface PlatformStrategy {
  validationPlatform: SocialPlatform | 'unknown'
  pagesType: PagesType
  requiresPageSelection: boolean
  authEndpoint: string
  oauthParams?: Record<string, string>
}

export const PLATFORM_STRATEGIES: Record<SocialPlatform, PlatformStrategy> = {
  [SocialPlatform.FACEBOOK]: {
    validationPlatform: SocialPlatform.FACEBOOK,
    pagesType: 'facebook',
    requiresPageSelection: true,
    authEndpoint: 'facebook',
  },
  [SocialPlatform.INSTAGRAM]: {
    validationPlatform: SocialPlatform.FACEBOOK,
    pagesType: 'facebook',
    requiresPageSelection: true,
    authEndpoint: 'facebook',
  },
  [SocialPlatform.GOOGLE_BUSINESS_PROFILE]: {
    validationPlatform: SocialPlatform.GOOGLE_BUSINESS_PROFILE,
    pagesType: 'google',
    requiresPageSelection: true,
    authEndpoint: 'google',
  },
  [SocialPlatform.TIKTOK]: {
    validationPlatform: SocialPlatform.TIKTOK,
    pagesType: 'none',
    requiresPageSelection: false,
    authEndpoint: 'tiktok',
    oauthParams: { integration_type: 'SHOP' },
  },
  [SocialPlatform.YELP]: {
    validationPlatform: SocialPlatform.YELP,
    pagesType: 'none',
    requiresPageSelection: false,
    authEndpoint: 'yelp',
  },
  [SocialPlatform.WHATSAPP]: {
    validationPlatform: SocialPlatform.WHATSAPP,
    pagesType: 'none',
    requiresPageSelection: false,
    authEndpoint: 'whatsapp',
  },
}

const DEFAULT_STRATEGY: PlatformStrategy = {
  validationPlatform: 'unknown',
  pagesType: 'none',
  requiresPageSelection: false,
  authEndpoint: 'unknown',
}

export function getPlatformStrategy(platform: string): PlatformStrategy {
  const normalizedPlatform = platform.toLowerCase() as SocialPlatform
  return PLATFORM_STRATEGIES[normalizedPlatform] ?? DEFAULT_STRATEGY
}

export type { SocialConnection } from '@/types/social'
export { SocialPlatform } from '@/types/social'
