import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

/**
 * Query key factory for share token operations
 * Centralizes query key generation for consistency across hooks
 */
export const shareTokenKeys = {
  all: ['shareTokens'] as const,
  list: (appId: string) => [...shareTokenKeys.all, 'list', appId] as const,
};

/**
 * Share token data structure
 */
export interface ShareToken {
  token: string;
  appId: string;
  shareUrl?: string; // Full share URL with token
  expiresAt: number; // Unix timestamp in milliseconds
  createdAt: string; // ISO timestamp
  firstUsedAt?: string | null; // ISO timestamp
}

/**
 * Response from list share tokens API
 */
interface ListShareTokensResponse {
  tokens: ShareToken[];
}

/**
 * Parameters for creating a share token
 */
interface CreateShareTokenParams {
  appId: string;
  expiresInDays?: number; // Default: 7
}

/**
 * Response from create share token API
 */
interface CreateShareTokenResponse {
  token: string;
  appId: string;
  shareUrl?: string;
  expiresAt: number;
  createdAt: string;
}

/**
 * React Query hook to fetch share tokens for an app
 *
 * This hook fetches all active share tokens for the specified app.
 * Requires authentication and appbuilder-share-links feature flag.
 *
 * @param appId - The app ID to fetch share tokens for
 * @param options - Optional React Query options
 * @returns Query object with tokens array, isLoading, error, etc.
 *
 * @example
 * ```tsx
 * const { data: tokens, isLoading, error } = useShareTokens('app-123');
 *
 * if (isLoading) return <Spinner />;
 * if (error) return <Error message={error.message} />;
 * return <TokenList tokens={tokens} />;
 * ```
 */
export function useShareTokens(
  appId: string | null | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: shareTokenKeys.list(appId || ''),
    queryFn: async (): Promise<ShareToken[]> => {
      if (!appId) {
        throw new Error('App ID is required');
      }

      logger.info('share-tokens.fetch.start', { appId });

      const response = await appFetch(`/api/apps/${appId}/share`);

      if (!response.ok) {
        const errorData = await response.json();
        logger.error('share-tokens.fetch.failure', {
          appId,
          status: response.status,
          error: errorData.error,
        });
        throw new Error(errorData.error || `Failed to fetch share tokens: ${response.status}`);
      }

      const result: ListShareTokensResponse = await response.json();

      logger.info('share-tokens.fetch.success', {
        appId,
        tokenCount: result.tokens.length,
      });

      return result.tokens;
    },
    enabled: options?.enabled !== false && !!appId,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * React Query mutation hook to create a new share token
 *
 * This hook creates a new share token for an app with a specified expiration.
 * Automatically invalidates the share tokens cache after success.
 *
 * @returns Mutation object with mutate, mutateAsync, isLoading, error, etc.
 *
 * @example
 * ```tsx
 * const { mutate: createToken, isLoading } = useCreateShareToken();
 *
 * const handleCreate = () => {
 *   createToken(
 *     { appId: 'app-123', expiresInDays: 7 },
 *     {
 *       onSuccess: (token) => {
 *         console.log('Created token:', token);
 *       },
 *       onError: (error) => {
 *         console.error('Failed to create token:', error);
 *       },
 *     }
 *   );
 * };
 * ```
 */
export function useCreateShareToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      params: CreateShareTokenParams
    ): Promise<CreateShareTokenResponse> => {
      const { appId, expiresInDays = 7 } = params;

      logger.info('share-tokens.create.start', { appId, expiresInDays });

      const response = await appFetch(`/api/apps/${appId}/share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresInDays }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        logger.error('share-tokens.create.failure', {
          appId,
          status: response.status,
          error: errorData.error,
        });
        throw new Error(errorData.error || `Failed to create share token: ${response.status}`);
      }

      const result: CreateShareTokenResponse = await response.json();

      logger.info('share-tokens.create.success', {
        appId,
        token: result.token,
        expiresAt: result.expiresAt,
      });

      return result;
    },
    onSuccess: (data, variables) => {
      // Invalidate share tokens list to trigger refetch
      queryClient.invalidateQueries({
        queryKey: shareTokenKeys.list(variables.appId),
      });
    },
  });
}

