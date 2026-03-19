import { useMemo } from 'react'

import { useSocialConnections as useSocialConnectionsQuery } from '@/hooks/useSocial'
import { PLATFORM_CONFIG, PLATFORM_TRANSFORMS } from '@/lib/social-platforms'
import type { EnrichedSocialConnection, SocialConnection } from '@/types/social'
import { SocialPlatform, SocialPlatformKey } from '@/types/social'
import { useConnectionMetadata } from './useConnectionMetadata'

const EMPTY_CONNECTIONS: SocialConnection[] = []

interface UseSocialConnectionsResult {
  connections: Array<SocialConnection | EnrichedSocialConnection>
  isLoading: boolean
  isLoadingMetadata: boolean
  connectionsLoadingMetadata: Set<string>
  error: Error | null
}

type ConnectionWithMetadata = Partial<{
  pageName: string
  locationName: string
  shopName: string
  businessName: string
}>

function hasMetadata(conn: SocialConnection | EnrichedSocialConnection): conn is EnrichedSocialConnection {
  const enriched = conn as ConnectionWithMetadata
  return !!(
    enriched.pageName ||
    enriched.locationName ||
    enriched.shopName ||
    enriched.businessName
  )
}

interface UseSocialConnectionsOptions {
  platform?: string
  enabled?: boolean
}

/**
 * Fetches user social connections with metadata enrichment.
 * Returns only valid connections (with metadata, no errors) by default.
 *
 * @param options.platform - Optional platform filter (e.g., 'facebook', 'google'). If omitted, fetches all platforms
 * @param options.enabled - Whether to enable the query. Defaults to true
 * @returns Valid connections with metadata (page names, location names, etc.), loading states
 */
