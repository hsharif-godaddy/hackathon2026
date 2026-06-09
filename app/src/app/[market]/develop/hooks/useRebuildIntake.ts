import { useMutation, useQuery } from '@tanstack/react-query'

import { buildDynamicAgentUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'

export type RebuildScope = 'homepage_only' | 'small' | 'large'

export type DesignDirection = 'keep-similar' | 'modernize' | 'simplify' | 'bold'

export interface RebuildScopeEstimate {
  scope: RebuildScope
  labelKey: string
  descriptionKey: string
  expectedMinutesMin: number
  expectedMinutesMax: number
  tokenCostMin: number
  tokenCostMax: number
  maxPagesToScrape: number
  maxPagesToBuildUpfront: number
}

export interface RebuildWorkflowStatus {
  status: string
  sourceUrl: string
  rebuildScope?: RebuildScope
  intakeCompleted: boolean
  scrapingProgress: { total: number; completed: number }
  hasStylePreferences: boolean
}

export interface SubmitRebuildIntakeInput {
  scope: RebuildScope
  designDirection: DesignDirection
}

export function useRebuildWorkflowStatus(appId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['rebuild-status', appId],
    queryFn: async () => {
      if (!appId) throw new Error('No appId')
      const url = await buildDynamicAgentUrl(`apps/${appId}/rebuild/status`, appId)
      const response = await agentFetch(url, { siteId: appId })
      if (response.status === 404) return null
      if (!response.ok) {
        throw new Error(`Failed to fetch rebuild status (${response.status})`)
      }
      return response.json() as Promise<RebuildWorkflowStatus>
    },
    enabled: !!appId && enabled,
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false
      if (query.state.data?.intakeCompleted) return false
      if (!query.state.data || query.state.data.status === 'awaiting_intake') return 500
      return false
    },
    staleTime: 0,
    retry: false,
  })
}

export function useRebuildScopeEstimates(appId: string | undefined) {
  return useQuery({
    queryKey: ['rebuild-scope-estimates', appId],
    queryFn: async () => {
      if (!appId) throw new Error('No appId')
      const url = await buildDynamicAgentUrl(`apps/${appId}/rebuild/scope-estimates`, appId)
      const response = await agentFetch(url, { siteId: appId })
      if (!response.ok) {
        throw new Error(`Failed to fetch scope estimates (${response.status})`)
      }
      const body = await response.json() as { estimates: RebuildScopeEstimate[] }
      return body.estimates
    },
    enabled: !!appId,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

export function useSubmitRebuildIntake(appId: string | undefined) {
  return useMutation({
    mutationFn: async (input: SubmitRebuildIntakeInput) => {
      if (!appId) throw new Error('No appId')
      const url = await buildDynamicAgentUrl(`apps/${appId}/rebuild/intake`, appId)
      const response = await agentFetch(url, {
        siteId: appId,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: input.scope,
          stylePreferences: {
            designDirection: input.designDirection,
            colorPreference: 'keep-original',
            typographyStyle: 'keep-original',
            layoutApproach: 'responsive',
          },
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `Intake submit failed (${response.status})`)
      }
      return response.json()
    },
  })
}
