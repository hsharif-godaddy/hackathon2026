import { useMutation, useQueryClient } from '@tanstack/react-query';

import { cacheSyncStrategy } from '@/hooks/github/useGitHubTokenHealth';
import { appFetch } from '@/lib/gasket-config';

export type SyncStrategy = 'on_commit' | 'on_publish' | 'manual';

interface ConfigureParams {
  appId: string;
  repoUrl: string;
  branch: string;
  syncStrategy: SyncStrategy;
}

interface UpdateStrategyParams {
  appId: string;
  syncStrategy: SyncStrategy;
}

export function useGitHubConfigure() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ appId, repoUrl, branch, syncStrategy }: ConfigureParams) => {
      const res = await appFetch(`/api/apps/${appId}/github/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl, branch, syncStrategy }),
      });
      if (!res.ok) throw new Error('Failed to configure GitHub remote');
      return res.json();
    },
    onSuccess: (_data, variables) => {
      cacheSyncStrategy(variables.appId, variables.syncStrategy);
      queryClient.invalidateQueries({ queryKey: ['github', 'connection', variables.appId] });
    },
  });
}

export function useGitHubUpdateStrategy() {
  return useMutation({
    mutationFn: async ({ appId, syncStrategy }: UpdateStrategyParams) => {
      const res = await appFetch(`/api/apps/${appId}/github/configure`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncStrategy }),
      });
      if (!res.ok) throw new Error('Failed to update sync strategy');
      return res.json();
    },
    onSuccess: (_data, variables) => {
      cacheSyncStrategy(variables.appId, variables.syncStrategy);
    },
  });
}

export function useGitHubPush() {
  return useMutation({
    mutationFn: async (appId: string) => {
      const res = await appFetch(`/api/apps/${appId}/git/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Failed to trigger push');
      return res.json();
    },
  });
}
