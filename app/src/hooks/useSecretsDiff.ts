import { useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

export interface SecretsDiff {
  added: string[];
  updated: string[];
  deleted: string[];
}

interface UseSecretsDiffOptions {
  appId: string;
  enabled?: boolean;
}

/**
 * Fetch the diff between preview and publish secrets variants
 *
 * Returns which user-managed secrets are:
 * - added: in preview but not yet published
 * - updated: in both but value changed since last publish
 * - deleted: removed from preview but still in publish
 *
 * Used by AppPublish to surface unsynced secret changes alongside git commit count.
 */
export function useSecretsDiff({ appId, enabled = true }: UseSecretsDiffOptions) {
  return useQuery({
    queryKey: ['secretsDiff', appId],
    queryFn: async function fetchDiff(): Promise<SecretsDiff> {
      const response = await appFetch(`/api/secrets/${appId}/diff?source=preview&destination=publish`);
      if (!response.ok) {
        logger.warn('secrets-diff.fetch.failed', {
          appId,
          status: response.status,
        });
        return { added: [], updated: [], deleted: [] };
      }
      return response.json();
    },
    enabled: enabled && !!appId,
    staleTime: 0,
    retry: 2,
    refetchOnWindowFocus: false,
  });
}
