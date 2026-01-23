import { useMutation, useQueryClient } from '@tanstack/react-query'

import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'

interface UnlinkConnectionParams {
  siteId: string
  associationId: string
}

export function useUnlinkConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ siteId, associationId }: UnlinkConnectionParams) => {
      const apiUrl = await buildDynamicApiUrl(`social/associations/${associationId}`, siteId)
      const response = await agentFetch(apiUrl, {
        siteId,
        method: 'DELETE'
      })

      if (!response.ok) {
        throw new Error(`Failed to unlink connection: ${response.status}`)
      }

      return { siteId, associationId }
    },
    onSuccess: (_, { siteId }) => {
      queryClient.invalidateQueries({ queryKey: ['site-associations', siteId] })
      queryClient.invalidateQueries({ queryKey: ['social-connections'] })
    },
  })
}
