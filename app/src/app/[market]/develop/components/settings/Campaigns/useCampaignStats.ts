'use client'

import type { UseQueryResult } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'

import {
  CAMPAIGN_STATS_QUERY_KEY,
  fetchCampaignStatsList,
} from '@/app/[market]/develop/components/settings/Campaigns/campaign-stats'
import type { CampaignStats } from '@/app/[market]/develop/components/settings/Campaigns/types'

interface UseCampaignStatsListResult {
  statsByRef: Record<string, CampaignStats>
  loading: boolean
  error: boolean
}

/**
 * Load performance stats for many campaigns in one batched request, returning a map
 * keyed by campaign ref. Disabled until the appId and at least one ref are known. The
 * query key folds in the sorted refs so adding/removing campaigns refetches correctly.
 */
export function useCampaignStatsList(
  appId: string | undefined,
  campaignRefIds: string[],
): UseCampaignStatsListResult {
  const refsKey: string = [...campaignRefIds].sort().join(',')

  const query: UseQueryResult<Record<string, CampaignStats>, Error> = useQuery({
    queryKey: [CAMPAIGN_STATS_QUERY_KEY, 'list', appId, refsKey],
    queryFn: (): Promise<Record<string, CampaignStats>> => fetchCampaignStatsList(appId!, campaignRefIds),
    enabled: !!appId && campaignRefIds.length > 0,
    staleTime: 60_000,
    retry: 1,
  })

  return {
    statsByRef: query.data ?? {},
    loading: query.isLoading && query.fetchStatus !== 'idle',
    error: !!query.error,
  }
}
