import { useCallback, useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'

import { SOCIAL_CACHE_CONFIG, SocialV2Client } from '@/lib/social'
import { SocialPlatform } from '@/lib/social-platforms'
import { isFacebookConnection, isGoogleConnection, isInstagramConnection, isYelpConnection } from '@/lib/utils/social-type-guards'
import type { EnrichedSocialConnection, SocialConnection } from '@/types/social'

const socialV2Client = new SocialV2Client()

/**
 * React Query configuration for social metadata queries
 * Metadata (page names, location names) rarely changes, so we can cache aggressively
 */
const METADATA_QUERY_CONFIG = {
  ...SOCIAL_CACHE_CONFIG.METADATA,
  retry: 1,                         // Only retry once for network errors
  refetchOnWindowFocus: false,      // Don't refetch when window regains focus
  refetchOnMount: false,            // Don't refetch on component remount if data is fresh
} as const

interface UseConnectionMetadataResult {
  enrichedConnections: Array<SocialConnection | EnrichedSocialConnection>
  isLoadingAnyMetadata: boolean
  connectionsLoadingMetadata: Set<string>
  connectionsWithErrors: Set<string>
}

interface PlatformRequirements {
  needsFacebook: boolean
  needsGoogle: boolean
  needsYelp: boolean
}


export function useConnectionMetadata(
  connections: SocialConnection[],
  platform: string,
  enabled: boolean
): UseConnectionMetadataResult {
  const platformRequirements = useMemo<PlatformRequirements>(() => ({
    needsFacebook: platform === SocialPlatform.FACEBOOK || platform === SocialPlatform.INSTAGRAM,
    needsGoogle: platform === SocialPlatform.GOOGLE,
    needsYelp: platform === SocialPlatform.YELP
  }), [platform])

  const fetchFacebookMetadata = useCallback(async (token: string, pageId: string) => {
    const pages = await socialV2Client.getFacebookPages(token)
    const page = pages.find(p => p.id === pageId)
    return page ? { pageName: page.name, category: page.category, pictureUrl: page.picture?.data?.url } : null
  }, [])

  const fetchInstagramMetadata = useCallback(async (token: string, igAccountId: string) => {
    const account = await socialV2Client.getInstagramAccount(token, igAccountId)
    return { pageName: account.name || account.username, username: account.username, pictureUrl: account.profile_picture_url }
  }, [])

  const fetchGoogleMetadata = useCallback(async (token: string, locationId: string) => {
    const locations = await socialV2Client.getGoogleLocations(token)
    const location = locations.find(loc => loc.name.endsWith(locationId))
    return location ? { locationName: location.title, address: location.storefrontAddress } : null
  }, [])

  const fetchYelpMetadata = useCallback(async (token: string, businessId: string) => {
    const business = await socialV2Client.getYelpBusiness(token, businessId)
    return {
      businessName: business.name,
      address: business.location?.address1,
      city: business.location?.city,
      state: business.location?.state,
      rating: business.rating
    }
  }, [])

  const queries = useMemo(() => {
    return connections.map(conn => {
      const isFb = isFacebookConnection(conn)
      const isInsta = isInstagramConnection(conn)
      const isGoog = isGoogleConnection(conn)
      const isYelp = isYelpConnection(conn)

      let token: string | undefined
      let queryKey: unknown[]
      let pageId: string | undefined
      let igAccountId: string | undefined
      let locationId: string | undefined
      let businessId: string | undefined

      if (isFb) {
        token = conn.userTokenId
        pageId = conn.pageId
        queryKey = ['facebook-pages', token, pageId]
      } else if (isInsta) {
        // Instagram connections use igAccountId to fetch Instagram account metadata
        // Instagram uses userTokenId because IG Business Accounts use Facebook user tokens
        token = conn.userTokenId
        igAccountId = conn.igAccountId
        queryKey = ['instagram-account', token, igAccountId]
      } else if (isGoog) {
        token = conn.userTokenId
        locationId = conn.locationId
        queryKey = ['google-locations', token, locationId]
      } else if (isYelp) {
        token = conn.userTokenId
        businessId = conn.businessId
        queryKey = ['yelp-business', token, businessId]
      } else {
        token = undefined
        queryKey = ['noop']
      }

      const shouldFetch = enabled &&
                         token &&
                         ((isFb && platformRequirements.needsFacebook) ||
                          (isInsta && platformRequirements.needsFacebook) ||
                          (isGoog && platformRequirements.needsGoogle) ||
                          (isYelp && platformRequirements.needsYelp))

      return {
        queryKey,
        queryFn: async () => {
          if (isFb && token && pageId) {
            return fetchFacebookMetadata(token, pageId)
          } else if (isInsta && token && igAccountId) {
            return fetchInstagramMetadata(token, igAccountId)
          } else if (isGoog && token && locationId) {
            return fetchGoogleMetadata(token, locationId)
          } else if (isYelp && token && businessId) {
            return fetchYelpMetadata(token, businessId)
          }
          return null
        },
        enabled: shouldFetch,
        ...METADATA_QUERY_CONFIG
      }
    })
  }, [connections, enabled, platformRequirements, fetchFacebookMetadata, fetchInstagramMetadata, fetchGoogleMetadata, fetchYelpMetadata])

  const metadataQueries = useQueries({ queries })

  // Create stable identifier for query states to prevent infinite re-renders
  const queryStateKey = metadataQueries.map(q => `${q.isLoading}-${!!q.data}-${!!q.error}`).join('|')

  // Create stable query state representation
  const queryStates = useMemo(() => {
    return metadataQueries.map(q => ({
      isLoading: q.isLoading,
      data: q.data,
      error: q.error
    }))
  }, [metadataQueries])

  // Enrich connections with fetched metadata
  const enrichedConnections = useMemo(() => {
    return connections.map((conn, index) => {
      const queryState = queryStates[index]

      if (queryState?.isLoading) {
        return { ...conn, isLoadingMetadata: true }
      }

      if (queryState?.data) {
        return { ...conn, ...queryState.data, isLoadingMetadata: false }
      }

      return conn
    })
  }, [connections, queryStates])

  const connectionsLoadingMetadata = useMemo(() => {
    const loading = new Set<string>()
    connections.forEach((conn, index) => {
      if (queryStates[index]?.isLoading) {
        loading.add(conn.socialId)
      }
    })
    return loading
  }, [connections, queryStates])

  const connectionsWithErrors = useMemo(() => {
    const errors = new Set<string>()
    connections.forEach((conn, index) => {
      if (queryStates[index]?.error) {
        errors.add(conn.socialId)
      }
    })
    return errors
  }, [connections, queryStates])

  return {
    enrichedConnections,
    isLoadingAnyMetadata: metadataQueries.some(q => q.isLoading),
    connectionsLoadingMetadata,
    connectionsWithErrors
  }
}
