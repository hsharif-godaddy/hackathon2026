import { useQuery } from '@tanstack/react-query';

import type { SocialConnection } from '@/types/social';

interface SocialConnectionsResponse {
  connections: SocialConnection[];
}

/**
 * Hook to fetch user's social platform connections
 *
 * Makes direct API call to social-v2 API with credentials included
 *
 * @param enabled - Whether the query should run (default: true)
 * @returns Query result with connections array, loading, error states
 */
export function useSocialConnections(enabled = true) {
  return useQuery({
    queryKey: ['social-connections'],
    queryFn: async (): Promise<SocialConnection[]> => {
      const socialV2BaseUrl = process.env.NEXT_PUBLIC_SOCIAL_V2_API_URL || 'https://social-v2.api.dev-godaddy.com';
      const connectionsUrl = `${socialV2BaseUrl}/social_connections`;

      const response = await fetch(connectionsUrl, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get social connections: ${response.status} - ${errorText}`);
      }

      const data: SocialConnectionsResponse = await response.json();
      return data.connections || [];
    },
    enabled,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });
}
