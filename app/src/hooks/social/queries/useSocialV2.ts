import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { SOCIAL_CACHE_CONFIG,SocialV2Client } from '@/lib/social'

const socialV2Client = new SocialV2Client()

/**
 * React Query cache configuration for social platform data
 * Different data types have different update frequencies
 */
const QUERY_CONFIG = {
  // Permission validation should always be fresh
  PERMISSIONS: {
    ...SOCIAL_CACHE_CONFIG.PERMISSIONS,
    retry: 1,
  },
  // Metadata (pages, locations, connections) rarely changes
  METADATA: {
    ...SOCIAL_CACHE_CONFIG.METADATA,
    retry: 1,
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

interface UsePagesOptions<T> {
  onSuccess?: (data: T[]) => void
  onError?: (error: Error) => void
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
      platform: 'FACEBOOK' | 'GOOGLE_BUSINESS_PROFILE' | 'TIKTOK'
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

