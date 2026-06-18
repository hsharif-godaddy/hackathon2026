/**
 * Chat Helper Utilities Hook
 *
 * Provides transport-neutral utility functions for chat operations including:
 * - Session storage management
 * - Cookie management for conversation IDs
 * - Commit completion handling
 * - Tool impression tracking
 */

import { validate as validateUUID } from 'uuid'

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
  if (typeof document === 'undefined' || !appId) return null

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
  if (typeof document === 'undefined') return

  const cookieName = getConversationIdCookieName(appId)
  // 7-day expiration for tab-closure recovery
  document.cookie = `${cookieName}=${encodeURIComponent(conversationId)}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`
}

/**
 * Delete conversationId cookie from browser
 */
export function clearConversationIdCookie(appId: string | null): void {
  if (typeof document === 'undefined' || !appId) return

  const cookieName = getConversationIdCookieName(appId)
  // Delete cookie by setting it with past expiration date
  document.cookie = `${cookieName}=; path=/; max-age=0; SameSite=Lax`
}

/**
 * Send tool impression event for analytics
 * Standalone version for use outside React
 */
export function sendToolImpressionEvent(tool: string): void {
  logImpressionEvent(`develop.tool.${tool}`)()
}
