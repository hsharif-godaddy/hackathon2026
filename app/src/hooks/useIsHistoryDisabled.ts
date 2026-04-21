import { ViewMode } from '@/app/[market]/develop/components/types';
import { useGitHistoryQuery } from '@/hooks/useGitHistory';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useGitStore } from '@/stores/useGitStore';
import { useHistoryLoadingComplete, useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore';

/**
 * Determines if the git history UI should be disabled.
 *
 * @param appId - The application ID
 * @param isRestoring - Optional: Whether a commit restore operation is in progress
 * @returns Object containing isDisabled and isPublishing flags
 */
export function useIsHistoryDisabled(appId: string, isRestoring = false) {
  const viewMode = useDevelopPageStore((state) => state.viewMode);
  const isPublishing = useDevelopPageStore((state) =>
    appId ? (state.publishStates?.[appId]?.isPublishing ?? false) : false
  );
  const isSelectingCommit = useGitStore((state) => state.isSelectingCommit);
  const { isLoading: isLoadingCommits } = useGitHistoryQuery({
    appId,
    enabled: !!appId,
  });
  const isLoading = useIsLoading();
  const isStreaming = useIsActivelyStreaming();
  const historyLoadingComplete = useHistoryLoadingComplete();

  const isDisabled = isLoading
    || isStreaming
    || !historyLoadingComplete
    || isLoadingCommits
    || isSelectingCommit
    || isRestoring
    || viewMode === ViewMode.CODE
    || isPublishing;

  return { isDisabled, isPublishing };
}
