'use client'

import { useCallback } from 'react'
import type { QueryClient, UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  CAMPAIGNS_QUERY_KEY,
  deleteCampaignRequest,
  fetchCampaignList,
} from '@/app/[market]/develop/components/settings/Campaigns/campaigns-cache'
import type { Campaign } from '@/app/[market]/develop/components/settings/Campaigns/types'
import { logger } from '@/lib/request-context'

interface UseCampaignsResult {
  campaigns: Campaign[]
  loading: boolean
  error: string | null
  fetchCampaigns: () => Promise<void>
  deleteCampaign: (campaignId: string) => Promise<boolean>
  getCampaignById: (campaignId: string) => Campaign | null
}

export function useCampaigns(appId: string | undefined): UseCampaignsResult {
  const queryClient: QueryClient = useQueryClient()

  const query: UseQueryResult<Campaign[], Error> = useQuery({
    queryKey: [CAMPAIGNS_QUERY_KEY, appId],
    queryFn: () => fetchCampaignList(appId!),
    enabled: !!appId,
    staleTime: 60_000,
    retry: 1,
  })

  const deleteMutation: UseMutationResult<boolean, Error, string> = useMutation({
    mutationFn: (campaignId: string) => deleteCampaignRequest(appId!, campaignId),
    onSuccess: (deleted: boolean, campaignId: string) => {
      if (!deleted) return
      queryClient.setQueryData<Campaign[]>(
        [CAMPAIGNS_QUERY_KEY, appId],
        (old: Campaign[] | undefined) => (old ?? []).filter((c: Campaign) => c.id !== campaignId),
      )
    },
    onError: (error: Error) => {
      logger.warn('campaigns.delete.failed', { appId, error })
    },
  })

  const fetchCampaigns: () => Promise<void> = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: [CAMPAIGNS_QUERY_KEY, appId] })
  }, [queryClient, appId])

  const deleteCampaign: (campaignId: string) => Promise<boolean> = useCallback(async (campaignId: string): Promise<boolean> => {
    try {
      return await deleteMutation.mutateAsync(campaignId)
    } catch {
      return false
    }
  }, [deleteMutation])

  const getCampaignById: (campaignId: string) => Campaign | null = useCallback(
    (campaignId: string): Campaign | null => (query.data ?? []).find((c: Campaign) => c.id === campaignId) ?? null,
    [query.data],
  )

  return {
    campaigns: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? String(query.error.message) : null,
    fetchCampaigns,
    deleteCampaign,
    getCampaignById,
  }
}
