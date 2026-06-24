import { useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';

export interface GitHubBranch {
  name: string;
  protected: boolean;
}

export function useGitHubBranches(appId: string, repo: string, enabled = true) {
  return useQuery({
    queryKey: ['github', 'branches', appId, repo],
    queryFn: async (): Promise<GitHubBranch[]> => {
      const res = await appFetch(
        `/api/apps/${appId}/github/branches?repo=${encodeURIComponent(repo)}`,
      );
      if (!res.ok) throw new Error('Failed to fetch branches');
      return res.json();
    },
    enabled: Boolean(appId) && Boolean(repo) && enabled,
    staleTime: 60_000,
  });
}
