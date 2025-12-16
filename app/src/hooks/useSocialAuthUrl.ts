import { useQuery } from '@tanstack/react-query';

import { SocialPlatform } from '@/types/social';

interface AuthUrlParams {
  platform: SocialPlatform | string;
  appId: string;
  state: string;
  scopes?: string[];
}

interface AuthUrlResponse {
  url: string;
}

const PLATFORM_ENDPOINT_MAP: Record<string, string> = {
  facebook: 'facebook',
  instagram: 'facebook',
  google: 'google',
  tiktok: 'tiktok',
};

const DEFAULT_SCOPES: Record<string, string[]> = {
  facebook: [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'pages_manage_metadata'
  ],
  instagram: [
    'business_management',
    'pages_manage_ads',
    'pages_manage_metadata',
    'pages_show_list',
    'pages_read_engagement',
    'pages_read_user_content',
    'pages_manage_posts',
    'pages_manage_engagement',
    'public_profile',
    'read_insights',
    'instagram_basic',
    'instagram_content_publish',
    'instagram_manage_insights'
  ],
  google: [
    'https://www.googleapis.com/auth/business.manage',
    'https://www.googleapis.com/auth/siteverification',
    'https://www.googleapis.com/auth/webmasters'
  ],
  tiktok: [],
};

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
        throw new Error('Parameters are required');
      }

      const { platform, appId, state, scopes } = params;

      const socialAuthBaseUrl = process.env.NEXT_PUBLIC_SOCIAL_AUTH_API_URL || 'https://social-auth.api.dev-godaddy.com';
      const requestedScopes = scopes || DEFAULT_SCOPES[platform] || [];
      const apiEndpoint = PLATFORM_ENDPOINT_MAP[platform] || platform;
      const authUrlEndpoint = `${socialAuthBaseUrl}/platforms/${apiEndpoint}/authorization_url`;

      const authUrlParams = new URLSearchParams({
        app: 'airo-builder',
        popup: 'true',
        scopes: requestedScopes.join(','),
        path: `develop/${appId}`,
        state,
      });

      if (platform === 'tiktok') {
        authUrlParams.set('integration_type', 'SHOP');
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

      return response.json();
    },
    enabled: enabled && !!params && !!params.platform && !!params.appId && !!params.state,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });
}
