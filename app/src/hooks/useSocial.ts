import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import { SOCIAL_CACHE_CONFIG, SocialV2Client } from '@/lib/social'
import { getPlatformStrategy } from '@/lib/social-platforms'
import { SocialPlatform, SocialPlatformKey } from '@/types/social'
import { type SocialPostData, SocialPostState } from '@/types/social-posts'
import { SOCIAL_SCOPES } from '@/types/social-scopes'
import { getRootDomain } from '@/utils/getRootDomain'

const socialV2Client = new SocialV2Client()

const FIVE_MINUTES = 5 * 60 * 1000
const THIRTY_MINUTES = 30 * 60 * 1000

const QUERY_CONFIG = {
  PERMISSIONS: {
    ...SOCIAL_CACHE_CONFIG.PERMISSIONS,
    retry: (failureCount: number, error: any) => {
      if (error?.message?.includes('401') || error?.message?.includes('Unauthorized')) {
        return false
      }
      return failureCount < 1
    },
  },
  METADATA: {
    ...SOCIAL_CACHE_CONFIG.METADATA,
    retry: (failureCount: number, error: any) => {
      if (error?.message?.includes('401') || error?.message?.includes('Unauthorized')) {
        return false
      }
      return failureCount < 1
    },
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  },
} as const

interface PermissionValidationResult {
  valid: boolean
  missingScopes?: string[]
}

interface UseValidatePermissionsOptions {
  onSuccess?: (data: PermissionValidationResult) => void
  onError?: (error: Error) => void
}

interface UsePagesOptions<T> {
  onSuccess?: (data: T[]) => void
  onError?: (error: Error) => void
}

interface AuthUrlParams {
  platform: SocialPlatform | string
  appId: string
  state: string
  scopes?: string[]
  popup?: boolean
}

interface AuthUrlResponse {
  url: string
  scopes: string[]
}

interface SiteAssociation {
  id: string
  appId: string
  socialId: string
  platform: string
  createdAt: string
}

interface SiteAssociationsResponse {
  associations: SiteAssociation[]
}

interface SocialPostPayload {
  message?: string
  hashtags?: string[]
  callToAction?: string
  imageUrls?: string[]
}

interface SocialPostRecord {
  id: string
  platform: string
  state: string
  payload: SocialPostPayload | string
}

interface SocialPostsResponse {
  posts: SocialPostRecord[]
}

export function toPostState(state: string): SocialPostState | undefined {
  const values: string[] = Object.values(SocialPostState)
  return values.includes(state) ? (state as SocialPostState) : undefined
}

export function parsePayload(payload: SocialPostPayload | string): SocialPostPayload {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload) as SocialPostPayload
    } catch (error) {
      logger.warn('social.posts.parse-payload.failed', {
        payload,
        error: error instanceof Error ? error.message : String(error),
      })
      return {}
    }
  }
  return payload ?? {}
}

function mapPost(post: SocialPostRecord): SocialPostData {
  const payload = parsePayload(post.payload)
  const imageUrls = payload.imageUrls ?? []
  return {
    id: post.id,
    styleLabel: formatPlatformLabel(post.platform),
    content: payload.message ?? '',
    hashtags: payload.hashtags ?? [],
    callToAction: payload.callToAction,
    images: imageUrls.map((url) => ({ url, width: 1024, height: 1024 })),
    publishedState: toPostState(post.state),
  }
}

function formatPlatformLabel(platform: string): string {
  const normalizedPlatform = platform.toLowerCase()
  if (normalizedPlatform === 'facebook') return 'Facebook Post'
  if (normalizedPlatform === 'instagram') return 'Instagram Post'
  return 'Social Post'
}

export function useValidatePermissions(
  platform: string,
  userTokenId: string,
  requiredScopes: string[],
  enabled = true,
  flowInstanceId?: string,
  options?: UseValidatePermissionsOptions
) {
  return useQuery({
    queryKey: ['social-validate-permissions', platform, userTokenId, flowInstanceId],
    queryFn: async () => {
      const result = await socialV2Client.validatePermissions(platform, userTokenId, requiredScopes)
      if (options?.onSuccess) {
        options.onSuccess(result)
      }
      return result
    },
    enabled: enabled && !!platform && !!userTokenId && requiredScopes.length > 0,
    ...QUERY_CONFIG.PERMISSIONS,
    meta: {
      onError: options?.onError
    }
  })
}

export function useFacebookPages(
  userTokenId: string,
  enabled = true,
  flowInstanceId?: string,
  options?: UsePagesOptions<any>
) {
  return useQuery({
    queryKey: ['facebook-pages', userTokenId, flowInstanceId],
    queryFn: async () => {
      const result = await socialV2Client.getFacebookPages(userTokenId)
      if (options?.onSuccess) {
        options.onSuccess(result)
      }
      return result
    },
    enabled: enabled && !!userTokenId,
    ...QUERY_CONFIG.METADATA,
    meta: {
      onError: options?.onError
    }
  })
}

export function useGoogleLocations(
  userTokenId: string,
  enabled = true,
  flowInstanceId?: string,
  options?: UsePagesOptions<any>
) {
  return useQuery({
    queryKey: ['google-locations', userTokenId, flowInstanceId],
    queryFn: async () => {
      const result = await socialV2Client.getGoogleLocations(userTokenId)
      if (options?.onSuccess) {
        options.onSuccess(result)
      }
      return result
    },
    enabled: enabled && !!userTokenId,
    ...QUERY_CONFIG.METADATA,
    meta: {
      onError: options?.onError
    }
  })
}

