import { useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import type { GitHubConnectionStatus } from '@/lib/github';

export type { GitHubConnectionStatus };

export function useGitHubConnection(appId: string, options?: { pollInterval?: number | false }) {
  return useQuery({
    queryKey: ['github', 'connection', appId],
    queryFn: async (): Promise<GitHubConnectionStatus> => {
      const res = await appFetch(`/api/apps/${appId}/github/status`);
      if (!res.ok) throw new Error('Failed to check GitHub connection');
      return res.json();
    },
    enabled: Boolean(appId),
    refetchInterval: options?.pollInterval ?? false,
    staleTime: options?.pollInterval ? 0 : 30_000,
  });
}
