import { useMutation, useQueryClient } from '@tanstack/react-query'

import { appFetch } from '@/lib/gasket-config'
import { PLATFORM_TRANSFORMS } from '@/lib/social-platforms'

interface LinkConnectionParams {
  siteId: string
  socialId: string
  platform: string
}

interface LinkConnectionResponse {
  association: {
    id: string
    site_id: string
    social_id: string
    platform: string
    created_at: string
  }
}

export function useLinkConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ siteId, socialId, platform }: LinkConnectionParams) => {
      const apiPlatform = PLATFORM_TRANSFORMS.toApiEnum(platform)

      const response = await appFetch(`/api/sites/${siteId}/social/associations`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ socialId, platform: apiPlatform }),
      })

      if (!response.ok) {
        throw new Error(`Failed to link connection: ${response.status}`)
      }

      const data: LinkConnectionResponse = await response.json()
      return data.association
    },
    onSuccess: (_, { siteId }) => {
      // Invalidate both site links and connections to refresh UI
      queryClient.invalidateQueries({ queryKey: ['site-links', siteId] })
      queryClient.invalidateQueries({ queryKey: ['social-connections'] })
    },
  })
}
