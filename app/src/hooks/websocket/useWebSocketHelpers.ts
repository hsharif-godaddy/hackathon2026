/**
 * WebSocket Helper Utilities Hook
 *
 * Provides utility functions for WebSocket operations including:
 * - Session storage management
 * - Cookie management for conversation IDs
 * - Commit completion handling
 * - Tool impression tracking
 */

import { useCallback } from 'react'
import { validate as validateUUID } from 'uuid'
import { useQueryClient } from '@tanstack/react-query'

import { logger } from '@/lib/request-context'
import { useGitStore } from '@/stores/useGitStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { logImpressionEvent } from '@/utils/instrumentation'

/**
 * Get the per-app cookie name for conversationId
 */
function getConversationIdCookieName(appId: string): string {
  return `conversationId_${appId}`
}

/**
 * Get conversationId from per-app browser cookie
 */
export function getConversationIdFromCookie(appId: string | null): string | null {
  if (typeof document === 'undefined' || !appId) {return null}

  const cookieName = getConversationIdCookieName(appId)
  const cookies = document.cookie.split(';')
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=')
    if (name === cookieName && value) {
      const decodedValue = decodeURIComponent(value)
      if (validateUUID(decodedValue)) {
        return decodedValue
      }
    }
  }
  return null
}

/**
 * Set conversationId in per-app browser cookie
 */
export function setConversationIdCookie(appId: string, conversationId: string): void {
  if (typeof document === 'undefined') {return}

  const cookieName = getConversationIdCookieName(appId)
  // 7-day expiration for tab-closure recovery
  document.cookie = `${cookieName}=${encodeURIComponent(conversationId)}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`
}

/**
 * Delete conversationId cookie from browser
 */
export function clearConversationIdCookie(appId: string | null): void {
  if (typeof document === 'undefined' || !appId) {return}

  const cookieName = getConversationIdCookieName(appId)
  // Delete cookie by setting it with past expiration date
  document.cookie = `${cookieName}=; path=/; max-age=0; SameSite=Lax`
}

/**
 * Clear stored socket ID from sessionStorage
 * Standalone version for use outside React
 */
export function clearStoredSocketIdForApp(appId: string | null): void {
  if (!appId) {return}
  const key = `socket_id_${appId}`
  const existingValue = sessionStorage.getItem(key)
  sessionStorage.removeItem(key)
  logger.debug('websocket.socket_id.cleared', {
    appId,
    key,
    previousValue: existingValue,
  })
}

/**
 * Send tool impression event for analytics
 * Standalone version for use outside React
 */
export function sendToolImpressionEvent(tool: string): void {
  logImpressionEvent(`develop.tool.${tool}`)()
}

export interface UseWebSocketHelpersReturn {
  /**
   * Clear stored socket ID from sessionStorage
   */
  clearStoredSocketId: () => void

  /**
   * Handle commit completion: invalidate git queries, sync selection, trigger preview refresh
   */
  handleCommitComplete: (commitHash?: string) => Promise<void>

  /**
   * Send tool impression event for analytics
   */
  sendToolImpression: (tool: string) => void
}

/**
 * Hook providing utility functions for WebSocket operations
 */
export function useWebSocketHelpers(currentAppId: string | null): UseWebSocketHelpersReturn {
  const queryClient = useQueryClient()

  /**
   * Helper function to clear stored socket ID from sessionStorage
   * Called on stream completion, errors, and cleanup to prevent stale recovery attempts
   */
  const clearStoredSocketId = useCallback(() => {
    if (currentAppId) {
      const key = `socket_id_${currentAppId}`
      const existingValue = sessionStorage.getItem(key)
      sessionStorage.removeItem(key)
      logger.debug('websocket.socket_id.cleared', {
        appId: currentAppId,
        key,
        previousValue: existingValue
      })
    }
  }, [currentAppId])

  /**
   * Handle commit completion: invalidate git history, update selected commit state, trigger preview refresh
   *
   * Note: We only update the UI state here, not call the checkout API. The backend already has
   * the working directory in the correct state after committing. Calling checkout would be
   * redundant and can cause race conditions with ongoing file operations.
   *
   * Preview refresh is only triggered when the agent isn't actively streaming, to avoid
   * refreshing while changes are still in progress.
   */
  const handleCommitComplete = useCallback(
    async (commitHash?: string) => {
      if (commitHash && currentAppId) {
        // Invalidate to get fresh commit list
        await queryClient.invalidateQueries({
          queryKey: ['git-history', currentAppId],
          refetchType: 'active',
        })

        // Invalidate secrets diff — agent may have added/removed secrets during this turn
        await queryClient.invalidateQueries({
          queryKey: ['secretsDiff', currentAppId],
          refetchType: 'active',
        })

        // Update UI state to reflect the new commit (no API call needed - backend is already there)
        useGitStore.getState().setSelectedCommitHash(currentAppId, commitHash)

        // Only trigger preview refresh if agent isn't actively streaming
        // This prevents premature refreshes while changes are still in progress
        const { streamingState, activeStream } = useStreamingConversationStore.getState()
        const isAgentRunning = streamingState === 'streaming' && !!activeStream

        if (!isAgentRunning) {
          window.postMessage(
            {
              type: 'MESSAGE_COMPLETE',
              source: 'websocket',
            },
            window.location.origin
          )
        }
      }
    },
    [currentAppId, queryClient]
  )

  /**
   * Send tool impression event for analytics
   */
  const sendToolImpression = useCallback((tool: string) => {
    logImpressionEvent(`develop.tool.${tool}`)()
  }, [])

  return {
    clearStoredSocketId,
    handleCommitComplete,
    sendToolImpression,
  }
}
