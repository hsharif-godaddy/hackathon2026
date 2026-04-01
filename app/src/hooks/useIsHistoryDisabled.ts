import { ViewMode } from '@/app/develop/components/types';
import { useGitHistoryQuery } from '@/hooks/useGitHistory';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useGitStore } from '@/stores/useGitStore';
import { useHistoryLoadingComplete, useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore';

export function useIsHistoryDisabled(appId: string) {
  const viewMode = useDevelopPageStore((state) => state.viewMode);
  const isSelectMode = useDevelopPageStore((state) => state.isSelectMode);
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

  return isLoading
    || isStreaming
    || !historyLoadingComplete
    || isLoadingCommits
    || isSelectingCommit
    || viewMode === ViewMode.CODE
    || isSelectMode
    || isPublishing;
}
