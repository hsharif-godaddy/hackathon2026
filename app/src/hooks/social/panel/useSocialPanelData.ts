import { useMemo } from 'react'

import { useSiteAssociations } from '@/hooks/useSocial'
import { SOCIAL_FLOW_CONFIG } from '@/lib/social'
import { getDetailedPlatformStatuses } from '@/lib/social-platforms'
import type { EnrichedSocialConnection } from '@/types/social'
import { useSocialConnections } from '../queries/useSocialConnections'

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
  // Fetch site links first to know which connections are linked
  const siteLinksQuery = useSiteAssociations(siteId)
  const siteLinks = useMemo(() => siteLinksQuery.data?.associations ?? [], [siteLinksQuery.data])
  const isLoadingSiteLinks = siteLinksQuery.isLoading

  // Create a set of linked connection IDs
  const linkedConnectionIds = useMemo(() => {
    return new Set(siteLinks.map(link => link.socialId))
  }, [siteLinks])

  // Fetch all user connections with metadata enrichment
  const {
    connections: validConnections,
    isLoading: isLoadingConnections,
    error: connectionsError
  } = useSocialConnections({ linkedConnectionIds })

  // Build platform statuses with valid connections only
  const platformStatuses = useMemo(() => {
    return getDetailedPlatformStatuses({
      connections: validConnections as EnrichedSocialConnection[],
      linkedConnectionIds,
      displayLimit: SOCIAL_FLOW_CONFIG.displayConnectionsLimit
    })
  }, [validConnections, linkedConnectionIds])

  // Only show loading on initial load (not on subsequent refreshes)
  const isInitialLoad =
    (isLoadingSiteLinks && siteLinks.length === 0) ||
    (isLoadingConnections && validConnections.length === 0)

  const error = connectionsError?.message || siteLinksQuery.error?.message || null

  return {
    allConnections: validConnections as EnrichedSocialConnection[],
    siteLinks,
    platformStatuses,
    linkedConnectionIds,
    isLoading: isInitialLoad,
    isLoadingConnections,
    isLoadingSiteLinks,
    error
  }
}
