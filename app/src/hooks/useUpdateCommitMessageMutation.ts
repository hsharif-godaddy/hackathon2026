import { useMutation, useQueryClient } from '@tanstack/react-query';

import { logger } from '@/lib/request-context';
import { appService } from '@/services/AppService';
import { useGitStore } from '@/stores/useGitStore';

interface UpdateCommitMessageVariables {
  appId: string;
  message: string;
  expectedHash?: string;
}

export function useUpdateCommitMessageMutation() {
  const queryClient = useQueryClient();
  const setSelectedCommitHash = useGitStore((state) => state.setSelectedCommitHash);

  return useMutation<{ success: boolean; newCommitHash: string }, Error, UpdateCommitMessageVariables>({
    mutationFn: async function update({ appId, message, expectedHash }: UpdateCommitMessageVariables) {
      if (!appId || !message.trim()) {
        throw new Error('appId and message are required');
      }

      logger.info('update-commit-message-mutation.start', {
        appId,
      });

      return appService.updateCommitMessage(appId, message, expectedHash);
    },
    onSuccess: async (response, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ['git-history', variables.appId],
        refetchType: 'active'
      });

      setSelectedCommitHash(variables.appId, response.newCommitHash);

      logger.info('update-commit-message-mutation.success', {
        appId: variables.appId,
        commitHash: response.newCommitHash.substring(0, 7),
      });
    },
    onError: (error, variables) => {
      logger.error('update-commit-message-mutation.error', {
        appId: variables.appId,
        error: error.message,
      });
    },
  });
}
