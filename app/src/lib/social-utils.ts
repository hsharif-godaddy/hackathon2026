import { getErrorMessage } from '@/lib/errors'
import { logger } from '@/lib/request-context'
import { isFacebookConnection, isGoogleConnection, isInstagramConnection, isTikTokConnection, isYelpConnection } from '@/lib/utils/social-type-guards'
import type { EnrichedSocialConnection,SocialConnection } from '@/types/social'
import { SocialFlowAction } from '@/types/social'

export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase()
  const retryablePatterns = ['fetch', 'network', 'timeout', 'econnrefused', 'enotfound']
  return retryablePatterns.some(pattern => message.includes(pattern))
}

interface HandleSocialErrorOptions {
  rethrow?: boolean
  dispatch?: (action: { type: SocialFlowAction; error: string }) => void
  logLevel?: 'info' | 'warn' | 'error'
}

export function handleSocialError(
  error: unknown,
  context: string,
  options: HandleSocialErrorOptions = {}
): string {
  const { rethrow = false, dispatch, logLevel = 'error' } = options
  const message = getErrorMessage(error)

  logger[logLevel](`social.${context}.error`, { error: message })

  if (dispatch) {
    dispatch({ type: SocialFlowAction.Error, error: message })
  }

  if (rethrow) {
    throw error
  }

  return message
}

export function extractPageIdsFromTokens(pageTokens: string[]): string[] {
  return pageTokens
    .map(token => {
      const parts = token.split('#')
      return parts[parts.length - 1]
    })
    .filter(Boolean)
}

export function parseUserId(userToken: string): string {
  const parts = userToken.split('#')
  return parts[parts.length - 1]
}

export function findPageToken(pageTokens: string[], pageId: string): string | undefined {
  return pageTokens.find(token =>
    token.includes(`#PAGE#${pageId}`) || token.includes(`#LOCATION#${pageId}`)
  )
}

export function getConnectionDisplayName(
  connection: SocialConnection | EnrichedSocialConnection | null | undefined,
  options: { withFallback?: boolean } = { withFallback: true }
): string | null {
  if (!connection) return null

  const withFallback = options.withFallback ?? true

  if (isFacebookConnection(connection)) {
    const enriched = connection as typeof connection & { pageName?: string }
    const name = enriched.pageName
    if (name) return name
    if (withFallback) return `Page: ${connection.pageId}`
    return null
  }

  if (isInstagramConnection(connection)) {
    const enriched = connection as typeof connection & { pageName?: string }
    const name = enriched.pageName
    if (name) return name
    if (withFallback) return `Page: ${connection.facebookPageId}`
    return null
  }

  if (isGoogleConnection(connection)) {
    const enriched = connection as typeof connection & { locationName?: string }
    const name = enriched.locationName
    if (name) return name
    if (withFallback) return `Location: ${connection.locationId}`
    return null
  }

  if (isTikTokConnection(connection)) {
    const enriched = connection as typeof connection & { shopName?: string }
    const name = enriched.shopName
    if (name) return name
    if (withFallback) return `Shop: ${connection.shopId}`
    return null
  }

  if (isYelpConnection(connection)) {
    const enriched = connection as typeof connection & { businessName?: string }
    const name = enriched.businessName
    if (name) return name
    if (withFallback) return `Business: ${connection.businessId}`
    return null
  }

  return null
}

export function getConnectionDetails(
  connection: SocialConnection | EnrichedSocialConnection
): string | undefined {
  const enriched = connection as any

  if ('username' in enriched && enriched.username) {
    return `@${enriched.username}`
  } else if ('storefrontAddress' in enriched && enriched.storefrontAddress) {
    const addr = enriched.storefrontAddress
    if (addr.locality && addr.administrativeArea) {
      return `${addr.locality}, ${addr.administrativeArea}`
    }
  } else if ('city' in enriched && enriched.city && 'state' in enriched && enriched.state) {
    return `${enriched.city}, ${enriched.state}`
  } else if ('category' in enriched && enriched.category) {
    return enriched.category
  }

  return undefined
}
