import type { ComponentType } from 'react'
import FacebookIcon from '@ux/icon/facebook'
import GoogleIcon from '@ux/icon/google'
import InstagramIcon from '@ux/icon/instagram'
import TiktokIcon from '@ux/icon/tiktok'
import WhatsappIcon from '@ux/icon/whatsapp'
import YelpIcon from '@ux/icon/yelp'

import { Status } from '@/app/[market]/develop/components/settings/social/StatusBadge'
import { SocialConnection, SocialPlatform, SocialPlatformKey } from '@/types/social'

export interface PlatformConfig {
  name: string
  Icon: ComponentType<{ className?: string }> | null
}

export const PLATFORM_CONFIG: Record<string, PlatformConfig> = {
  [SocialPlatform.FACEBOOK]: { name: 'Facebook', Icon: FacebookIcon },
  [SocialPlatform.INSTAGRAM]: { name: 'Instagram', Icon: InstagramIcon },
}

/**
 * Platforms that support publishing posts.
 * Derived from PLATFORM_CONFIG - single source of truth.
 */
export type PublishablePlatform = keyof typeof PLATFORM_CONFIG


export const ALL_PLATFORM_CONFIG: Record<SocialPlatform, PlatformConfig> = {
  [SocialPlatform.FACEBOOK]: { name: 'Facebook', Icon: FacebookIcon },
  [SocialPlatform.INSTAGRAM]: { name: 'Instagram', Icon: InstagramIcon },
  [SocialPlatform.GOOGLE]: { name: 'Google', Icon: GoogleIcon },
  [SocialPlatform.TIKTOK]: { name: 'TikTok Shop', Icon: TiktokIcon },
  [SocialPlatform.YELP]: { name: 'Yelp', Icon: YelpIcon },
  [SocialPlatform.WHATSAPP]: { name: 'WhatsApp', Icon: WhatsappIcon },
}

export const PLATFORM_KEY_MAP: Record<string, SocialPlatform> = {
  facebook: SocialPlatform.FACEBOOK,
  instagram: SocialPlatform.INSTAGRAM,
  google: SocialPlatform.GOOGLE,
  tiktok: SocialPlatform.TIKTOK,
  yelp: SocialPlatform.YELP,
  whatsapp: SocialPlatform.WHATSAPP
}

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
   * Convert to display name with proper casing
   * INSTAGRAM → Instagram
   * facebook → Facebook
   * google → Google
   */
  toDisplayName: (platform: string): string => {
    const normalized = platform.toLowerCase().replace('_business_profile', '') as SocialPlatform
    return ALL_PLATFORM_CONFIG[normalized]?.name || platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase()
  },

  /**
   * Convert to API enum format for social-v2 API
   * google → GOOGLE_BUSINESS_PROFILE
   * facebook → FACEBOOK
   */
  toApiEnum: (platform: string): SocialPlatformKey => {
    const map: Record<string, SocialPlatformKey> = {
      [SocialPlatform.GOOGLE]: SocialPlatformKey.GOOGLE_BUSINESS_PROFILE,
      [SocialPlatform.FACEBOOK]: SocialPlatformKey.FACEBOOK,
      [SocialPlatform.TIKTOK]: SocialPlatformKey.TIKTOK,
      [SocialPlatform.YELP]: SocialPlatformKey.YELP,
      [SocialPlatform.WHATSAPP]: SocialPlatformKey.WHATSAPP,
      [SocialPlatform.INSTAGRAM]: SocialPlatformKey.INSTAGRAM,
    }
    return map[platform.toLowerCase()] || (platform.toUpperCase() as SocialPlatformKey)
  },

  /**
   * Get platform for permission validation
   * Instagram uses Facebook's permissions API
   */
  forValidation: (platform: string): string => {
    return platform.toLowerCase() === SocialPlatform.INSTAGRAM ? SocialPlatform.FACEBOOK : platform.toLowerCase()
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

    // Sort connections: linked first, then unlinked
    const sortedConnections = [...platformConnections].sort((a, b) => {
      const aLinked = linkedConnectionIds.has(a.socialId)
      const bLinked = linkedConnectionIds.has(b.socialId)
      if (aLinked && !bLinked) return -1
      if (!aLinked && bLinked) return 1
      return 0
    })

    // Add link status to connections (up to displayLimit)
    const displayConnections = sortedConnections
      .slice(0, displayLimit)
      .map(conn => ({
        ...conn,
        isLinked: linkedConnectionIds.has(conn.socialId)
      }))

    const hiddenCount = Math.max(0, platformConnections.length - displayLimit)

    // Determine overall status - check ALL connections, not just displayed ones
    const hasLinkedConnection = platformConnections.some(conn => linkedConnectionIds.has(conn.socialId))
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
export interface PlatformStrategy {
  provider: SocialPlatform | 'unknown'
  requiresPageSelection: boolean
  oauthParams?: Record<string, string>
}

export const PLATFORM_STRATEGIES: Record<SocialPlatform, PlatformStrategy> = {
  [SocialPlatform.FACEBOOK]: {
    provider: SocialPlatform.FACEBOOK,
    requiresPageSelection: true,
  },
  [SocialPlatform.INSTAGRAM]: {
    provider: SocialPlatform.FACEBOOK,
    requiresPageSelection: true,
  },
  [SocialPlatform.GOOGLE]: {
    provider: SocialPlatform.GOOGLE,
    requiresPageSelection: true,
  },
  [SocialPlatform.TIKTOK]: {
    provider: SocialPlatform.TIKTOK,
    requiresPageSelection: false,
    oauthParams: { integration_type: 'SHOP' },
  },
  [SocialPlatform.YELP]: {
    provider: SocialPlatform.YELP,
    requiresPageSelection: false,
  },
  [SocialPlatform.WHATSAPP]: {
    provider: SocialPlatform.WHATSAPP,
    requiresPageSelection: false,
  },
}

const DEFAULT_STRATEGY: PlatformStrategy = {
  provider: 'unknown',
  requiresPageSelection: false,
}

export function getPlatformStrategy(platform: string): PlatformStrategy {
  const normalizedPlatform = platform.toLowerCase() as SocialPlatform
  return PLATFORM_STRATEGIES[normalizedPlatform] ?? DEFAULT_STRATEGY
}

export type { SocialConnection } from '@/types/social'
export { SocialPlatform } from '@/types/social'
