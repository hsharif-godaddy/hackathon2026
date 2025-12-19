import { useMemo } from 'react'

import { PLATFORM_TRANSFORMS } from '@/lib/social-platforms'
import type { EnrichedSocialConnection, SocialConnection } from '@/types/social'
import { SocialPlatformKey } from '@/types/social'
import { useConnectionMetadata } from './useConnectionMetadata'
import { useSocialConnections } from './useSocialV2'

interface UseSocialConnectionsWithMetadataResult {
  connections: Array<SocialConnection | EnrichedSocialConnection>
  isLoading: boolean
  isLoadingMetadata: boolean
  connectionsLoadingMetadata: Set<string>
}

interface UseSocialConnectionsWithMetadataOptions {
  platform?: string
  enabled?: boolean
}

/**
 * Fetches user social connections with metadata enrichment
 *
 * @param options.platform - Optional platform filter (e.g., 'facebook', 'google'). If omitted, fetches all platforms
 * @param options.enabled - Whether to enable the query. Defaults to true
 * @returns Connections with metadata (page names, location names, etc.), loading states
 */
export function useSocialConnectionsWithMetadata(
  options: UseSocialConnectionsWithMetadataOptions = {}
): UseSocialConnectionsWithMetadataResult {
  const { platform: platformFilter, enabled = true } = options

  // Fetch base connection data from API
  const plainConnectionsQuery = useSocialConnections(enabled)

  const plainConnections = plainConnectionsQuery.data ?? []
  const isLoadingConnections = plainConnectionsQuery.isLoading

  // Normalize platform filter for comparison
  const normalizedPlatformFilter = platformFilter ? PLATFORM_TRANSFORMS.toDisplay(platformFilter) : undefined

  // Filter connections by platform if specified
  const filteredConnections = useMemo(() => {
    if (!normalizedPlatformFilter) return plainConnections

    return plainConnections.filter((conn: SocialConnection) => {
      const connPlatform = PLATFORM_TRANSFORMS.toDisplay(conn.platform)
      return connPlatform === normalizedPlatformFilter
    })
  }, [plainConnections, normalizedPlatformFilter])

  // Determine which platforms need metadata
  const platformsToEnrich = useMemo(() => {
    if (normalizedPlatformFilter) {
      return [normalizedPlatformFilter]
    }
    return ['facebook', 'instagram', 'google', 'yelp']
  }, [normalizedPlatformFilter])

  // Group connections by platform for metadata fetching
  const connectionsByPlatform = useMemo(() => {
    const groups: Record<string, SocialConnection[]> = {
      facebook: [],
      instagram: [],
      google: [],
      yelp: []
    }

    filteredConnections.forEach(conn => {
      if (conn.platform === SocialPlatformKey.FACEBOOK) {
        groups.facebook.push(conn)
      } else if (conn.platform === SocialPlatformKey.INSTAGRAM) {
        groups.instagram.push(conn)
      } else if (conn.platform === SocialPlatformKey.GOOGLE_BUSINESS_PROFILE) {
        groups.google.push(conn)
      } else if (conn.platform === SocialPlatformKey.YELP) {
        groups.yelp.push(conn)
      }
    })

    return groups
  }, [filteredConnections])

  // Conditionally fetch metadata for each platform
  const shouldFetchFacebook = platformsToEnrich.includes('facebook') && connectionsByPlatform.facebook.length > 0
  const shouldFetchInstagram = platformsToEnrich.includes('instagram') && connectionsByPlatform.instagram.length > 0
  const shouldFetchGoogle = platformsToEnrich.includes('google') && connectionsByPlatform.google.length > 0
  const shouldFetchYelp = platformsToEnrich.includes('yelp') && connectionsByPlatform.yelp.length > 0

  const {
    enrichedConnections: facebookEnriched,
    isLoadingAnyMetadata: isLoadingFacebookMetadata,
    connectionsLoadingMetadata: facebookLoading
  } = useConnectionMetadata(connectionsByPlatform.facebook, 'facebook', enabled && shouldFetchFacebook)

  const {
    enrichedConnections: instagramEnriched,
    isLoadingAnyMetadata: isLoadingInstagramMetadata,
    connectionsLoadingMetadata: instagramLoading
  } = useConnectionMetadata(connectionsByPlatform.instagram, 'instagram', enabled && shouldFetchInstagram)

  const {
    enrichedConnections: googleEnriched,
    isLoadingAnyMetadata: isLoadingGoogleMetadata,
    connectionsLoadingMetadata: googleLoading
  } = useConnectionMetadata(connectionsByPlatform.google, 'google', enabled && shouldFetchGoogle)

  const {
    enrichedConnections: yelpEnriched,
    isLoadingAnyMetadata: isLoadingYelpMetadata,
    connectionsLoadingMetadata: yelpLoading
  } = useConnectionMetadata(connectionsByPlatform.yelp, 'yelp', enabled && shouldFetchYelp)

  // Combine enriched connections
  const enrichedConnections = useMemo(() => {
    const noMetadata = filteredConnections.filter(c =>
      c.platform === SocialPlatformKey.TIKTOK || c.platform === SocialPlatformKey.WHATSAPP
    )

    return [
      ...facebookEnriched,
      ...instagramEnriched,
      ...googleEnriched,
      ...yelpEnriched,
      ...noMetadata
    ]
  }, [facebookEnriched, instagramEnriched, googleEnriched, yelpEnriched, filteredConnections])

  // Combine loading metadata sets
  const connectionsLoadingMetadata = useMemo(() => {
    const combined = new Set<string>()
    facebookLoading.forEach(id => combined.add(id))
    instagramLoading.forEach(id => combined.add(id))
    googleLoading.forEach(id => combined.add(id))
    yelpLoading.forEach(id => combined.add(id))
    return combined
  }, [facebookLoading, instagramLoading, googleLoading, yelpLoading])

  const isLoadingMetadata =
    isLoadingFacebookMetadata ||
    isLoadingInstagramMetadata ||
    isLoadingGoogleMetadata ||
    isLoadingYelpMetadata

  return {
    connections: enrichedConnections,
    isLoading: isLoadingConnections,
    isLoadingMetadata,
    connectionsLoadingMetadata
  }
}
