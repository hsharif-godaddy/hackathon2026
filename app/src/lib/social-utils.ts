import { getErrorMessage } from '@/lib/errors'
import { logger } from '@/lib/request-context'
import type { FacebookPage, GoogleLocation } from '@/lib/social'
import { isFacebookConnection, isGoogleConnection, isInstagramConnection, isTikTokConnection, isYelpConnection } from '@/lib/utils/social-type-guards'
import type { EnrichedSocialConnection, SocialConnection } from '@/types/social'
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
  connection: SocialConnection | EnrichedSocialConnection | null | undefined
): string | null {
  if (!connection) {return null}

  if (isFacebookConnection(connection)) {
    const enriched = connection as typeof connection & { pageName?: string }
    return enriched.pageName || null
  }

  if (isInstagramConnection(connection)) {
    const enriched = connection as typeof connection & { pageName?: string }
    return enriched.pageName || null
  }

  if (isGoogleConnection(connection)) {
    const enriched = connection as typeof connection & { locationName?: string }
    return enriched.locationName || null
  }

  if (isTikTokConnection(connection)) {
    const enriched = connection as typeof connection & { shopName?: string }
    return enriched.shopName || null
  }

  if (isYelpConnection(connection)) {
    const enriched = connection as typeof connection & { businessName?: string }
    return enriched.businessName || null
  }

  return null
}

type EnrichedDetailsFieldsUnion = EnrichedFieldsUnion & {
  storefrontAddress?: GoogleLocation['storefrontAddress']
  city?: string
  state?: string
}

export function getConnectionDetails(
  connection: SocialConnection | EnrichedSocialConnection
): string | undefined {
  const enriched = connection as SocialConnection & EnrichedDetailsFieldsUnion

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

function formatAddress(address?: GoogleLocation['storefrontAddress']): string {
  if (!address) {return ''}

  const parts: string[] = []

  if (address.addressLines && address.addressLines.length > 0) {
    parts.push(address.addressLines[0])
  }

  if (address.locality) {
    parts.push(address.locality)
  }

  if (address.administrativeArea) {
    parts.push(address.administrativeArea)
  }

  if (address.postalCode) {
    parts.push(address.postalCode)
  }

  return parts.join(', ')
}

export interface SocialDisplayInfo {
  name: string
  subtitle?: string
  pictureUrl?: string
}

function isConnection(data: unknown): data is SocialConnection | EnrichedSocialConnection {
  return typeof data === 'object' && data !== null && 'socialId' in data
}

function isFacebookPage(data: unknown): data is FacebookPage {
  return typeof data === 'object' && data !== null && 'category' in data && !('socialId' in data)
}

function isGoogleLocation(data: unknown): data is GoogleLocation {
  return typeof data === 'object' && data !== null && 'storefrontAddress' in data
}

type EnrichedFieldsUnion = {
  pageName?: string
  locationName?: string
  shopName?: string
  businessName?: string
  username?: string
  category?: string
  address?: string
  pictureUrl?: string
}

function getConnectionDisplayInfo(data: SocialConnection | EnrichedSocialConnection): SocialDisplayInfo {
  const enriched = data as SocialConnection & EnrichedFieldsUnion
  return {
    name: enriched.pageName || enriched.locationName || enriched.shopName || enriched.businessName || '',
    subtitle: enriched.username ? `@${enriched.username}` : enriched.category || enriched.address,
    pictureUrl: enriched.pictureUrl
  }
}

function getFacebookPageDisplayInfo(page: FacebookPage, isInstagramFlow: boolean): SocialDisplayInfo {
  if (isInstagramFlow && page.instagram_business_account) {
    const ig = page.instagram_business_account
    return {
      name: ig.name || ig.username || page.name,
      subtitle: ig.username ? `@${ig.username}` : undefined,
      pictureUrl: ig.profile_picture_url
    }
  }
  return {
    name: page.name,
    subtitle: page.category || undefined,
    pictureUrl: page.picture?.data?.url
  }
}

function getGoogleLocationDisplayInfo(location: GoogleLocation): SocialDisplayInfo {
  return {
    name: location.title,
    subtitle: formatAddress(location.storefrontAddress) || undefined,
    pictureUrl: undefined
  }
}

export function getSocialConnectionDisplayInfo(
  data: FacebookPage | GoogleLocation | SocialConnection | EnrichedSocialConnection,
  options?: { isInstagramFlow?: boolean }
): SocialDisplayInfo {
  if (isConnection(data)) {return getConnectionDisplayInfo(data)}
  if (isFacebookPage(data)) {return getFacebookPageDisplayInfo(data, options?.isInstagramFlow ?? false)}
  if (isGoogleLocation(data)) {return getGoogleLocationDisplayInfo(data)}
  return { name: '', subtitle: undefined, pictureUrl: undefined }
}
