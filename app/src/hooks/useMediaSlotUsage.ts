import { useQuery } from '@tanstack/react-query'

import { dynamicApiConfigService } from '@/config/dynamic-api'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { logger } from '@/lib/request-context'

/** Map of page route → ordered list of slot paths rendered on that page. */
export type SlotUsageByRoute = Record<string, string[]>

interface UseMediaSlotUsageOptions {
  appId: string | null
  enabled?: boolean
}

interface UseMediaSlotUsageResult {
  usageByRoute: SlotUsageByRoute
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

/**
 * Fetches the deterministic `route → slot[]` usage map for an app. The backend
 * computes this by static source analysis of each page's import closure, so the
 * result is stable and complete on first load (no preview navigation required).
 */
export function useMediaSlotUsage({
  appId,
  enabled = true,
}: UseMediaSlotUsageOptions): UseMediaSlotUsageResult {
  const query = useQuery({
    queryKey: ['mediaSlotUsage', appId],
    queryFn: async (): Promise<SlotUsageByRoute> => {
      if (!appId) return {}

      try {
        const tokenResult = await regenerateToken({ siteId: appId, force: true })
        const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)

        if (!apiConfig.agentUrl) {
          throw new Error('Agent URL not available')
        }

        const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')

        const response = await fetch(`${baseAgentUrl}/media/${appId}/slot-usage`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${tokenResult.token}` },
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
          throw new Error(errorData.error || `Failed to fetch slot usage: ${response.status}`)
        }

        const data = await response.json()
        return data.usageByRoute && typeof data.usageByRoute === 'object' ? data.usageByRoute : {}
      } catch (error) {
        logger.error('hook.media_slot_usage.fetch.error', {
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
    usageByRoute: query.data ?? {},
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: async () => {
      await query.refetch()
    },
  }
}
