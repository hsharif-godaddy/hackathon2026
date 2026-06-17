import { useQuery } from '@tanstack/react-query'

import { dynamicApiConfigService } from '@/config/dynamic-api'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { logger } from '@/lib/request-context'

export interface AppPage {
  slug: string
  title: string
  route: string
}

interface UseAppPagesOptions {
  appId: string | null
  enabled?: boolean
}

interface UseAppPagesResult {
  pages: AppPage[]
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useAppPages({ appId, enabled = true }: UseAppPagesOptions): UseAppPagesResult {
  const query = useQuery({
    queryKey: ['appPages', appId],
    queryFn: async (): Promise<AppPage[]> => {
      if (!appId) return []

      try {
        const tokenResult = await regenerateToken({ siteId: appId, force: true })
        const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)

        if (!apiConfig.agentUrl) {
          throw new Error('Agent URL not available')
        }

        const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')

        const response = await fetch(`${baseAgentUrl}/media/${appId}/pages`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${tokenResult.token}` },
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
          throw new Error(errorData.error || `Failed to fetch pages: ${response.status}`)
        }

        const data = await response.json()
        return Array.isArray(data.pages) ? data.pages : []
      } catch (error) {
        logger.error('hook.app_pages.fetch.error', {
          appId,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    },
    enabled: enabled && !!appId,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  })

  return {
    pages: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: async () => { await query.refetch() },
  }
}
