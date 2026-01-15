import { useEffect, useState } from 'react'

import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import { useSiteStore } from '@/stores/useSiteStore'

/**
 * Hook to detect if app is in rebuild mode
 * Checks for .source-site directory via API
 */
export function useRebuildMode(appId: string | null) {
  const [isRebuildMode, setIsRebuildMode] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!appId) {
      setIsRebuildMode(false)
      setIsLoading(false)
      return
    }

    const checkRebuildMode = async () => {
      try {
        setIsLoading(true)

        const site = await useSiteStore.getState().fetchSite(appId)
        if (!site?.agent_url) {
          setIsRebuildMode(false)
          setIsLoading(false)
          return
        }

        const response = await agentFetch(`${site.agent_url}/rebuild/${appId}/status`, {
          siteId: appId
        })

        if (response.ok) {
          setIsRebuildMode(true)
        } else {
          setIsRebuildMode(false)
        }
      } catch (error) {
        setIsRebuildMode(false)
      } finally {
        setIsLoading(false)
      }
    }

    checkRebuildMode()
  }, [appId])

  return { isRebuildMode, isLoading }
}
