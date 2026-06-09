import { type QueryClient, useQuery } from '@tanstack/react-query';

import type { SyncStrategy } from '@/hooks/github/useGitHubSync';
import { cacheSyncStrategy } from '@/hooks/github/useGitHubTokenHealth';
import { appFetch } from '@/lib/gasket-config';

export interface GitRemoteConfig {
  id: string;
  remoteName: string;
  provider: string;
  repoUrl: string;
  defaultBranch: string;
  lastSyncAt: number | null;
  syncEnabled: boolean;
  syncStrategy: SyncStrategy;
  createdAt: number;
  updatedAt: number;
}

interface RemoteStatusResponse {
  success?: boolean;
  remotes: GitRemoteConfig[];
}

function queryKey(appId: string) {
  return ['github', 'remote-config', appId];
}

async function fetch(appId: string): Promise<GitRemoteConfig | null> {
  const res = await appFetch(`/api/apps/${appId}/git/remote/status`);
  if (!res.ok) throw new Error(`Remote status failed (${res.status})`);
  const data: RemoteStatusResponse = await res.json();
  const remote = data.remotes?.[0] ?? null;
  cacheSyncStrategy(appId, remote?.syncStrategy);
  return remote;
}

export function useGitRemoteConfig(appId: string) {
  return useQuery({
    queryKey: queryKey(appId),
    queryFn: () => fetch(appId),
    enabled: Boolean(appId),
    staleTime: 30_000,
    retry: 2,
  });
}

export function prefetchGitRemoteConfig(queryClient: QueryClient, appId: string) {
  return queryClient.prefetchQuery({
    queryKey: queryKey(appId),
    queryFn: () => fetch(appId),
    staleTime: 30_000,
  });
}
