import { tokenSuffix } from '@airo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

/**
 * Custom error class that preserves HTTP status for error handling.
 * Allows callers to distinguish between different failure modes (e.g., 409 conflict).
 */
export class ShareTokenError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ShareTokenError';
  }
}

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
        // BFF errors are normally JSON, but a non-JSON body (proxy 502 HTML,
        // gateway timeout) would make response.json() throw and mask the
        // real HTTP failure. Fall back to the status code in that case.
        let errorMessage = `Failed to fetch share tokens: ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData?.error) errorMessage = errorData.error;
        } catch {
          // non-JSON body — keep the status-only error message
        }
        logger.error('share-tokens.fetch.failure', {
          appId,
          status: response.status,
          error: errorMessage,
        });
        throw new Error(errorMessage);
      }

      // Even on response.ok, the body might not be JSON — Gasket proxy
      // misconfig or Next.js runtime error returning 200 with HTML.
      // Without this guard the SyntaxError bypasses share-tokens.fetch
      // .failure logs and React Query surfaces it untagged.
      let result: ListShareTokensResponse;
      try {
        result = await response.json();
      } catch (parseErr) {
        logger.error('share-tokens.fetch.parseError', {
          appId,
          status: response.status,
          error: parseErr instanceof Error ? parseErr.message : 'Unknown parse error',
        });
        throw new Error(`Unexpected response from BFF: ${response.status}`);
      }

      // BFF response type allows `tokens` to be undefined (`tokens?: unknown[]`
      // in route.ts) — if agents drifts to a `{}` body or a proxy returns a
      // 200 with no tokens field, `result.tokens.length` would throw a
      // TypeError that bypasses our parseError log and React Query would
      // surface an untagged runtime error. Treat it as a schema mismatch.
      if (!Array.isArray(result.tokens)) {
        logger.error('share-tokens.fetch.schemaError', {
          appId,
          status: response.status,
        });
        throw new Error(`Unexpected response from BFF: missing tokens array`);
      }

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
        // Same error-body-might-not-be-JSON guard as the fetch path.
        let errorMessage = `Failed to create share token: ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData?.error) errorMessage = errorData.error;
        } catch {
          // non-JSON body — keep the status-only error message
        }
        logger.error('share-tokens.create.failure', {
          appId,
          status: response.status,
          error: errorMessage,
        });
        throw new ShareTokenError(errorMessage, response.status);
      }

      // Same success-path JSON guard as the fetch query.
      let result: CreateShareTokenResponse;
      try {
        result = await response.json();
      } catch (parseErr) {
        logger.error('share-tokens.create.parseError', {
          appId,
          status: response.status,
          error: parseErr instanceof Error ? parseErr.message : 'Unknown parse error',
        });
        throw new Error(`Unexpected response from BFF: ${response.status}`);
      }

      logger.info('share-tokens.create.success', {
        appId,
        // Don't log the raw token — 7-day bearer credential. Last 4 chars
        // are enough for log correlation (8 unknown base64url chars =
        // 2^48 possibilities, infeasible to brute-force).
        shareTokenSuffix: tokenSuffix(result.token),
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

