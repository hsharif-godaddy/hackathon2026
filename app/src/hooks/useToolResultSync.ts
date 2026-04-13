'use client'

import { useCallback } from 'react'

import { buildDynamicAgentUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'

export interface ToolResultSyncParams {
  conversationId: string | null
  toolId: string
  appId: string
}

export function useToolResultSync(params: ToolResultSyncParams) {
  const { conversationId, toolId, appId } = params

  const syncResult = useCallback(async <T = unknown>(state: T): Promise<boolean> => {
    if (!conversationId || !toolId || !appId) {
      logger.warn('tool-result-sync.missing-params', {
        hasConversationId: !!conversationId,
        hasToolId: !!toolId,
        hasAppId: !!appId
      })
      return false
    }

    try {
      const url = await buildDynamicAgentUrl(
        `api/conversations/${conversationId}/tools/${toolId}?appId=${appId}`,
        appId
      )

      if (!url || typeof url !== 'string' || !url.startsWith('http')) {
        logger.error('tool-result-sync.invalid-url', { url, conversationId, toolId, appId })
        return false
      }

      const response = await agentFetch(url, {
        siteId: appId,
        method: 'PATCH',
        body: JSON.stringify({ result: state })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to sync tool result: ${response.status} - ${errorText}`)
      }

      logger.debug('tool-result-sync.success', {
        conversationId,
        toolId,
        appId
      })

      return true
    } catch (error) {
      logger.error('tool-result-sync.error', {
        conversationId,
        toolId,
        appId,
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }, [conversationId, toolId, appId])

  return syncResult
}
