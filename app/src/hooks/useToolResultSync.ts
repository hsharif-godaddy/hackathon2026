'use client'

import { useEffect, useMemo, useRef } from 'react'

import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { getRootDomain } from '@/utils/getRootDomain'

const AGENTS_BASE_URL = `https://airo-builder-api.${getRootDomain() || 'godaddy.com'}`

export interface ToolResultSyncParams {
  conversationId: string | null
  toolId: string
  appId: string
}

export interface UseToolResultSyncOptions {
  debounceMs?: number
  enabled?: boolean
  onSuccess?: () => void
  onError?: (error: Error) => void
}

export function useToolResultSync<T = unknown>(
  state: T,
  params: ToolResultSyncParams,
  options: UseToolResultSyncOptions = {}
) {
  const {
    debounceMs = 500,
    enabled = true,
    onSuccess,
    onError
  } = options

  const { conversationId, toolId, appId } = params
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const lastSyncedStateRef = useRef<string | undefined>(undefined)

  const stateJson = useMemo(() => JSON.stringify(state), [state])

  useEffect(() => {
    if (!enabled || !conversationId || !toolId || !appId) {
      return
    }

    if (stateJson === lastSyncedStateRef.current) {
      return
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(async () => {
      try {
        const response = await appFetch(
          `${AGENTS_BASE_URL}/api/conversations/${conversationId}/tools/${toolId}?appId=${appId}`,
          {
            method: 'PATCH',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ result: state })
          }
        )

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Failed to sync tool result: ${response.status} - ${errorText}`)
        }

        lastSyncedStateRef.current = stateJson

        logger.debug('tool-result-sync.success', {
          conversationId,
          toolId,
          appId
        })

        onSuccess?.()
      } catch (error) {
        logger.error('tool-result-sync.error', {
          conversationId,
          toolId,
          appId,
          error: error instanceof Error ? error.message : String(error)
        })

        const err = error instanceof Error ? error : new Error(String(error))
        onError?.(err)
      }
    }, debounceMs)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [stateJson, conversationId, toolId, appId, debounceMs, enabled, onSuccess, onError, state])
}
