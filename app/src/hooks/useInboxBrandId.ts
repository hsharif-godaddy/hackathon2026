'use client';

import { useQuery } from '@tanstack/react-query';

import { buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';

export interface InboxBrandData {
  brandId: string | null;
}

export function useInboxBrandId(appId: string | undefined) {
  const query = useQuery({
    queryKey: ['inbox-brand-id', appId],
    queryFn: async (): Promise<InboxBrandData> => {
      if (!appId) {
        return { brandId: null };
      }

      logger.debug('inbox-brand-id.fetch.start', {
        message: 'Fetching inbox brand ID via React Query',
        appId,
      });

      const url = await buildDynamicApiUrl('inbox-brand-id', appId);
      const response = await agentFetch(url, { siteId: appId });

      if (!response.ok) {
        const errorMessage = `Failed to fetch inbox brand ID: ${response.status} ${response.statusText}`.trim();
        logger.error('inbox-brand-id.fetch.failure', {
          message: errorMessage,
          appId,
        });
        throw new Error(errorMessage);
      }

      const data = await response.json() as InboxBrandData;

      logger.info('inbox-brand-id.fetch.success', {
        brandId: data.brandId,
        appId,
      });

      return data;
    },
    enabled: !!appId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    brandId: query.data?.brandId ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
