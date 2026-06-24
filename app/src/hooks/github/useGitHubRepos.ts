import { useQuery } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  updatedAt: string;
}

export function useGitHubRepos(appId: string, enabled = true) {
  return useQuery({
    queryKey: ['github', 'repos', appId],
    queryFn: async (): Promise<GitHubRepo[]> => {
      const res = await appFetch(`/api/apps/${appId}/github/repos?per_page=100`);
      if (!res.ok) throw new Error('Failed to fetch repos');
      return res.json();
    },
    enabled: Boolean(appId) && enabled,
    staleTime: 60_000,
  });
}