export function useSocialConnections(
  options: UseSocialConnectionsOptions = {}
): UseSocialConnectionsResult {
  const { platform: platformFilter, enabled = true } = options

  // Fetch base connection data from API
  const plainConnectionsQuery = useSocialConnectionsQuery(enabled)

  const plainConnections = plainConnectionsQuery.data ?? EMPTY_CONNECTIONS
  const isLoadingConnections = plainConnectionsQuery.isLoading

  // Normalize platform filter for comparison
  const normalizedPlatformFilter = platformFilter ? PLATFORM_TRANSFORMS.toDisplay(platformFilter) : undefined

  // Filter connections by platform if specified
  const filteredConnections = useMemo(() => {
    if (!normalizedPlatformFilter) {return plainConnections}

    return plainConnections.filter((conn: SocialConnection) => {
      const connPlatform = PLATFORM_TRANSFORMS.toDisplay(conn.platform)
      return connPlatform === normalizedPlatformFilter
    })
  }, [plainConnections, normalizedPlatformFilter])

  // Determine which platforms need metadata
  // Use PLATFORM_CONFIG to only fetch metadata for platforms shown in UI
  const platformsToEnrich = useMemo(() => {
    if (normalizedPlatformFilter) {
      return [normalizedPlatformFilter]
    }
    return Object.keys(PLATFORM_CONFIG) as SocialPlatform[]
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
  const shouldFetchFacebook = platformsToEnrich.includes(SocialPlatform.FACEBOOK) && connectionsByPlatform.facebook.length > 0
  const shouldFetchInstagram = platformsToEnrich.includes(SocialPlatform.INSTAGRAM) && connectionsByPlatform.instagram.length > 0
  const shouldFetchGoogle = platformsToEnrich.includes(SocialPlatform.GOOGLE) && connectionsByPlatform.google.length > 0
  const shouldFetchYelp = platformsToEnrich.includes(SocialPlatform.YELP) && connectionsByPlatform.yelp.length > 0

  const {
    enrichedConnections: facebookEnriched,
    isLoadingAnyMetadata: isLoadingFacebookMetadata,
    connectionsLoadingMetadata: facebookLoading,
    connectionsWithErrors: facebookErrors
  } = useConnectionMetadata(connectionsByPlatform.facebook, SocialPlatform.FACEBOOK, enabled && shouldFetchFacebook)

  const {
    enrichedConnections: instagramEnriched,
    isLoadingAnyMetadata: isLoadingInstagramMetadata,
    connectionsLoadingMetadata: instagramLoading,
    connectionsWithErrors: instagramErrors
  } = useConnectionMetadata(connectionsByPlatform.instagram, SocialPlatform.INSTAGRAM, enabled && shouldFetchInstagram)

  const {
    enrichedConnections: googleEnriched,
    isLoadingAnyMetadata: isLoadingGoogleMetadata,
    connectionsLoadingMetadata: googleLoading,
    connectionsWithErrors: googleErrors
  } = useConnectionMetadata(connectionsByPlatform.google, SocialPlatform.GOOGLE, enabled && shouldFetchGoogle)

  const {
    enrichedConnections: yelpEnriched,
    isLoadingAnyMetadata: isLoadingYelpMetadata,
    connectionsLoadingMetadata: yelpLoading,
    connectionsWithErrors: yelpErrors
  } = useConnectionMetadata(connectionsByPlatform.yelp, SocialPlatform.YELP, enabled && shouldFetchYelp)

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

  // Combine error sets from all platform metadata fetches
  // Connections with errors are excluded from UI to prevent showing broken/incomplete data
  const connectionsWithErrors = useMemo(() => {
    const combined = new Set<string>()
    facebookErrors.forEach(id => combined.add(id))
    instagramErrors.forEach(id => combined.add(id))
    googleErrors.forEach(id => combined.add(id))
    yelpErrors.forEach(id => combined.add(id))
    return combined
  }, [facebookErrors, instagramErrors, googleErrors, yelpErrors])

  const isLoadingMetadata =
    isLoadingFacebookMetadata ||
    isLoadingInstagramMetadata ||
    isLoadingGoogleMetadata ||
    isLoadingYelpMetadata

  /**
   * Filter connections based on metadata availability and error state
   *
   * Business rules for connection visibility:
   * 1. EXCLUDE: Connections with metadata fetch errors (token issues, API errors, permission problems)
   *    - These would show incomplete/broken UI if displayed
   *    - User needs to reconnect/fix permissions before they can be used
   *
   * 2. INCLUDE: Connections currently loading metadata
   *    - Shows skeleton UI while fetching
   *    - Provides immediate feedback that connection exists
   *
   * 3. INCLUDE: Connections with successful metadata (pageName, locationName, shopName, businessName)
   *    - Ready to display with full information
   *    - Can be selected for posting/linking
   *
   * 4. INCLUDE: Platforms that don't require metadata (TikTok, WhatsApp)
   *    - These platforms are valid without metadata enrichment
   *    - Can be displayed and used without additional API calls
   *
   * 5. EXCLUDE: Connections without metadata that aren't loading (for platforms that require metadata)
   *    - Indicates metadata fetch completed but returned no data
   *    - Cannot be meaningfully displayed or used
   */
  const validConnections = useMemo(() => {
    return enrichedConnections.filter(conn => {
      if (connectionsWithErrors.has(conn.socialId)) {
        return false
      }

      if (connectionsLoadingMetadata.has(conn.socialId)) {
        return true
      }

      const platformRequiresMetadata =
        conn.platform !== SocialPlatformKey.TIKTOK &&
        conn.platform !== SocialPlatformKey.WHATSAPP

      if (!platformRequiresMetadata) {
        return true
      }

      return hasMetadata(conn)
    })
  }, [enrichedConnections, connectionsWithErrors, connectionsLoadingMetadata])

  return {
    connections: validConnections,
    isLoading: isLoadingConnections,
    isLoadingMetadata,
    connectionsLoadingMetadata,
    error: plainConnectionsQuery.error
  }
}
