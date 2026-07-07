import { useMemo } from 'react'

import { useConnectionById, useSiteAssociations } from '@/hooks/useSocial'
import { PLATFORM_TRANSFORMS } from '@/lib/social-platforms'
import type { EnrichedSocialConnection, SocialConnection } from '@/types/social'
import { useSocialConnections } from '../queries/useSocialConnections'

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

  // Fetch site links first so a linked connection wins entity dedup below
  const siteLinksQuery = useSiteAssociations(appId, enabled)
  const siteLinks = useMemo(() => siteLinksQuery.data?.associations ?? [], [siteLinksQuery.data])
  const isLoadingSiteLinks = siteLinksQuery.isLoading
  const isFetchingSiteLinks = siteLinksQuery.isFetching

  const linkedConnectionIds = useMemo(() => {
    return new Set<string>(siteLinks.map(link => link.socialId))
  }, [siteLinks])

  // Fetch connections with metadata for this platform only
  const {
    connections: enrichedConnections,
    isLoading: isLoadingConnections,
    isLoadingMetadata: isLoadingPlatformMetadata,
    connectionsLoadingMetadata
  } = useSocialConnections({ platform, enabled, linkedConnectionIds })

  // Find the current site link for this platform
  const currentSiteLink = useMemo(() => {
    return siteLinks.find(link => PLATFORM_TRANSFORMS.toDisplay(link.platform) === normalizedPlatform)
  }, [siteLinks, normalizedPlatform])

  // Fetch the currently linked connection details
  const { data: currentConnectionDetails, isLoading: isLoadingCurrentConnection } = useConnectionById(
    currentSiteLink?.socialId || '',
    !!currentSiteLink?.socialId
  )

  const linkedConnection = useMemo(() => {
    if (!currentConnectionDetails) return undefined
    // Try to find in enriched array first
    const enriched = enrichedConnections.find(c => c.socialId === currentConnectionDetails.socialId)
    return enriched || currentConnectionDetails
  }, [currentConnectionDetails, enrichedConnections])

  // Plain connections (without metadata enrichment)
  const availableConnections = enrichedConnections as SocialConnection[]

  const isLoadingMetadata = isLoadingPlatformMetadata
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
