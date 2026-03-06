import { useMutation, useQueryClient } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { useSitesStore } from '@/stores/useSitesStore';
import { useSiteStore } from '@/stores/useSiteStore';

interface UnpublishResponse {
  success: boolean;
  message: string;
  agentsSuccess?: boolean;
  domainJobId?: string;
  error?: string;
  details?: string;
  retryable?: boolean;
}

interface UnpublishParams {
  appId: string;
  disconnectDomain?: boolean;
  domainFqdn?: string;
}

interface UnpublishError extends Error {
  retryable?: boolean;
}

/**
 * React Query hook for unpublishing an app
 *
 * Unpublishes an app so it reverts to showing a Coming Soon page.
 * The app can be republished at any time.
 *
 * Flow:
 * 1. Optionally disconnect custom domain
 * 2. Call agents service to remove publish symlink
 * 3. Call control plane to mark publish variant as inactive
 * 4. Refetch site data to update UI
 *
 * @returns Mutation object with mutate, mutateAsync, isPending, isError, error
 */
export function useUnpublishApp() {
  const queryClient = useQueryClient();
  const fetchSite = useSiteStore((state) => state.fetchSite);
  const fetchAllSites = useSitesStore((state) => state.fetchAllSites);

  return useMutation<UnpublishResponse, UnpublishError, UnpublishParams>({
    mutationFn: async ({ appId, disconnectDomain, domainFqdn }) => {
      logger.info('unpublish.hook.start', { appId, disconnectDomain, domainFqdn });

      const response = await appFetch(`/api/apps/${appId}/unpublish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          disconnectDomain,
          domainFqdn,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const error = new Error(data.error || 'Failed to unpublish app') as UnpublishError;
        error.retryable = data.retryable ?? false;
        throw error;
      }

      return data;
    },
    onSuccess: async (_data, variables) => {
      logger.info('unpublish.hook.success', { appId: variables.appId });

      try {
        await Promise.all([
          fetchSite(variables.appId, true),
          fetchAllSites(),
        ]);
      } catch (error) {
        logger.error('unpublish.hook.refetch.error', {
          appId: variables.appId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await queryClient.invalidateQueries({
        queryKey: ['deployments', variables.appId],
        refetchType: 'active',
      });
      await queryClient.invalidateQueries({
        queryKey: ['sites'],
        refetchType: 'active',
      });
    },
    onError: (error, variables) => {
      logger.error('unpublish.hook.error', {
        appId: variables.appId,
        error: error.message,
        retryable: error.retryable,
      });
    },
  });
}
