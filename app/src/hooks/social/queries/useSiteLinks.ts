import { useQuery } from '@tanstack/react-query'

import { appFetch } from '@/lib/gasket-config'

const FIVE_MINUTES = 5 * 60 * 1000
const THIRTY_MINUTES = 30 * 60 * 1000

interface SiteLink {
  id: string
  site_id: string
  social_id: string
  platform: string
  created_at: string
}

interface SiteLinksResponse {
  associations: SiteLink[]
}

async function fetchSiteLinks(siteId: string): Promise<SiteLink[]> {
  const response = await appFetch(`/api/sites/${siteId}/social/associations`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch site links: ${response.status}`)
  }

  const data: SiteLinksResponse = await response.json()
  return data.associations || []
}

export function useSiteLinks(siteId: string, enabled = true) {
  return useQuery({
    queryKey: ['site-links', siteId],
    queryFn: () => fetchSiteLinks(siteId),
    staleTime: FIVE_MINUTES,
    gcTime: THIRTY_MINUTES,
    enabled: enabled && !!siteId
  })
}
