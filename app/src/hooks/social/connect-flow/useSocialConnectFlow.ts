import { useMemo } from 'react'

import { useConnectionById, useSiteAssociations } from '@/hooks/useSocial'
import { PLATFORM_TRANSFORMS } from '@/lib/social-platforms'
import type { EnrichedSocialConnection, SocialConnection } from '@/types/social'
import { useSocialConnectionsWithMetadata } from '../queries/useSocialConnections'

interface UseSocialConnectFlowParams {
  platform: string
  appId: string
  enabled: boolean
}

interface UseSocialConnectFlowResult {
  isLoading: boolean
  siteLinks: any[]
  availableConnections: SocialConnection[]
  enrichedConnections: Array<SocialConnection | EnrichedSocialConnection>
  currentSiteLink: any | undefined
  linkedConnection: SocialConnection | undefined
  isLoadingMetadata: boolean
  connectionsLoadingMetadata: Set<string>
}

/**
 * Hook for social connect flow
 * Combines connections with metadata, site links, and current linked connection
 */
export function useSocialConnectFlow({
  platform,
  appId,
  enabled
}: UseSocialConnectFlowParams): UseSocialConnectFlowResult {
  const normalizedPlatform = PLATFORM_TRANSFORMS.toDisplay(platform)

  // Fetch connections with metadata for this platform only
  const {
    connections: enrichedConnections,
    isLoading: isLoadingConnections,
    isLoadingMetadata: isLoadingPlatformMetadata,
    connectionsLoadingMetadata
  } = useSocialConnectionsWithMetadata({ platform, enabled })

  // Fetch site links
  const siteLinksQuery = useSiteAssociations(appId, enabled)
  const siteLinks = siteLinksQuery.data?.associations ?? [] // eslint-disable-line react-hooks/exhaustive-deps
  const isLoadingSiteLinks = siteLinksQuery.isLoading
  const isFetchingSiteLinks = siteLinksQuery.isFetching

  // Find the current site link for this platform
  const currentSiteLink = useMemo(() => {
    return siteLinks.find(link => PLATFORM_TRANSFORMS.toDisplay(link.platform) === normalizedPlatform)
  }, [siteLinks, normalizedPlatform])

  // Fetch the currently linked connection details
  const { data: currentConnectionDetails, isLoading: isLoadingCurrentConnection } = useConnectionById(
    currentSiteLink?.socialId || '',
    !!currentSiteLink?.socialId
  )

  // Enrich the currently linked connection with metadata (if not already in enrichedConnections)
  const {
    connections: enrichedCurrentArray,
    isLoadingMetadata: isLoadingCurrentMetadata
  } = useSocialConnectionsWithMetadata({
    platform,
    enabled: enabled && !!currentConnectionDetails
  })

  const linkedConnection = useMemo(() => {
    if (!currentConnectionDetails) return undefined
    // Try to find in enriched array first
    const enriched = enrichedCurrentArray.find(c => c.socialId === currentConnectionDetails.socialId)
    return enriched || currentConnectionDetails
  }, [currentConnectionDetails, enrichedCurrentArray])

  // Plain connections (without metadata enrichment)
  const availableConnections = enrichedConnections as SocialConnection[]

  const isLoadingMetadata = isLoadingPlatformMetadata || isLoadingCurrentMetadata
  const isLoading =
    isLoadingSiteLinks ||
    isLoadingConnections ||
    isLoadingCurrentConnection ||
    isFetchingSiteLinks

  return {
    isLoading,
    siteLinks,
    availableConnections,
    enrichedConnections,
    currentSiteLink,
    linkedConnection,
    isLoadingMetadata,
    connectionsLoadingMetadata
  }
}
