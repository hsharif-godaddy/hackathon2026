'use client'

import { useEffect } from 'react'

import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import { isValidWorkflowState, useWorkflowProgressStore } from '@/stores/useWorkflowProgressStore'

export function useWorkflowHydration(appId: string | null): void {
  useEffect(() => {
    if (!appId) return

    const controller: AbortController = new AbortController()

    async function fetchWorkflowState(siteId: string): Promise<void> {
      try {
        const apiUrl: string = await buildDynamicApiUrl('workflow', siteId)
        const response: Response = await agentFetch(apiUrl, {
          siteId,
          method: 'GET',
          signal: controller.signal,
        })

        if (response.ok) {
          const state: unknown = await response.json()
          if (isValidWorkflowState(state)) {
            useWorkflowProgressStore.getState().hydrateFromApi(state)
          }
        }
        // 404 is expected (no workflow) — do nothing
      } catch (error: unknown) {
        if ((error as Error).name === 'AbortError') return
        logger.debug('workflowHydration.fetch.failed', {
          appId: siteId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    fetchWorkflowState(appId)

    const handleRefresh = (event: Event): void => {
      const detail = (event as CustomEvent<{ appId: string }>).detail
      if (detail.appId === appId) {
        fetchWorkflowState(appId)
      }
    }

    window.addEventListener('workflow-refresh', handleRefresh)

    return () => {
      controller.abort()
      window.removeEventListener('workflow-refresh', handleRefresh)
    }
  }, [appId])
}
