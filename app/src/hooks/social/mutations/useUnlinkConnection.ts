import { useMutation, useQueryClient } from '@tanstack/react-query'

import { appFetch } from '@/lib/gasket-config'

interface UnlinkConnectionParams {
  siteId: string
  associationId: string
}

export function useUnlinkConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ siteId, associationId }: UnlinkConnectionParams) => {
      const response = await appFetch(`/api/sites/${siteId}/social/associations/${associationId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to unlink connection: ${response.status}`)
      }

      return { siteId, associationId }
    },
    onSuccess: (_, { siteId }) => {
      // Invalidate both site links and connections to refresh UI
      queryClient.invalidateQueries({ queryKey: ['site-links', siteId] })
      queryClient.invalidateQueries({ queryKey: ['social-connections'] })
    },
  })
}