export function useCreateSocialConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: {
      platform: SocialPlatformKey
      userTokenId: string
      pageId?: string
      pageTokenId?: string
      locationId?: string
      userId: string
    }) => socialV2Client.createConnection(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social-connections'] })
    },
  })
}

export function useConnectionById(socialId: string, enabled = true) {
  return useQuery({
    queryKey: ['social-connection', socialId],
    queryFn: () => socialV2Client.getConnectionById(socialId),
    enabled: enabled && !!socialId,
    ...QUERY_CONFIG.METADATA,
  })
}

export function useSocialConnections(enabled = true) {
  return useQuery({
    queryKey: ['social-connections'],
    queryFn: () => socialV2Client.getSocialConnections(),
    enabled,
    ...QUERY_CONFIG.METADATA,
  })
}

export function usePublishToFacebook() {
  return useMutation({
    mutationFn: (params: {
      pageId: string
      tokenId: string
      message: string
      imageUrls: string[]
      scheduledAt?: Date
    }) => socialV2Client.publishToFacebook(params),
  })
}

export function usePublishToInstagram() {
  return useMutation({
    mutationFn: (params: {
      igAccountId: string
      tokenId: string
      imageUrl: string
      caption: string
      scheduledAt?: Date
    }) => socialV2Client.publishToInstagram(params),
  })
}

export function useSocialAuthUrl(
  params: AuthUrlParams | null,
  enabled = true
) {
  return useQuery({
    queryKey: ['social-auth-url', params?.platform, params?.appId, params?.state],
    queryFn: async (): Promise<AuthUrlResponse> => {
      if (!params) {
        throw new Error('Parameters are required')
      }

      const { platform, appId, state, scopes, popup } = params
      const strategy = getPlatformStrategy(platform)

      const rootDomain = getRootDomain() || 'godaddy.com'
      const socialAuthBaseUrl = `https://social-auth.api.${rootDomain}`
      const requestedScopes = scopes || SOCIAL_SCOPES[platform] || []
      const authUrlEndpoint = `${socialAuthBaseUrl}/platforms/${strategy.provider}/authorization_url`

      const authUrlParams = new URLSearchParams({
        app: 'airo-builder',
        popup: String(popup ?? true),
        scopes: requestedScopes.join(','),
        path: `develop/${appId}`,
        state,
      })

      if (strategy.oauthParams) {
        Object.entries(strategy.oauthParams).forEach(([key, value]) => {
          authUrlParams.set(key, value)
        })
      }

      const response = await fetch(`${authUrlEndpoint}?${authUrlParams.toString()}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get authorization URL: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return {
        url: data.url,
        scopes: requestedScopes
      };
    },
    enabled: enabled && !!params && !!params.platform && !!params.appId && !!params.state,
    ...SOCIAL_CACHE_CONFIG.AUTH_URL,
    retry: 1,
  });
}

export function useSiteAssociations(siteId: string, enabled = true) {
  return useQuery({
    queryKey: ['site-associations', siteId],
    queryFn: async () => {
      const apiUrl = await buildDynamicApiUrl('social/associations', siteId)
      const response = await agentFetch(apiUrl, {
        siteId,
        method: 'GET'
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch site associations: ${response.status}`)
      }

      const data: SiteAssociationsResponse = await response.json()
      return data
    },
    staleTime: FIVE_MINUTES,
    gcTime: THIRTY_MINUTES,
    enabled: enabled && !!siteId
  })
}

export function useSocialPosts(siteId: string, enabled = true) {
  return useQuery({
    queryKey: ['social-posts', siteId],
    queryFn: async () => {
      const apiUrl = await buildDynamicApiUrl('social/posts', siteId)
      const response = await agentFetch(apiUrl, {
        siteId,
        method: 'GET',
      })
      if (!response.ok) {
        throw new Error(`Failed to fetch social posts: ${response.status}`)
      }
      const data: SocialPostsResponse = await response.json()
      return (data.posts || []).map(mapPost)
    },
    staleTime: FIVE_MINUTES,
    gcTime: THIRTY_MINUTES,
    enabled: enabled && !!siteId,
  })
}

export function useStoreSocialPost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      siteId: string
      associationId?: string
      platform: string
      state: SocialPostState
      payload: {
        message: string
        imageUrl?: string | null
      }
      externalResponse?: unknown
      externalId?: string
      completedAt?: string
      scheduledAt?: string
    }) => {
      const apiUrl = await buildDynamicApiUrl('social/posts', params.siteId)
      const response = await agentFetch(apiUrl, {
        siteId: params.siteId,
        method: 'POST',
        body: JSON.stringify({
          associationId: params.associationId || null,
          platform: params.platform,
          state: params.state,
          payload: params.payload,
          externalResponse: params.externalResponse || null,
          externalId: params.externalId || null,
          completedAt: params.completedAt || new Date().toISOString(),
          scheduledAt: params.scheduledAt || null,
        })
      })

      if (!response.ok) {
        throw new Error(`Failed to store social post: ${response.status}`)
      }

      const data = await response.json()
      return data.post
    },
    onSuccess: (_, { siteId }) => {
      queryClient.invalidateQueries({ queryKey: ['social-posts', siteId] })
    },
  })
}
