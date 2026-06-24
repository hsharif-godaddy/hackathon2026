import { useMutation, useQueryClient } from '@tanstack/react-query';

import { cacheSyncStrategy } from '@/hooks/github/useGitHubTokenHealth';
import { appFetch } from '@/lib/gasket-config';

export function useGitHubDisconnect() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (appId: string) => {
      const res = await appFetch(`/api/apps/${appId}/github/disconnect`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to disconnect GitHub');
      return res.json();
    },
    onSuccess: (_data, appId) => {
      cacheSyncStrategy(appId, undefined);
      queryClient.invalidateQueries({ queryKey: ['github', 'connection', appId] });
      queryClient.invalidateQueries({ queryKey: ['github', 'repos', appId] });
      queryClient.invalidateQueries({ queryKey: ['github', 'remote-config', appId] });
    },
  });
}
