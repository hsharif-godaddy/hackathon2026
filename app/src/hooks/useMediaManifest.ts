import { useQuery } from '@tanstack/react-query';

import type { MediaSlot } from '@/app/[market]/develop/components/media/types';
import { dynamicApiConfigService } from '@/config/dynamic-api';
import { regenerateToken } from '@/lib/jwt-regeneration';
import { logger } from '@/lib/request-context';

type MediaManifest = Record<string, MediaSlot>;

interface GetManifestResponse {
  success: boolean;
  manifest?: MediaManifest;
  error?: string;
}

interface UseMediaManifestOptions {
  appId: string | null;
  enabled?: boolean;
}

interface UseMediaManifestResult {
  manifest: MediaManifest | null;
  slotNames: string[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMediaManifest({
  appId,
  enabled = true,
}: UseMediaManifestOptions): UseMediaManifestResult {
  const query = useQuery({
    queryKey: ['mediaManifest', appId],
    queryFn: async (): Promise<MediaManifest | null> => {
      if (!appId) return null;

      logger.info('hook.media_manifest.fetch.start', { appId });

      try {
        const tokenResult = await regenerateToken({ siteId: appId, force: true });
        const apiConfig = await dynamicApiConfigService.getConfigForSite(appId);

        if (!apiConfig.agentUrl) {
          throw new Error('Agent URL not available');
        }

        const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '');

        const response = await fetch(
          `${baseAgentUrl}/media/${appId}/manifest`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${tokenResult.token}`,
            },
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errorData.error || `Failed to fetch manifest: ${response.status}`);
        }

        const data: GetManifestResponse = await response.json();

        if (!data.success || !data.manifest) {
          throw new Error(data.error || 'Failed to get manifest data');
        }

        logger.info('hook.media_manifest.fetch.success', {
          appId,
          slotCount: Object.keys(data.manifest).length,
        });
        return data.manifest;
      } catch (error) {
        logger.error('hook.media_manifest.fetch.error', {
          appId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    enabled: enabled && !!appId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });

  const manifest = query.data ?? null;

  return {
    manifest,
    slotNames: manifest ? Object.keys(manifest) : [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: async () => {
      await query.refetch();
    },
  };
}
