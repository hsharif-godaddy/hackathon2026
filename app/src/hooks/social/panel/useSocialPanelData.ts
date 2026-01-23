import { useMemo } from 'react'

import { useSiteAssociations } from '@/hooks/useSocial'
import { SOCIAL_FLOW_CONFIG } from '@/lib/social'
import { getDetailedPlatformStatuses } from '@/lib/social-platforms'
import type { EnrichedSocialConnection } from '@/types/social'
import { useSocialConnectionsWithMetadata } from '../queries/useSocialConnections'

interface UseSocialPanelDataResult {
  allConnections: EnrichedSocialConnection[]
  siteLinks: any[]
  platformStatuses: ReturnType<typeof getDetailedPlatformStatuses>
  linkedConnectionIds: Set<string>
  isLoading: boolean
  isLoadingConnections: boolean
  isLoadingSiteLinks: boolean
  error: string | null
}

/**
 * Hook for fetching and computing social panel data
 * Handles connections, site links, and platform statuses
 */
export function useSocialPanelData(siteId: string): UseSocialPanelDataResult {
  // Fetch all user connections with metadata
  const {
    connections: allConnections,
    isLoading: isLoadingConnections
  } = useSocialConnectionsWithMetadata()

  // Fetch site links
  const siteLinksQuery = useSiteAssociations(siteId)
  const siteLinks = useMemo(() => siteLinksQuery.data?.associations ?? [], [siteLinksQuery.data])
  const isLoadingSiteLinks = siteLinksQuery.isLoading

  // Create a set of linked connection IDs for quick lookup
  const linkedConnectionIds = useMemo(() =>
    new Set(siteLinks.map(link => link.socialId)),
    [siteLinks]
  )

  // Build platform statuses with all available connections
  const platformStatuses = useMemo(() =>
    getDetailedPlatformStatuses({
      connections: allConnections as EnrichedSocialConnection[],
      linkedConnectionIds,
      displayLimit: SOCIAL_FLOW_CONFIG.displayConnectionsLimit
    }),
    [allConnections, linkedConnectionIds]
  )

  // Only show loading on initial load (not on subsequent refreshes)
  const isInitialLoad =
    (isLoadingSiteLinks && siteLinks.length === 0) ||
    (isLoadingConnections && allConnections.length === 0)

  return {
    allConnections: allConnections as EnrichedSocialConnection[],
    siteLinks,
    platformStatuses,
    linkedConnectionIds,
    isLoading: isInitialLoad,
    isLoadingConnections,
    isLoadingSiteLinks,
    error: null // We'll handle errors separately if needed
  }
}
