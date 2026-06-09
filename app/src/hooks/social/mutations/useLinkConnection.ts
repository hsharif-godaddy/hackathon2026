import { useMutation, useQueryClient } from '@tanstack/react-query'

import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'
import { PLATFORM_TRANSFORMS } from '@/lib/social-platforms'

interface LinkConnectionParams {
  siteId: string
  socialId: string
  platform: string
}

interface LinkConnectionResponse {
  association: {
    id: string
    appId: string
    socialId: string
    platform: string
    createdAt: string
  }
}

export function useLinkConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ siteId, socialId, platform }: LinkConnectionParams) => {
      const apiPlatform = PLATFORM_TRANSFORMS.toApiEnum(platform)
      const apiUrl = await buildDynamicApiUrl('social/associations', siteId)

      const response = await agentFetch(apiUrl, {
        siteId,
        method: 'POST',
        body: JSON.stringify({ socialId, platform: apiPlatform })
      })

      if (!response.ok) {
        throw new Error(`Failed to link connection: ${response.status}`)
      }

      const data: LinkConnectionResponse = await response.json()
      return data.association
    },
    onSuccess: (_, { siteId }) => {
      queryClient.invalidateQueries({ queryKey: ['site-associations', siteId] })
      queryClient.invalidateQueries({ queryKey: ['social-connections'], refetchType: 'all' })
    },
  })
}
