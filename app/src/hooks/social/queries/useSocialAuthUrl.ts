import { useQuery } from '@tanstack/react-query'

import { SOCIAL_CACHE_CONFIG } from '@/lib/social'
import { getPlatformStrategy } from '@/lib/social-platforms'
import { SocialPlatform } from '@/types/social'
import { DEFAULT_SCOPES } from '@/types/social-scopes'

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

/**
 * Hook to fetch OAuth authorization URL for social platform connection
 *
 * Makes direct API call to social-auth API with credentials included
 *
 * @param params - Platform, appId, state, and optional scopes
 * @param enabled - Whether the query should run (default: true)
 * @returns Query result with authorization URL, loading, error states
 */
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

      const socialAuthBaseUrl = process.env.NEXT_PUBLIC_SOCIAL_AUTH_API_URL || 'https://social-auth.api.dev-godaddy.com'
      const requestedScopes = scopes || DEFAULT_SCOPES[platform] || []
      const authUrlEndpoint = `${socialAuthBaseUrl}/platforms/${strategy.authEndpoint}/authorization_url`

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
